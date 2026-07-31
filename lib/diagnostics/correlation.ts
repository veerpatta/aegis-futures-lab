/* Correlation and effective sample size.
 *
 * WHY THIS MATTERS FOR THIS CODEBASE SPECIFICALLY: the headline evidence is
 * "16 stream-years, all losing". That reads as sixteen independent
 * confirmations. It is not. MES and MNQ are both US equity index futures and
 * move together intraday, so the two symbols in any given year are close to
 * one observation, not two. The losing result still stands — but its
 * STRENGTH must be quoted against effective N, not nominal N, or every
 * significance claim built on it is inflated.
 *
 * The same correction applies in the other direction, and that is the honest
 * reason to build it: if a future strategy looks good across both symbols,
 * that is also close to one piece of evidence rather than two.
 */

import type { Bar } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}

/* Bar-to-bar log returns, paired on identical timestamps.
   Pairing on time (rather than on index) matters: the two symbols do not
   always have the same bar count in a session, and an index-aligned
   correlation would silently compare different minutes. */
export function pairedReturns(a: Bar[], b: Bar[]): { times: number[]; a: number[]; b: number[] } {
  const bByTime = new Map(b.map((bar) => [bar.time, bar]));
  const times: number[] = [];
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const prevA = a[i - 1];
    const curA = a[i];
    const curB = bByTime.get(curA.time);
    const prevB = bByTime.get(prevA.time);
    if (!curB || !prevB) continue;
    // Same session only — the overnight gap is not an intraday return.
    if (nyMeta(curA.time).dateKey !== nyMeta(prevA.time).dateKey) continue;
    if (prevA.close <= 0 || prevB.close <= 0) continue;
    times.push(curA.time);
    ra.push(Math.log(curA.close / prevA.close));
    rb.push(Math.log(curB.close / prevB.close));
  }
  return { times, a: ra, b: rb };
}

export interface RollingPoint {
  time: number;
  rho: number;
}

/** Rolling correlation over a trailing window of paired returns. */
export function rollingCorrelation(
  a: Bar[],
  b: Bar[],
  window = 78 * 5, // ~5 RTH sessions of 5m bars
): RollingPoint[] {
  const paired = pairedReturns(a, b);
  const out: RollingPoint[] = [];
  for (let i = window; i < paired.times.length; i++) {
    out.push({
      time: paired.times[i],
      rho: pearson(paired.a.slice(i - window, i), paired.b.slice(i - window, i)),
    });
  }
  return out;
}

/* Effective sample size for `k` streams whose pairwise correlation averages
   `rho`, each contributing `n` observations.
 *
 *     N_eff = k*n / (1 + (k-1)*rho)
 *
 * This is the standard design-effect correction for equicorrelated
 * observations. Two perfectly correlated streams give N_eff = n (one stream's
 * worth); two uncorrelated streams give 2n. Negative correlation is clamped at
 * 0 rather than allowed to inflate N_eff past the nominal count — a diagnostic
 * should never report MORE evidence than was collected. */
export function effectiveSampleSize(n: number, k: number, rho: number): number {
  if (!Number.isFinite(rho) || k <= 1) return n * Math.max(1, k);
  // Clamped to [0,1]. rho = 1 is safe: the denominator becomes k, so N_eff
  // collapses to exactly n — one stream's worth of evidence, which is the
  // right answer for two perfectly redundant instruments.
  const r = Math.min(1, Math.max(0, rho));
  return (k * n) / (1 + (k - 1) * r);
}

export interface CorrelationSummary {
  pairs: number;
  /** Correlation over the whole paired series. */
  overall: number;
  medianRolling: number;
  minRolling: number;
  maxRolling: number;
  /** Share of rolling windows above 0.8 — "effectively one instrument". */
  shareAbove80: number;
}

export function summariseCorrelation(a: Bar[], b: Bar[], window?: number): CorrelationSummary {
  const paired = pairedReturns(a, b);
  const rolling = rollingCorrelation(a, b, window).map((p) => p.rho).filter(Number.isFinite);
  rolling.sort((x, y) => x - y);
  const at = (q: number) =>
    rolling.length ? rolling[Math.min(rolling.length - 1, Math.floor(q * rolling.length))] : NaN;
  return {
    pairs: paired.times.length,
    overall: pearson(paired.a, paired.b),
    medianRolling: at(0.5),
    minRolling: rolling[0] ?? NaN,
    maxRolling: rolling[rolling.length - 1] ?? NaN,
    shareAbove80: rolling.length ? rolling.filter((r) => r > 0.8).length / rolling.length : NaN,
  };
}

/* Plain-language restatement, so the number reaches the report rather than
   sitting in a table nobody converts. */
export function describeEffectiveN(nominal: number, effective: number, what = "trades"): string {
  const ratio = nominal ? effective / nominal : 0;
  return (
    `${nominal.toLocaleString()} nominal ${what} ≈ ${Math.round(effective).toLocaleString()} ` +
    `effective (${(ratio * 100).toFixed(0)}%). Significance claims must use the effective count.`
  );
}
