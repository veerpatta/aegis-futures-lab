/* Ring 0 — nightly knowledge job. Recomputes everything the bot "knows" from
   the accumulated data (real signals, shadow auditions, the bar archive) and
   upserts it, versioned, into learned_stats — one row per stat_key per NY
   trading day. Pure learning, zero behaviour change: nothing here can alter a
   signal, a param, or a policy. Deterministic and idempotent — a same-day
   re-run overwrites the same rows.

   Stats produced (stat_key → payload):
     score_calibration  — zone score deciles vs win rate (real; +shadow variant)
     condition_ledger   — PF/win/net/count by tier×regime, tier×vix, DOW, hour
     gate_costs         — skip-reason funnel priced over trailing 30d of bars
     fill_reality       — weekly share of clean/marginal/doubtful fills
     shadow_scoreboard  — audition stats + promotion checklist per stream

   Run with: npx tsx scripts/engine/learn.ts
   Cells below a minimum sample are flagged { insufficient: true } and carry
   their n, so every surface can print "collecting (n=X of 10)".

   Paper only, delayed data — never touches real money or real orders. */

import { createClient } from "@supabase/supabase-js";
import { nyMeta } from "@/lib/time/ny";
import { holidayFor } from "@/lib/market/holidays";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { profitFactor } from "@/lib/stats";
import { promotionReport, type ShadowLike } from "./promotion";
import { computeGateCosts, GATE_COST_LOOKBACK_DAYS } from "./gate-costs";

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

const PAGE = 1000;
/* Below this a ledger/decile cell is not judged — it is "still collecting".
   Printed everywhere as "n=X of 10 needed" so the gate is never invisible. */
export const MIN_CELL_N = 10;

interface SignalRow {
  tier: "A" | "B";
  symbol: string;
  direction: string | null;
  score: number | null;
  status: string;
  pnl_usd: number | null;
  regime: string | null;
  fill_confidence: string | null;
  vix_bucket: string | null;
  signal_ts: string;
}

interface ShadowDbRow extends ShadowLike {
  strategy: string;
  symbol: string;
  score: number | null;
  signal_ts: string;
}

/* The NY trading day the stats describe: the latest session that has closed
   before now. The nightly cron fires ~00:30–01:30 ET, so "the previous
   trading day" is exactly the session that just finished — and, crucially, it
   depends only on the NY calendar date, not the wall-clock time, so a manual
   re-run any time on the same NY date upserts the same row (idempotent). */
export function learnDateKey(nowSec: number): string {
  let dk = nyMeta(nowSec).dateKey;
  for (let i = 0; i < 15; i++) {
    // step back one calendar day
    const [y, m, d] = dk.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d) - 86400_000);
    dk = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
    const wd = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate())).getUTCDay();
    if (wd === 0 || wd === 6) continue; // weekend
    if (holidayFor(dk)?.kind === "closed") continue; // full holiday
    return dk;
  }
  return dk;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/* Closed-signal cell stats. n<MIN_CELL_N ⇒ insufficient (still reported). */
function cell(pnls: number[]) {
  const wins = pnls.filter((p) => p > 0).length;
  const pf = profitFactor(pnls);
  return {
    n: pnls.length,
    net: round2(sum(pnls)),
    pf: pf === null ? null : Number.isFinite(pf) ? round2(pf) : null,
    winRate: pnls.length ? Math.round((wins / pnls.length) * 100) : null,
    insufficient: pnls.length < MIN_CELL_N,
  };
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("signal_ts", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} read: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const isoWeek = (signalTs: string): string => {
  // NY-date-based ISO week label 'YYYY-Www' — stable, no timezone drift.
  const dk = nyMeta(Math.floor(Date.parse(signalTs) / 1000)).dateKey;
  const [y, m, d] = dk.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mon=0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((dt.getTime() - firstThu.getTime()) / 86400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

/* ── score_calibration ──────────────────────────────────────────────────
   Zone score deciles vs realised win rate. Does the odds-enhancer score
   predict anything yet? Real closed signals with a score, plus a
   shadow-inclusive variant (more samples, same question). */
function scoreCalibration(closed: { score: number | null; pnl: number }[]) {
  const scored = closed.filter((r) => r.score !== null) as { score: number; pnl: number }[];
  scored.sort((a, b) => a.score - b.score);
  const out: Array<ReturnType<typeof cell> & { decile: number; scoreLo: number | null; scoreHi: number | null }> = [];
  if (scored.length) {
    const per = scored.length / 10;
    for (let i = 0; i < 10; i++) {
      const slice = scored.slice(Math.floor(i * per), Math.floor((i + 1) * per));
      if (!slice.length) continue;
      out.push({
        decile: i + 1,
        scoreLo: round2(slice[0].score),
        scoreHi: round2(slice[slice.length - 1].score),
        ...cell(slice.map((s) => s.pnl)),
      });
    }
  }
  return { total: scored.length, deciles: out };
}

async function main() {
  const started = Date.now();
  const nowSec = Math.floor(started / 1000);
  const date_key = learnDateKey(nowSec);
  const computed_at = new Date().toISOString();

  const signals = await fetchAll<SignalRow>(
    "signals",
    "tier, symbol, direction, score, status, pnl_usd, regime, fill_confidence, vix_bucket, signal_ts"
  );
  const closed = signals.filter((s) => s.pnl_usd !== null);

  // ── score_calibration ──
  const realCal = scoreCalibration(closed.map((s) => ({ score: s.score, pnl: s.pnl_usd ?? 0 })));
  let shadowClosed: ShadowDbRow[] = [];
  try {
    shadowClosed = (
      await fetchAll<ShadowDbRow>(
        "shadow_signals",
        "strategy, symbol, status, score, pnl_usd, regime, fill_confidence, signal_ts"
      )
    ).filter((r) => r.pnl_usd !== null);
  } catch (e) {
    console.error(`shadow read failed (score+scoreboard degrade): ${e instanceof Error ? e.message : e}`);
  }
  const inclusiveCal = scoreCalibration(
    [...closed, ...shadowClosed].map((s) => ({ score: s.score, pnl: s.pnl_usd ?? 0 }))
  );

  // ── condition_ledger ──
  const bucketMap = <K extends string>(keyOf: (s: SignalRow) => K | null) => {
    const m = new Map<string, number[]>();
    for (const s of closed) {
      const k = keyOf(s);
      if (k === null) continue;
      (m.get(k) ?? m.set(k, []).get(k)!).push(s.pnl_usd ?? 0);
    }
    return Object.fromEntries([...m.entries()].sort().map(([k, v]) => [k, cell(v)]));
  };
  const conditionLedger = {
    tierRegime: bucketMap((s) => (s.regime ? (`${s.tier}·${s.regime}` as string) : null)),
    tierVix: bucketMap((s) => (s.vix_bucket ? (`${s.tier}·${s.vix_bucket}` as string) : null)),
    dayOfWeek: bucketMap((s) => nyMeta(Math.floor(Date.parse(s.signal_ts) / 1000)).weekday),
    entryHour: bucketMap((s) => String(nyMeta(Math.floor(Date.parse(s.signal_ts) / 1000)).hour).padStart(2, "0")),
    minCell: MIN_CELL_N,
  };

  // ── fill_reality ──
  const weeks = new Map<string, { clean: number; marginal: number; doubtful: number; untagged: number; total: number }>();
  for (const s of closed) {
    const wk = isoWeek(s.signal_ts);
    const w = weeks.get(wk) ?? { clean: 0, marginal: 0, doubtful: 0, untagged: 0, total: 0 };
    const c = s.fill_confidence;
    if (c === "clean") w.clean++;
    else if (c === "marginal") w.marginal++;
    else if (c === "doubtful") w.doubtful++;
    else w.untagged++;
    w.total++;
    weeks.set(wk, w);
  }
  const fillReality = {
    weeks: [...weeks.entries()].sort().map(([week, w]) => ({
      week,
      ...w,
      doubtfulShare: w.total ? Math.round((w.doubtful / w.total) * 100) : 0,
    })),
  };

  // ── gate_costs (trailing 30d of archived bars, skip-reason funnel) ──
  let gateCosts: unknown = { lookbackDays: GATE_COST_LOOKBACK_DAYS, gates: [], note: "unavailable" };
  try {
    gateCosts = await computeGateCosts(supabase, nowSec);
  } catch (e) {
    gateCosts = { lookbackDays: GATE_COST_LOOKBACK_DAYS, gates: [], note: `unavailable: ${e instanceof Error ? e.message : e}` };
  }

  // ── shadow_scoreboard (needs ALL shadow rows, open + closed, for counts) ──
  let allShadow: ShadowDbRow[] = [];
  try {
    allShadow = await fetchAll<ShadowDbRow>(
      "shadow_signals",
      "strategy, symbol, status, score, pnl_usd, regime, fill_confidence, signal_ts"
    );
  } catch {
    allShadow = shadowClosed;
  }
  const shadowStreamKeys = [...new Set(allShadow.map((r) => `${r.strategy}|${r.symbol}`))].sort();
  const shadowScoreboard = {
    streams: shadowStreamKeys.map((key) => {
      const [strategy, symbol] = key.split("|");
      const report = promotionReport(allShadow.filter((r) => r.strategy === strategy && r.symbol === symbol));
      return {
        strategy,
        symbol,
        closed: report.closed,
        net: round2(report.net),
        pf: report.pf === null ? null : round2(report.pf),
        winRate: report.winRate,
        exPf: report.exPf === null ? null : round2(report.exPf),
        exNet: round2(report.exNet),
        regimesWithData: report.regimesWithData,
        regimesPositive: report.regimesPositive,
        promotable: report.promotable,
        checklist: report.checklist,
      };
    }),
  };

  const rows = [
    { stat_key: "score_calibration", date_key, computed_at, payload: { real: realCal, inclusive: inclusiveCal, minCell: MIN_CELL_N } },
    { stat_key: "condition_ledger", date_key, computed_at, payload: conditionLedger },
    { stat_key: "gate_costs", date_key, computed_at, payload: gateCosts },
    { stat_key: "fill_reality", date_key, computed_at, payload: fillReality },
    { stat_key: "shadow_scoreboard", date_key, computed_at, payload: shadowScoreboard },
  ];

  const { error } = await supabase.from("learned_stats").upsert(rows, { onConflict: "stat_key,date_key" });
  if (error) throw new Error(`learned_stats upsert: ${error.message}`);

  console.log(
    `learn ok: ${rows.length} stats for ${date_key} · ` +
      `${closed.length} closed real / ${shadowClosed.length} closed shadow · ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
