/* Horizon return study — the signal detached from stops and targets.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BACKTEST: a backtest measures the signal
 * AND the trade management together. If the management is wrong, a real signal
 * looks dead; if the management is lucky, a dead signal looks alive. Forward
 * returns from the signal timestamp, with no stop and no target, isolate the
 * one question: after this signal, does price move the way the signal says,
 * more often than chance?
 *
 * TWO NULLS, NOT ONE. Testing against zero is not enough. Intraday futures
 * returns have strong time-of-day structure, so a signal that fires mostly at
 * 09:35 inherits whatever 09:35 does on average and can look predictive while
 * carrying no information. The same-time-of-day control draws from the SAME
 * minute on OTHER sessions, so anything that survives it is signal rather than
 * seasonality.
 */

import type { Bar } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";
import { mulberry32 } from "@/scripts/engine/montecarlo";

/** Minutes ahead to measure. End-of-session is handled separately. */
export const DEFAULT_HORIZONS = [5, 15, 30, 60];

export interface SignalPoint {
  symbol: string;
  time: number;
  side: "LONG" | "SHORT";
}

export interface HorizonSample {
  /** Direction-adjusted return in points: positive means the signal was right. */
  points: number;
  /** The same, divided by ATR at the signal bar. Null when ATR is unavailable. */
  atrUnits: number | null;
}

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

export interface HorizonResult {
  horizon: number | "session";
  n: number;
  /** Direction-adjusted mean forward return, in ATR units, with a bootstrap CI. */
  signal: Interval;
  /** Same-minute-of-day draws from other sessions. The honest null. */
  control: Interval;
  /** signal.mean − control.mean, with its own bootstrap CI. */
  excess: Interval;
  /** True when the excess CI excludes zero — the only claim worth making. */
  beatsControl: boolean;
  /** True when the signal CI alone excludes zero. Weaker: seasonality passes it. */
  beatsZero: boolean;
}

/* Index bars by symbol -> time so a signal can find its bar in O(1), and by
   session -> minute so the control can find the same clock time elsewhere. */
export interface BarIndex {
  bars: Bar[];
  byTime: Map<number, number>;
  byMinute: Map<number, number[]>;
  atr: (number | null)[];
}

export function indexBars(bars: Bar[], atrSeries: (number | null)[]): BarIndex {
  const byTime = new Map<number, number>();
  const byMinute = new Map<number, number[]>();
  bars.forEach((b, i) => {
    byTime.set(b.time, i);
    const m = nyMeta(b.time).minutes;
    const list = byMinute.get(m);
    if (list) list.push(i);
    else byMinute.set(m, [i]);
  });
  return { bars, byTime, byMinute, atr: atrSeries };
}

/* Forward return from bar `i`, direction-adjusted.
   Uses closes throughout: entering and measuring at the same price series
   removes the bid/ask question from a study that is about direction, not
   execution. Returns null when the horizon runs past the session or the data. */
function forwardFrom(
  idx: BarIndex,
  i: number,
  side: "LONG" | "SHORT",
  horizon: number | "session",
): HorizonSample | null {
  const from = idx.bars[i];
  if (!from) return null;
  const startKey = nyMeta(from.time).dateKey;

  let j: number;
  if (horizon === "session") {
    j = i;
    while (j + 1 < idx.bars.length && nyMeta(idx.bars[j + 1].time).dateKey === startKey) j++;
  } else {
    const bars = horizon / 5; // the archive is 5-minute
    j = i + bars;
    if (j >= idx.bars.length) return null;
    // Do not measure across a session boundary: the overnight gap is a
    // different phenomenon and would swamp an intraday signal.
    if (nyMeta(idx.bars[j].time).dateKey !== startKey) return null;
  }
  if (j === i) return null;

  const raw = idx.bars[j].close - from.close;
  const points = side === "LONG" ? raw : -raw;
  const a = idx.atr[i];
  return { points, atrUnits: a && a > 0 ? points / a : null };
}

/** Percentile bootstrap of the mean. */
export function bootstrapMean(xs: number[], iterations = 2000, seed = 1, alpha = 0.05): Interval {
  if (!xs.length) return { mean: NaN, lo: NaN, hi: NaN };
  const rand = mulberry32(seed);
  const means: number[] = new Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let total = 0;
    for (let k = 0; k < xs.length; k++) total += xs[Math.floor(rand() * xs.length)];
    means[b] = total / xs.length;
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(iterations - 1, Math.max(0, Math.floor(q * iterations)))];
  return {
    mean: xs.reduce((s, v) => s + v, 0) / xs.length,
    lo: at(alpha / 2),
    hi: at(1 - alpha / 2),
  };
}

/* Paired bootstrap of (signal − control). Paired, because each control draw is
   matched to its signal's minute-of-day: resampling them independently would
   break the matching that makes the control meaningful in the first place. */
function bootstrapDifference(
  signal: number[],
  control: number[],
  iterations = 2000,
  seed = 2,
  alpha = 0.05,
): Interval {
  const n = Math.min(signal.length, control.length);
  if (!n) return { mean: NaN, lo: NaN, hi: NaN };
  const diffs = Array.from({ length: n }, (_, i) => signal[i] - control[i]);
  return bootstrapMean(diffs, iterations, seed, alpha);
}

export interface HorizonOptions {
  horizons?: (number | "session")[];
  iterations?: number;
  seed?: number;
  /** Control draws per signal; averaged, to cut the control's own noise. */
  controlDraws?: number;
}

export function horizonStudy(
  signals: SignalPoint[],
  index: Record<string, BarIndex>,
  opts: HorizonOptions = {},
): HorizonResult[] {
  const horizons = opts.horizons ?? [...DEFAULT_HORIZONS, "session" as const];
  const iterations = opts.iterations ?? 2000;
  const controlDraws = opts.controlDraws ?? 4;
  const rand = mulberry32(opts.seed ?? 11);

  return horizons.map((horizon, hi) => {
    const sig: number[] = [];
    const ctl: number[] = [];

    for (const s of signals) {
      const idx = index[s.symbol];
      if (!idx) continue;
      const i = idx.byTime.get(s.time);
      if (i === undefined) continue;
      const forward = forwardFrom(idx, i, s.side, horizon);
      if (!forward || forward.atrUnits === null) continue;

      // Same minute-of-day, different session. Direction is held at the
      // signal's own side so the control answers "what does this clock time
      // do, facing this way", not "what does a random trade do".
      const minute = nyMeta(idx.bars[i].time).minutes;
      const peers = (idx.byMinute.get(minute) ?? []).filter((k) => k !== i);
      if (!peers.length) continue;
      let total = 0;
      let taken = 0;
      for (let d = 0; d < controlDraws; d++) {
        const k = peers[Math.floor(rand() * peers.length)];
        const c = forwardFrom(idx, k, s.side, horizon);
        if (c?.atrUnits !== null && c !== null) {
          total += c.atrUnits;
          taken++;
        }
      }
      if (!taken) continue;

      sig.push(forward.atrUnits);
      ctl.push(total / taken);
    }

    const signal = bootstrapMean(sig, iterations, (opts.seed ?? 11) + hi);
    const control = bootstrapMean(ctl, iterations, (opts.seed ?? 11) + 500 + hi);
    const excess = bootstrapDifference(sig, ctl, iterations, (opts.seed ?? 11) + 900 + hi);
    return {
      horizon,
      n: sig.length,
      signal,
      control,
      excess,
      beatsControl: Number.isFinite(excess.lo) && excess.lo > 0,
      beatsZero: Number.isFinite(signal.lo) && signal.lo > 0,
    };
  });
}
