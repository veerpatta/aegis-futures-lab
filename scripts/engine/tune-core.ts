/* Shared tune primitives — imported by both the monthly tune (tune.ts, which
   prints the human report) and the weekly challenger (challenger.ts, which
   turns surviving candidates into PRs). No top-level side effects, so importing
   it never runs a job. The honesty rules live here: search only on the train
   window, validate on a held-out month on BOTH PF and net, and reject on the
   Monte-Carlo tail gate: a p95 drawdown >25% worse than the incumbent's, or —
   once above MC_P95_ABS_CEILING — one that fails to strictly improve on it. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { alignArchiveSlice } from "@/lib/data/window";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { defaultParams, type ParamValues } from "@/lib/strategies/types";
import { rsiReversion } from "@/lib/strategies/rsi-reversion";
import { fetchYahooBars } from "./data";
import { resampleDrawdowns } from "./montecarlo";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, type TierStream } from "./tiers";
import { DEFAULT_BAR_SOURCE } from "@/lib/data/source";

export const OOS_DAYS = 30;
export const MIN_OOS_TRADES = 8;
export const MIN_TRAIN_TRADES = 20;
export const MC_RESAMPLES = 1000;
export const MC_P95_TOLERANCE = 1.25; // candidate p95 DD may be at most 25% worse

/* Absolute tail ceiling. MC_P95_TOLERANCE is purely RELATIVE, so a candidate can
   pass while carrying a 33% p95 drawdown simply because the incumbent does too —
   which is how a chain of comparisons drifts into tail risk nobody approved, 25%
   at a time. Above this ceiling a candidate may only RATCHET DOWN: it must strictly
   improve on the incumbent's p95, not merely fail to worsen it. A flat ceiling
   alone would freeze tuning forever while we sit above it, which would be a silent
   lockout — the exact failure mode this repo keeps finding. */
export const MC_P95_ABS_CEILING = 0.2 * STARTING_CAPITAL; // 600 on a 3,000 book

/* The tail gate, exported so it is unit-testable on its own (like pfRank). Both
   legs must hold: within the relative tolerance AND either under the absolute
   ceiling or a strict improvement on the incumbent. */
export function tailGateOk(candP95: number, incP95: number): boolean {
  return candP95 <= incP95 * MC_P95_TOLERANCE && (candP95 <= MC_P95_ABS_CEILING || candP95 < incP95);
}

/* Rejection text. Says which half failed by printing both numbers and the
   ceiling — the old message asserted ">25% worse", which is now sometimes untrue
   because the ceiling leg can fail on its own. Single-sourced so it cannot drift
   back to that claim. */
export function tailGateReason(label: string, candP95: number, incP95: number): string {
  return (
    `candidate ${label} beats OOS but fails the tail gate — p95 DD ${candP95.toFixed(0)} ` +
    `vs incumbent ${incP95.toFixed(0)} (ceiling ${MC_P95_ABS_CEILING.toFixed(0)}; above it a candidate must strictly improve)`
  );
}

const PAGE = 1000;

async function archiveAllBars(supabase: SupabaseClient, symbol: FeedSymbol): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .eq("source", DEFAULT_BAR_SOURCE)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m read for ${symbol}: ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/* Bar archive unioned with the current Yahoo window (Yahoo wins on overlap).

   Whole-session trimmed, like every other archive reader. This was MISSING
   here: the P1 round wired alignArchiveSlice into gate-costs.ts, report.ts and
   run-live.ts but tune-core.ts has its own archive read, so both the monthly
   tune (tune.ts) and the weekly challenger (challenger.ts) were still reading a
   window whose leading day could be a truncated half-session — the exact defect
   that made two nightly funnels disagree by 80%. Alignment is applied to the
   UNION, not to the archive read alone, because the union's leading date is
   whichever source starts earlier. */
export async function loadSeries(supabase: SupabaseClient, symbol: FeedSymbol): Promise<Bar[]> {
  const [archive, yahoo] = await Promise.all([
    archiveAllBars(supabase, symbol).catch(() => [] as Bar[]),
    fetchYahooBars(symbol).catch(() => [] as Bar[]),
  ]);
  const byTime = new Map(archive.map((b) => [b.time, b]));
  for (const b of yahoo) byTime.set(b.time, b);
  const bars = alignArchiveSlice([...byTime.values()].sort((a, b) => a.time - b.time));
  if (!bars.length) throw new Error(`No bars for ${symbol} from archive or Yahoo`);
  return bars;
}

export interface EvalResult {
  trades: number;
  net: number;
  pf: number | null;
  pnls: number[];
}

export function evaluate(
  stream: TierStream,
  params: ParamValues,
  bySymbol: Record<string, Bar[]>,
  window: { fromTime?: number; toTime?: number }
): EvalResult {
  const res = executeRun({
    strategyId: stream.strategyId,
    params,
    series: Object.fromEntries(stream.symbols.map((s) => [s, bySymbol[s]])),
    execution: {
        ...EXECUTION,
        fillModel: stream.fillModel,
        // Per-symbol risk cap (item 2.3); absent ⇒ the shared EXECUTION value.
        maxRisk: stream.maxRisk ?? EXECUTION.maxRisk,
      },
    locks: stream.locks,
    startingCapital: STARTING_CAPITAL,
    sessionExitMinute: SESSION_EXIT_MINUTE,
    pointValues: POINT_VALUES,
    window,
  });
  return { trades: res.metrics.trades, net: res.metrics.net, pf: res.metrics.profitFactor, pnls: res.trades.map((t) => t.pnl) };
}

/* Deliberately small candidate grid — a wide grid on a few months of data is
   an overfitting machine. */
export function rsiCandidates(): { label: string; params: ParamValues }[] {
  const base: ParamValues = { ...defaultParams(rsiReversion), session: "day" };
  const out: { label: string; params: ParamValues }[] = [];
  for (const oversold of [20, 25, 30])
    for (const overbought of [70, 75, 80])
      for (const targetR of [1.5, 2])
        out.push({ label: `os${oversold}/ob${overbought}/t${targetR}R`, params: { ...base, oversold, overbought, targetR } });
  return out;
}

export const incumbentLabel = (stream: TierStream): string =>
  `os${stream.params.oversold}/ob${stream.params.overbought}/t${stream.params.targetR ?? 1.5}R`;

/* Comparable profit factor. profitFactor() is null when there are no losses:
   a profitable no-loss window is the BEST possible (+Infinity), not the worst
   (the `?? -1` bug); a window with no/negative trades ranks worst (finding 9). */
export function pfRank(r: EvalResult): number {
  if (r.pf !== null) return r.pf;
  return r.trades > 0 && r.net > 0 ? Infinity : -Infinity;
}

export interface ChallengerVerdict {
  verdict: "challenger" | "none" | "insufficient-oos";
  label: string | null;
  params: ParamValues | null;
  oosPf: number | null;
  oosNet: number | null;
  mcP95Dd: number | null;
  incumbentOosPf: number | null;
  incumbentOosNet: number | null;
  dataCutoff: string | null;
  oosTrades: number;
  reason: string;
  /* Every evaluation the gate already ran, so a caller that wants to SHOW its
     working — the monthly issue prints a train/OOS table per stream — does not
     have to re-derive it. tune.ts used to keep its own copy of the whole search
     and gate; that copy drifted (it kept the `?? -1` PF bug, had no absolute
     tail ceiling, and never gated the incumbent's OOS trade count), so the
     human-facing report and the automated challenger could disagree. */
  detail: ChallengerDetail | null;
}

export interface ChallengerDetail {
  oosStart: number;
  incTrain: EvalResult;
  incOos: EvalResult;
  incMc: { median: number; p95: number };
  candLabel: string | null;
  candTrain: EvalResult | null;
  candOos: EvalResult | null;
  candMc: { median: number; p95: number } | null;
}

/* The full OOS + Monte-Carlo gate for one RSI stream. Returns the surviving
   challenger (or "none" with the reason). Tier A / non-RSI streams never
   propose — at ~0.3 trades/day a grid search is curve-fitting. */
export function challengerFor(stream: TierStream, bySymbol: Record<string, Bar[]>): ChallengerVerdict {
  const none = (reason: string, extra: Partial<ChallengerVerdict> = {}): ChallengerVerdict => ({
    verdict: "none",
    label: null,
    params: null,
    oosPf: null,
    oosNet: null,
    mcP95Dd: null,
    incumbentOosPf: null,
    incumbentOosNet: null,
    dataCutoff: null,
    oosTrades: 0,
    reason,
    detail: null,
    ...extra,
  });
  if (stream.strategyId !== "rsi-reversion")
    return none("no candidate grid for this stream (too few trades to tune without curve-fitting)");

  const lastBar = Math.max(...stream.symbols.map((s) => bySymbol[s][bySymbol[s].length - 1].time));
  const dataCutoff = new Date(lastBar * 1000).toISOString();
  const oosStart = lastBar - OOS_DAYS * 86400;

  const incTrain = evaluate(stream, stream.params, bySymbol, { toTime: oosStart });
  const incOos = evaluate(stream, stream.params, bySymbol, { fromTime: oosStart });
  const incFull = evaluate(stream, stream.params, bySymbol, {});
  const incMc = resampleDrawdowns(incFull.pnls, MC_RESAMPLES);
  const baseDetail = (
    over: Partial<ChallengerDetail> = {}
  ): ChallengerDetail => ({
    oosStart,
    incTrain,
    incOos,
    incMc: { median: incMc.median, p95: incMc.p95 },
    candLabel: null,
    candTrain: null,
    candOos: null,
    candMc: null,
    ...over,
  });

  let best: { label: string; params: ParamValues; train: EvalResult } | null = null;
  for (const c of rsiCandidates()) {
    const train = evaluate(stream, c.params, bySymbol, { toTime: oosStart });
    if (train.trades < MIN_TRAIN_TRADES || train.net <= 0) continue;
    if (
      !best ||
      (train.pf ?? Infinity) > (best.train.pf ?? Infinity) ||
      ((train.pf ?? null) === (best.train.pf ?? null) && train.net > best.train.net)
    )
      best = { ...c, train };
  }

  const base = { incumbentOosPf: incOos.pf, incumbentOosNet: incOos.net };
  if (!best || best.label === incumbentLabel(stream))
    return none("no in-sample candidate beat the incumbent", { ...base, detail: baseDetail() });

  const candOos = evaluate(stream, best.params, bySymbol, { fromTime: oosStart });
  const candFull = evaluate(stream, best.params, bySymbol, {});
  const candMc = resampleDrawdowns(candFull.pnls, MC_RESAMPLES);
  const detail = baseDetail({
    candLabel: best.label,
    candTrain: best.train,
    candOos,
    candMc: { median: candMc.median, p95: candMc.p95 },
  });
  const withDetail = { ...base, detail };

  // Both sides need a real held-out month before any comparison — otherwise the
  // week is inconclusive, not a pass or a fail.
  if (incOos.trades < MIN_OOS_TRADES || candOos.trades < MIN_OOS_TRADES)
    return {
      ...none(`insufficient held-out trades (incumbent ${incOos.trades}, candidate ${candOos.trades}; need ≥${MIN_OOS_TRADES} each)`, withDetail),
      verdict: "insufficient-oos",
      label: best.label,
      params: best.params,
      oosPf: candOos.pf,
      oosNet: candOos.net,
      dataCutoff,
      oosTrades: candOos.trades,
    };

  // A no-loss (perfect) OOS month has null PF — rank it as best, not worst.
  const oosBeats = pfRank(candOos) > pfRank(incOos) && candOos.net > incOos.net;
  const mcOk = tailGateOk(candMc.p95, incMc.p95);

  if (!oosBeats)
    return none(`best candidate ${best.label} fails the held-out month (overfits)`, withDetail);
  if (!mcOk) return none(tailGateReason(best.label, candMc.p95, incMc.p95), withDetail);

  return {
    verdict: "challenger",
    label: best.label,
    params: best.params,
    oosPf: candOos.pf,
    oosNet: candOos.net,
    mcP95Dd: candMc.p95,
    incumbentOosPf: incOos.pf,
    incumbentOosNet: incOos.net,
    dataCutoff,
    oosTrades: candOos.trades,
    reason: `survives OOS (PF ${candOos.pf?.toFixed(2)} vs ${incOos.pf?.toFixed(2)}, net ${candOos.net.toFixed(0)} vs ${incOos.net.toFixed(0)}) and Monte Carlo`,
    detail,
  };
}

/** Stream key for challenger_history / bot PRs (matches tune labels). */
export const streamTuneKey = (stream: TierStream): string =>
  `${stream.tier}:${stream.label}:${stream.symbols.join("+")}`;
