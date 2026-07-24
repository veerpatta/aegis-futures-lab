/* Ring 1b runtime + training glue. winprob.ts holds the pure math; this module
   does the Supabase I/O: nightly retrain + lifecycle transitions (learn.ts),
   and per-run scoring of live signals (run-live.ts). Every state change writes
   a bot_policy audit row + a non-throwing Telegram notice. Paper only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GRADUATE_MIN_TRAIN,
  MODEL_NAME,
  scoreRow,
  trainingRows,
  trainModel,
  type ModelArtifact,
  type ModelRow,
} from "./winprob";
import { sendTelegram } from "./notify";

export const VETO_PERCENTILE = 10; // bottom decile of the trailing distribution

export interface LoadedModel {
  coefficients: number[];
  features: { normalizer: { scoreMean: number; scoreStd: number; rrMean: number; rrStd: number } };
  status: "observe" | "active" | "demoted";
}

export async function loadLatestModel(supabase: SupabaseClient): Promise<LoadedModel | null> {
  const { data, error } = await supabase
    .from("model_registry")
    .select("coefficients, features, status")
    .order("trained_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`model_registry read: ${error.message}`);
  const row = data?.[0] as LoadedModel | undefined;
  if (!row || !Array.isArray(row.coefficients) || !row.coefficients.length) return null;
  return row;
}

/* Nightly: train on all clean-fill closed rows, evaluate walk-forward, persist
   a model_registry row, and transition status with an audit trail.
     observe → active   when train_n ≥ 300 AND OOS Brier < baseline AND !frozen
     active  → demoted   when OOS Brier no longer beats baseline (safety, even frozen)
     demoted stays demoted (keeps scoring, never vetoes) */
export async function retrainModel(
  supabase: SupabaseClient,
  rows: ModelRow[]
): Promise<{ status: string; train_n: number; oos_brier: number | null; baseline_brier: number | null }> {
  const frozen = process.env.BOT_POLICY_FREEZE === "1";
  const artifact: ModelArtifact | null = trainModel(rows);

  const { data: prev, error: prevErr } = await supabase
    .from("model_registry")
    .select("status, oos_brier, baseline_brier")
    .order("trained_at", { ascending: false })
    .limit(1);
  if (prevErr) throw new Error(`model_registry read: ${prevErr.message}`);
  const prevRow = prev?.[0] as { status?: string; oos_brier?: number | null; baseline_brier?: number | null } | undefined;
  const prevSnap: EvalSnapshot = {
    status: (prevRow?.status as EvalSnapshot["status"]) ?? "observe",
    oos_brier: prevRow?.oos_brier ?? null,
    baseline_brier: prevRow?.baseline_brier ?? null,
  };

  // Too little clean data to emit a real model — record an observe placeholder
  // with NO coefficients (never an all-zero set that would veto everything) and
  // take no lifecycle action. loadLatestModel treats null coefficients as
  // "no model", so nothing scores.
  if (artifact === null) {
    const trainN = trainingRows(rows).length;
    const { error } = await supabase.from("model_registry").insert({
      model: MODEL_NAME,
      coefficients: null,
      features: null,
      train_n: trainN,
      oos_brier: null,
      baseline_brier: null,
      calibration: null,
      status: prevSnap.status,
    });
    if (error) throw new Error(`model_registry insert: ${error.message}`);
    return { status: prevSnap.status, train_n: trainN, oos_brier: null, baseline_brier: null };
  }

  const decision = nextModelStatus(prevSnap, artifact, frozen);
  const status = decision.status;
  const flip = decision.flip;

  const { error: insErr } = await supabase.from("model_registry").insert({
    model: artifact.model,
    coefficients: artifact.coefficients,
    features: artifact.features,
    train_n: artifact.train_n,
    oos_brier: artifact.oos_brier,
    baseline_brier: artifact.baseline_brier,
    calibration: artifact.calibration,
    status,
  });
  if (insErr) throw new Error(`model_registry insert: ${insErr.message}`);

  if (decision.skipped)
    console.log(
      `model evaluation skipped: insufficient out-of-sample data tonight — status kept at ${status}.`
    );

  if (flip) {
    await supabase.from("bot_policy").insert({
      actor: "model",
      stream: "winprob-model",
      action: flip.action,
      reason: flip.reason,
      metrics: { train_n: artifact.train_n, oos_brier: artifact.oos_brier, baseline_brier: artifact.baseline_brier },
    });
    await sendTelegram(
      flip.action === "veto_enabled"
        ? `🎓 win-prob model graduated to active — ${flip.reason}. It may now veto the bottom-decile signals. Paper only, delayed data.`
        : flip.action === "veto_disabled"
          ? `⚠️ win-prob model demoted to scoring-only — ${flip.reason}. Vetoes off; it keeps auditing. Paper only.`
          : `🔄 win-prob model recovered — ${flip.reason}. Back to observe (re-auditioning before it can veto again). Paper only.`
    );
  }
  return { status, train_n: artifact.train_n, oos_brier: artifact.oos_brier, baseline_brier: artifact.baseline_brier };
}

export interface EvalSnapshot {
  status: "observe" | "active" | "demoted";
  oos_brier: number | null;
  baseline_brier: number | null;
}
export interface ModelDecision {
  status: "observe" | "active" | "demoted";
  flip: { action: "veto_enabled" | "veto_disabled" | "observe"; reason: string } | null;
  skipped: boolean;
}

/* Pure lifecycle transition (finding 11). Null metrics (a transient read
   failure or too-thin OOS) mean the model can't be judged tonight: KEEP the
   current status, take no action (skipped). A genuine measured regression
   demotes an active model only when it's the SECOND consecutive one — one bad
   night doesn't strip authority. Demotion is reversible: a demoted model that
   beats baseline two evaluations running returns to observe (it must then
   re-graduate by the normal rule, not jump straight back to active). */
export function nextModelStatus(
  prev: EvalSnapshot,
  current: { train_n: number; oos_brier: number | null; baseline_brier: number | null },
  frozen: boolean
): ModelDecision {
  const beats = (o: number | null, b: number | null) => o !== null && b !== null && o < b;
  const regressed = (o: number | null, b: number | null) => o !== null && b !== null && o >= b;

  if (current.oos_brier === null || current.baseline_brier === null)
    return { status: prev.status, flip: null, skipped: true };

  const currentBeat = beats(current.oos_brier, current.baseline_brier);
  const currentRegressed = regressed(current.oos_brier, current.baseline_brier);
  const prevBeat = beats(prev.oos_brier, prev.baseline_brier);
  const prevRegressed = regressed(prev.oos_brier, prev.baseline_brier);

  if (prev.status === "active") {
    if (currentRegressed && prevRegressed)
      return {
        status: "demoted",
        flip: { action: "veto_disabled", reason: `OOS Brier ${current.oos_brier} ≥ baseline ${current.baseline_brier} for a 2nd straight evaluation` },
        skipped: false,
      };
    return { status: "active", flip: null, skipped: false };
  }
  if (prev.status === "demoted") {
    if (currentBeat && prevBeat)
      return {
        status: "observe",
        flip: { action: "observe", reason: `beat baseline (${current.oos_brier} < ${current.baseline_brier}) two evaluations running` },
        skipped: false,
      };
    return { status: "demoted", flip: null, skipped: false };
  }
  // observe
  if (current.train_n >= GRADUATE_MIN_TRAIN && currentBeat && !frozen)
    return {
      status: "active",
      flip: { action: "veto_enabled", reason: `train_n ${current.train_n} ≥ ${GRADUATE_MIN_TRAIN}, OOS Brier ${current.oos_brier} < baseline ${current.baseline_brier}` },
      skipped: false,
    };
  return { status: "observe", flip: null, skipped: false };
}

function percentile(values: number[], p: number): number | null {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
  return arr[idx];
}

export interface WinProbResult {
  status: string | null;
  active: boolean;
  threshold: number | null;
  vetoed: number;
}

/* Per-run: score each row's win_prob, then flag the bottom-decile of the
   trailing distribution as model_veto. The veto only takes real effect (alert
   exclusion) when the model is ACTIVE; in observe/demoted it is a ghost flag
   the digest grades. Mutates rows in place. Never throws to the caller's fatal
   path — the caller wraps this. */
export async function applyWinProb<
  T extends ModelRow & { win_prob: number | null; model_veto: boolean; dedupe_key: string }
>(supabase: SupabaseClient, rows: T[]): Promise<WinProbResult> {
  const model = await loadLatestModel(supabase);
  if (!model) return { status: null, active: false, threshold: null, vetoed: 0 };

  for (const row of rows) row.win_prob = +scoreRow(model, row).toFixed(4);

  // Trailing distribution: the 500 MOST RECENT stored scores (descending +
  // range, so it never truncates at Supabase's 1000-row cap), excluding this
  // run's own rows so their prior stored win_prob isn't double-counted against
  // their fresh score (finding 2).
  const runKeys = new Set(rows.map((r) => r.dedupe_key));
  const { data: dist } = await supabase
    .from("signals")
    .select("win_prob, dedupe_key")
    .not("win_prob", "is", null)
    .order("signal_ts", { ascending: false })
    .range(0, 499);
  const pooled = [
    ...(dist ?? []).filter((r) => !runKeys.has(String(r.dedupe_key))).map((r) => Number(r.win_prob)),
    ...rows.map((r) => r.win_prob ?? NaN),
  ];
  const threshold = percentile(pooled, VETO_PERCENTILE);
  const vetoSet = new Set(selectVetoes(rows, threshold));

  let vetoed = 0;
  for (const row of rows) {
    row.model_veto = vetoSet.has(row);
    if (row.model_veto) vetoed++;
  }
  return { status: model.status, active: model.status === "active", threshold, vetoed };
}

/* Which rows to veto: at most ceil(0.1 * n) of the scored rows — the strictly
   lowest that are at/below the trailing-decile threshold. If ties at the cap
   boundary would overflow, veto NONE of the tied rows (fail open) so a model
   that can't discriminate (e.g. all equal probabilities) flags nothing.
   Pure — no I/O — so it is unit-tested directly (finding 7). */
export function selectVetoes<T extends { win_prob: number | null }>(
  rows: T[],
  threshold: number | null
): T[] {
  const scored = rows.filter((r) => r.win_prob !== null);
  const cap = Math.ceil(0.1 * scored.length);
  if (cap === 0 || threshold === null) return [];
  const sorted = [...scored].sort((a, b) => (a.win_prob as number) - (b.win_prob as number));
  const eligible = sorted.filter((r) => (r.win_prob as number) <= threshold);
  if (eligible.length <= cap) return eligible;
  const boundary = eligible[cap - 1].win_prob as number;
  // Only fail open when the cap boundary is TIED with the next row — otherwise
  // take exactly the lowest `cap`.
  if ((eligible[cap].win_prob as number) === boundary)
    return eligible.filter((r) => (r.win_prob as number) < boundary);
  return eligible.slice(0, cap);
}
