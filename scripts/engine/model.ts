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
    .select("status")
    .order("trained_at", { ascending: false })
    .limit(1);
  if (prevErr) throw new Error(`model_registry read: ${prevErr.message}`);
  const prevStatus = (prev?.[0]?.status as string | undefined) ?? "observe";

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
      status: prevStatus,
    });
    if (error) throw new Error(`model_registry insert: ${error.message}`);
    return { status: prevStatus, train_n: trainN, oos_brier: null, baseline_brier: null };
  }

  const beatsBaseline =
    artifact.oos_brier !== null &&
    artifact.baseline_brier !== null &&
    artifact.oos_brier < artifact.baseline_brier;

  let status = prevStatus;
  let flip: { action: "veto_enabled" | "veto_disabled"; reason: string } | null = null;
  if (prevStatus === "active") {
    if (!beatsBaseline) {
      status = "demoted";
      flip = {
        action: "veto_disabled",
        reason: `OOS Brier ${artifact.oos_brier} no longer beats baseline ${artifact.baseline_brier}`,
      };
    }
  } else if (prevStatus === "demoted") {
    status = "demoted"; // terminal: keeps scoring, never re-vetoes on its own
  } else {
    // observe
    if (artifact.train_n >= GRADUATE_MIN_TRAIN && beatsBaseline && !frozen) {
      status = "active";
      flip = {
        action: "veto_enabled",
        reason: `train_n ${artifact.train_n} ≥ ${GRADUATE_MIN_TRAIN}, OOS Brier ${artifact.oos_brier} < baseline ${artifact.baseline_brier}`,
      };
    } else status = "observe";
  }

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
        : `⚠️ win-prob model demoted to scoring-only — ${flip.reason}. Vetoes off; it keeps auditing. Paper only.`
    );
  }
  return { status, train_n: artifact.train_n, oos_brier: artifact.oos_brier, baseline_brier: artifact.baseline_brier };
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
