/* Seeded statistics for the experiment's verdicts. Pure and reproducible.

   Resampling is by SESSION (trading day), never by single trade: ideas on the
   same day share the market's mood, so shuffling trades one by one would make
   the uncertainty look smaller than it is. */

import { mulberry32 } from "@/scripts/engine/montecarlo";

export interface Interval {
  est: number;
  lo: number;
  hi: number;
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

function bySession<T extends { session: string }>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.session, [...(groups.get(r.session) ?? []), r]);
  return [...groups.keys()].sort().map((k) => groups.get(k)!);
}

/** Mean of `value` per row with a session-clustered percentile bootstrap. */
export function sessionBootstrapMean(rows: { session: string; value: number }[], B: number, seed: number, alpha: number): Interval {
  const n = rows.length;
  if (!n) return { est: NaN, lo: NaN, hi: NaN };
  const est = rows.reduce((a, r) => a + r.value, 0) / n;
  const groups = bySession(rows).map((g) => ({ sum: g.reduce((a, r) => a + r.value, 0), n: g.length }));
  if (groups.length < 2) return { est, lo: -Infinity, hi: Infinity };
  const rand = mulberry32(seed);
  const stats: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0, m = 0;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[Math.floor(rand() * groups.length)];
      s += g.sum;
      m += g.n;
    }
    stats.push(m ? s / m : 0);
  }
  stats.sort((a, b) => a - b);
  return { est, lo: percentile(stats, alpha / 2), hi: percentile(stats, 1 - alpha / 2) };
}

/** Percentile of the chosen rows' total against random picks of the same
    count inside each session. 50 means no better than picking at random. */
export function matchedRandomPercentile(rows: { session: string; value: number; take: boolean }[], R: number, seed: number): number {
  const actual = rows.reduce((a, r) => a + (r.take ? r.value : 0), 0);
  const groups = bySession(rows).map((g) => ({ values: g.map((r) => r.value), k: g.filter((r) => r.take).length }));
  const rand = mulberry32(seed);
  let below = 0, ties = 0;
  for (let i = 0; i < R; i++) {
    let total = 0;
    for (const g of groups) {
      if (!g.k) continue;
      const pool = [...g.values];
      for (let j = 0; j < g.k; j++) {
        const pick = j + Math.floor(rand() * (pool.length - j));
        [pool[j], pool[pick]] = [pool[pick], pool[j]];
        total += pool[j];
      }
    }
    if (total < actual - 1e-9) below++;
    else if (Math.abs(total - actual) <= 1e-9) ties++;
  }
  return R ? (100 * (below + ties / 2)) / R : NaN;
}

/** Largest fall from a running high of a cumulative P&L path. */
export function maxDrawdown(pnls: number[]): number {
  let equity = 0, peak = 0, dd = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}

/** 95th percentile drawdown when whole sessions are reshuffled. */
export function stressDrawdownP95(rows: { session: string; value: number }[], R: number, seed: number): number {
  const groups = bySession(rows).map((g) => g.map((r) => r.value));
  if (!groups.length) return 0;
  const rand = mulberry32(seed);
  const dds: number[] = [];
  for (let i = 0; i < R; i++) {
    const order = [...groups];
    for (let j = order.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [order[j], order[k]] = [order[k], order[j]];
    }
    dds.push(maxDrawdown(order.flat()));
  }
  dds.sort((a, b) => a - b);
  return percentile(dds, 0.95);
}

export function brier(preds: number[], ys: number[]): number {
  return preds.length ? preds.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / preds.length : NaN;
}
