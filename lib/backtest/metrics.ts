import type { Trade } from "@/lib/types";

/* Port of metricsFromTrades in legacy/outcomes.js — same definitions so
   numbers stay comparable with the old study. winRate is a percentage,
   drawdown is measured on the equity walk from startingCapital. */

export interface RunMetrics {
  trades: number;
  wins: number;
  losses: number;
  net: number;
  winRate: number; // percent
  profitFactor: number; // Infinity when no losses but wins exist
  avgR: number;
  maxDrawdown: number;
  expectancy: number;
  averageDuration: number; // minutes
}

export function durationMinutes(t: Trade): number {
  return Math.max(5, Math.round((t.exitTime - t.entryTime) / 60));
}

export function metricsFromTrades(trades: Trade[], startingCapital: number): RunMetrics {
  const wins = trades.filter((t) => t.pnl > 0),
    losses = trades.filter((t) => t.pnl < 0),
    net = trades.reduce((s, t) => s + t.pnl, 0),
    grossWin = wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let equity = startingCapital,
    peak = equity,
    maxDrawdown = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    net,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    avgR: trades.length ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0,
    maxDrawdown,
    expectancy: trades.length ? net / trades.length : 0,
    averageDuration: trades.length
      ? trades.reduce((s, t) => s + durationMinutes(t), 0) / trades.length
      : 0,
  };
}

/* ── Excursion (MAE/MFE) ──────────────────────────────────────────────────
   The engine records maePoints/mfePoints in POINTS, which are not comparable
   across symbols: 10 points of MES is $50 and 10 points of MNQ is $20. R is,
   so everything user-facing normalises here — one definition, per rule 4.

   R is derived from the trade's own stop distance rather than its risk in
   dollars, because risk includes commission while the excursion is pure price.
   A trade whose stop sat 8 points away and which ran 12 points against the
   entry before recovering has MAE 1.5R — it was, at its worst, half again past
   where the idea was wrong. That is the number worth seeing. */

/** Stop distance in points. Null when the trade carries no usable stop. */
export function stopPoints(t: Trade): number | null {
  const d = Math.abs(t.entryPrice - t.stop);
  return d > 0 ? d : null;
}

export const maeR = (t: Trade): number | null => {
  const d = stopPoints(t);
  return d === null || t.maePoints === undefined ? null : t.maePoints / d;
};

export const mfeR = (t: Trade): number | null => {
  const d = stopPoints(t);
  return d === null || t.mfePoints === undefined ? null : t.mfePoints / d;
};

/* How much of the move the trade actually captured — realised R over the best
   R it ever showed. 1.0 means it exited at the high-water mark; 0.2 means it
   gave back four fifths of what it had. Null when the trade never went green,
   because "efficiency" of a move that never happened is not a number. */
export function exitEfficiency(t: Trade): number | null {
  const best = mfeR(t);
  if (best === null || best <= 0) return null;
  const d = stopPoints(t);
  if (d === null) return null;
  const realisedR = t.points / d;
  return realisedR / best;
}

export interface ExcursionSummary {
  n: number; // trades carrying excursion data
  avgMaeR: number | null;
  avgMfeR: number | null;
  avgExitEfficiency: number | null;
  /* Winners' worst drawdown, in R. The practical read: "how much heat did I
     have to sit through on the trades that worked?" A stop tighter than this
     would have cut the winners. */
  avgWinnerMaeR: number | null;
  /* Losers' best excursion, in R. "How often were the losers green first?" —
     the number that argues for or against a breakeven rule. */
  avgLoserMfeR: number | null;
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null;

export function excursionSummary(trades: Trade[]): ExcursionSummary {
  const withData = trades.filter((t) => t.maePoints !== undefined && t.mfePoints !== undefined);
  const num = (f: (t: Trade) => number | null, src = withData) =>
    src.map(f).filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    n: withData.length,
    avgMaeR: mean(num(maeR)),
    avgMfeR: mean(num(mfeR)),
    avgExitEfficiency: mean(num(exitEfficiency)),
    avgWinnerMaeR: mean(num(maeR, withData.filter((t) => t.pnl > 0))),
    avgLoserMfeR: mean(num(mfeR, withData.filter((t) => t.pnl < 0))),
  };
}

/* ── R-multiple distribution ──────────────────────────────────────────────
   rMultiple was only ever averaged into avgR, which hides the shape: two
   books with identical avgR can be "grinds out 0.5R" and "one 12R lottery
   win against thirty −1R losers", and only one of those survives a bad month.

   Bucket edges are in R and deliberately asymmetric — losses cluster at −1R
   because that is where the stop is, so the downside needs finer resolution
   than the upside. */
export const R_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "≤ −2R", lo: -Infinity, hi: -2 },
  { label: "−2R…−1R", lo: -2, hi: -1 },
  { label: "−1R…−0.5R", lo: -1, hi: -0.5 },
  { label: "−0.5R…0", lo: -0.5, hi: 0 },
  { label: "0…+0.5R", lo: 0, hi: 0.5 },
  { label: "+0.5R…+1R", lo: 0.5, hi: 1 },
  { label: "+1R…+2R", lo: 1, hi: 2 },
  { label: "+2R…+3R", lo: 2, hi: 3 },
  { label: "≥ +3R", lo: 3, hi: Infinity },
];

export interface RBucket {
  label: string;
  count: number;
  net: number;
}

export function rDistribution(trades: Trade[]): RBucket[] {
  return R_BUCKETS.map((b) => {
    // Half-open [lo, hi) so a trade lands in exactly one bucket; the top
    // bucket is closed at +Infinity so nothing falls off the end.
    const inBucket = trades.filter((t) => t.rMultiple >= b.lo && t.rMultiple < b.hi);
    return {
      label: b.label,
      count: inBucket.length,
      net: inBucket.reduce((s, t) => s + t.pnl, 0),
    };
  });
}

/* ── Generic slicing ──────────────────────────────────────────────────────
   Expectancy-by-tag and expectancy-by-session are the SAME operation over
   different key functions, so they are one function. Every slice runs through
   metricsFromTrades, so a slice can never disagree with the headline about
   what "expectancy" means. */
export function sliceBy(
  trades: Trade[],
  keyOf: (t: Trade) => string | null,
  startingCapital: number
): Record<string, RunMetrics> {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = keyOf(t);
    if (key === null) continue;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, metricsFromTrades(v, startingCapital)])
  );
}

/** Slice by one of the strategy's own tag values (pattern, entryTf, …). */
export const sliceByTag = (trades: Trade[], tag: string, startingCapital: number) =>
  sliceBy(trades, (t) => t.tags?.[tag] ?? null, startingCapital);

export function scoreBuckets(
  trades: Trade[],
  startingCapital: number
): Record<string, RunMetrics> {
  const buckets: Record<string, Trade[]> = { "≤69": [], "70–84": [], "85–100": [] };
  for (const t of trades) {
    if (t.score == null) continue;
    (t.score < 70 ? buckets["≤69"] : t.score < 85 ? buckets["70–84"] : buckets["85–100"]).push(t);
  }
  return Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, metricsFromTrades(v, startingCapital)])
  );
}
