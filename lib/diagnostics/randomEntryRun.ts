/* Orchestration for the random-entry null: run the same engine N times with
 * randomised entries and report where the real strategy sits.
 *
 * Separated from randomEntry.ts so the sampler stays engine-free and can be
 * tested in isolation — the sampler is where a silent bias would live.
 */

import type { Bar, Trade } from "@/lib/types";
import type { DisciplineLocks } from "@/lib/backtest/engine";
import { runBacktest } from "@/lib/backtest/engine";
import type { ExecutionConfig } from "@/lib/strategies/types";
import { nyMeta } from "@/lib/time/ny";
import {
  candidatePool,
  drawEntries,
  histogramDeviation,
  pValueOneSided,
  percentileOf,
  quantile,
  randomEntryStrategy,
  rngFor,
  type Candidate,
  type EntryProfile,
  type Geometry,
  type SamplingMode,
  type SessionWindow,
} from "./randomEntry";

export interface NullCellSpec {
  /** Stable identity — seeds every iteration, so a cell reproduces exactly. */
  cell: string;
  series: Record<string, Bar[]>;
  execution: ExecutionConfig;
  locks: DisciplineLocks | null;
  startingCapital: number;
  sessionExitMinute: number;
  pointValues: Record<string, number>;
  window?: { fromTime?: number; toTime?: number };
  sessionWindow: SessionWindow | null;
  profile: EntryProfile;
  geometry: Geometry;
  mode: SamplingMode;
  iterations: number;
}

export interface BookStats {
  n: number;
  net: number;
  avgR: number;
  pf: number;
  winRate: number;
}

export interface NullResult {
  cell: string;
  mode: SamplingMode;
  iterations: number;
  real: BookStats;
  /** Sorted null draws. */
  nullNet: number[];
  nullAvgR: number[];
  nullPf: number[];
  /* Where the real book sits in the null, 0-100. Above 95 is the bar the
     brief sets for "the entry signal contributes something". */
  percentileNet: number;
  percentileAvgR: number;
  pValueNet: number;
  pValueAvgR: number;
  medianNullNet: number;
  p05NullNet: number;
  p95NullNet: number;
  medianNullAvgR: number;
  p95NullAvgR: number;
  /* Diagnostics on the null itself. These are how you tell a matched null
     from one that quietly drifted — report them, never assume them. */
  meanRealisedN: number;
  realisedNRatio: number;
  meanLongFraction: number;
  realLongFraction: number;
  minuteDeviation: number;
  minuteMisses: number;
}

export function statsOf(trades: Trade[]): BookStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  return {
    n: trades.length,
    net: trades.reduce((s, t) => s + t.pnl, 0),
    avgR: trades.length ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0,
    pf: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    winRate: trades.length ? wins.length / trades.length : 0,
  };
}

/* Run one cell's null distribution.
 *
 * `realTrades` is the real book for this exact slice — it supplies the profile
 * the null matches AND the value the null is compared against, so the two can
 * never be computed over different windows. */
export function runNullDistribution(
  spec: NullCellSpec,
  realTrades: Trade[],
  pool?: Candidate[],
): NullResult {
  const candidates = pool ?? candidatePool(spec.series, spec.sessionWindow);
  const real = statsOf(realTrades);
  const realMinutes = realTrades.map((t) => nyMeta(t.entryTime).minutes);
  const geometryDraws = spec.geometry.kind === "bootstrap" ? spec.geometry.draws.length : 0;

  const nullNet: number[] = [];
  const nullAvgR: number[] = [];
  const nullPf: number[] = [];
  const realisedNs: number[] = [];
  const longFractions: number[] = [];
  const drawnMinutes: number[] = [];
  let minuteMisses = 0;

  for (let i = 0; i < spec.iterations; i++) {
    // A FRESH generator per iteration, seeded from (cell, i). Iteration 37
    // therefore reproduces standalone — which is both a test and the reason
    // this loop could be parallelised later without changing any number.
    const rand = rngFor(spec.cell, i);
    const drawn = drawEntries(spec.profile, candidates, spec.mode, rand, geometryDraws);
    minuteMisses += drawn.minuteMisses;

    const res = runBacktest({
      series: spec.series,
      strategy: randomEntryStrategy(drawn.entries, spec.geometry),
      params: {},
      // Byte-identical to the real run's. A null that quietly ran cost-free
      // would look better than reality and wrongly "prove" the strategy bad.
      execution: spec.execution,
      locks: spec.locks,
      startingCapital: spec.startingCapital,
      sessionExitMinute: spec.sessionExitMinute,
      window: spec.window,
      pointValueOf: (symbol) => spec.pointValues[symbol] ?? 1,
    });

    const s = statsOf(res.trades);
    nullNet.push(s.net);
    nullAvgR.push(s.avgR);
    nullPf.push(s.pf);
    realisedNs.push(s.n);
    longFractions.push(s.n ? res.trades.filter((t) => t.side === "LONG").length / s.n : 0);
    for (const t of res.trades) drawnMinutes.push(nyMeta(t.entryTime).minutes);
  }

  const sortedNet = [...nullNet].sort((a, b) => a - b);
  const sortedAvgR = [...nullAvgR].sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : 0);

  return {
    cell: spec.cell,
    mode: spec.mode,
    iterations: spec.iterations,
    real,
    nullNet: sortedNet,
    nullAvgR: sortedAvgR,
    nullPf: [...nullPf].sort((a, b) => a - b),
    percentileNet: percentileOf(nullNet, real.net),
    percentileAvgR: percentileOf(nullAvgR, real.avgR),
    pValueNet: pValueOneSided(nullNet, real.net),
    pValueAvgR: pValueOneSided(nullAvgR, real.avgR),
    medianNullNet: quantile(sortedNet, 0.5),
    p05NullNet: quantile(sortedNet, 0.05),
    p95NullNet: quantile(sortedNet, 0.95),
    medianNullAvgR: quantile(sortedAvgR, 0.5),
    p95NullAvgR: quantile(sortedAvgR, 0.95),
    meanRealisedN: mean(realisedNs),
    realisedNRatio: real.n ? mean(realisedNs) / real.n : 0,
    meanLongFraction: mean(longFractions),
    realLongFraction: real.n ? realTrades.filter((t) => t.side === "LONG").length / real.n : 0,
    minuteDeviation: histogramDeviation(realMinutes, drawnMinutes),
    minuteMisses,
  };
}

/* The interpretation rule, fixed in code BEFORE any run, so the reading of the
   result cannot be chosen after seeing it.

   Note the third row. Because these streams lose money gross, the null is
   likely to lose money too. A null centred below zero is NOT a null result —
   it is a separate finding about trade management and cost geometry, and it
   must be reported as its own claim rather than folded into the verdict about
   entries. */
export type Verdict =
  | "beats-random"
  | "indistinguishable-from-random"
  | "worse-than-random"
  | "insufficient-sample";

export function verdictFor(r: NullResult): Verdict {
  if (r.real.n < 30 || r.iterations < 100) return "insufficient-sample";
  if (r.percentileAvgR >= 95) return "beats-random";
  if (r.percentileAvgR <= 5) return "worse-than-random";
  return "indistinguishable-from-random";
}

export function describeVerdict(r: NullResult): string {
  switch (verdictFor(r)) {
    case "insufficient-sample":
      return `${r.cell}: too few trades (${r.real.n}) or iterations (${r.iterations}) to judge.`;
    case "beats-random":
      return (
        `${r.cell}: real avg R ${r.real.avgR.toFixed(3)} sits at the ` +
        `${r.percentileAvgR.toFixed(1)}th percentile of matched random entries ` +
        `(p=${r.pValueAvgR.toFixed(4)}). The entry signal carries information.`
      );
    case "worse-than-random":
      return (
        `${r.cell}: real avg R ${r.real.avgR.toFixed(3)} sits at the ` +
        `${r.percentileAvgR.toFixed(1)}th percentile — BELOW the 5th. The entries are ` +
        `actively anti-predictive, a stronger claim than "no edge".`
      );
    default:
      return (
        `${r.cell}: real avg R ${r.real.avgR.toFixed(3)} sits at the ` +
        `${r.percentileAvgR.toFixed(1)}th percentile of matched random entries ` +
        `(null median ${r.medianNullAvgR.toFixed(3)}). The entry signal contributes ` +
        `nothing; no amount of parameter tuning will help.`
      );
  }
}
