/* Shared tune primitives — imported by both the monthly tune (tune.ts, which
   prints the human report) and the weekly challenger (challenger.ts, which
   turns surviving candidates into PRs). No top-level side effects, so importing
   it never runs a job. The honesty rules live here: search only on the train
   window, validate on a held-out month on BOTH PF and net, and reject on a
   Monte-Carlo p95 drawdown that is >25% worse than the incumbent's. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { defaultParams, type ParamValues } from "@/lib/strategies/types";
import { rsiReversion } from "@/lib/strategies/rsi-reversion";
import { fetchYahooBars } from "./data";
import { resampleDrawdowns } from "./montecarlo";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, type TierStream } from "./tiers";

export const OOS_DAYS = 30;
export const MIN_OOS_TRADES = 8;
export const MIN_TRAIN_TRADES = 20;
export const MC_RESAMPLES = 1000;
export const MC_P95_TOLERANCE = 1.25; // candidate p95 DD may be at most 25% worse

const PAGE = 1000;

async function archiveAllBars(supabase: SupabaseClient, symbol: FeedSymbol): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
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

/** Bar archive unioned with the current Yahoo window (Yahoo wins on overlap). */
export async function loadSeries(supabase: SupabaseClient, symbol: FeedSymbol): Promise<Bar[]> {
  const [archive, yahoo] = await Promise.all([
    archiveAllBars(supabase, symbol).catch(() => [] as Bar[]),
    fetchYahooBars(symbol).catch(() => [] as Bar[]),
  ]);
  const byTime = new Map(archive.map((b) => [b.time, b]));
  for (const b of yahoo) byTime.set(b.time, b);
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
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
    execution: { ...EXECUTION, fillModel: stream.fillModel },
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
  reason: string;
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
    reason,
    ...extra,
  });
  if (stream.strategyId !== "rsi-reversion")
    return none("no candidate grid for this stream (too few trades to tune without curve-fitting)");

  const lastBar = Math.max(...stream.symbols.map((s) => bySymbol[s][bySymbol[s].length - 1].time));
  const oosStart = lastBar - OOS_DAYS * 86400;

  const incOos = evaluate(stream, stream.params, bySymbol, { fromTime: oosStart });
  const incFull = evaluate(stream, stream.params, bySymbol, {});
  const incMc = resampleDrawdowns(incFull.pnls, MC_RESAMPLES);

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
    return none("no in-sample candidate beat the incumbent", base);

  const candOos = evaluate(stream, best.params, bySymbol, { fromTime: oosStart });
  const candFull = evaluate(stream, best.params, bySymbol, {});
  const candMc = resampleDrawdowns(candFull.pnls, MC_RESAMPLES);

  // Both sides need a real held-out month before any comparison — otherwise the
  // week is inconclusive, not a pass or a fail.
  if (incOos.trades < MIN_OOS_TRADES || candOos.trades < MIN_OOS_TRADES)
    return {
      ...none(`insufficient held-out trades (incumbent ${incOos.trades}, candidate ${candOos.trades}; need ≥${MIN_OOS_TRADES} each)`, base),
      verdict: "insufficient-oos",
      label: best.label,
      params: best.params,
      oosPf: candOos.pf,
      oosNet: candOos.net,
    };

  // A no-loss (perfect) OOS month has null PF — rank it as best, not worst.
  const oosBeats = pfRank(candOos) > pfRank(incOos) && candOos.net > incOos.net;
  const mcOk = candMc.p95 <= incMc.p95 * MC_P95_TOLERANCE;

  if (!oosBeats)
    return none(`best candidate ${best.label} fails the held-out month (overfits)`, base);
  if (!mcOk)
    return none(`candidate ${best.label} beats OOS but its p95 drawdown is >25% worse — rejected on tail risk`, base);

  return {
    verdict: "challenger",
    label: best.label,
    params: best.params,
    oosPf: candOos.pf,
    oosNet: candOos.net,
    mcP95Dd: candMc.p95,
    incumbentOosPf: incOos.pf,
    incumbentOosNet: incOos.net,
    reason: `survives OOS (PF ${candOos.pf?.toFixed(2)} vs ${incOos.pf?.toFixed(2)}, net ${candOos.net.toFixed(0)} vs ${incOos.net.toFixed(0)}) and Monte Carlo`,
  };
}

/** Stream key for challenger_history / bot PRs (matches tune labels). */
export const streamTuneKey = (stream: TierStream): string =>
  `${stream.tier}:${stream.label}:${stream.symbols.join("+")}`;
