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
