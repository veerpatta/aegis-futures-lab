/* Monte Carlo drawdown check for the monthly tune. A parameter set that
   improves PF can still carry uglier tail risk; resampling the trade
   sequence with replacement shows the drawdown distribution the same
   trades could produce in a different order/mix. Deterministic RNG so a
   re-run of the same tune prints the same numbers. */

/** Peak-to-trough drawdown of the cumulative P&L curve (≥ 0). */
export function maxDrawdown(pnls: number[]): number {
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    if (peak - equity > dd) dd = peak - equity;
  }
  return dd;
}

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DrawdownDistribution {
  median: number;
  p95: number;
}

/** Resample the trade sequence with replacement `n` times; report the
    median and 95th-percentile max drawdown across resamples. */
export function resampleDrawdowns(pnls: number[], n = 1000, seed = 42): DrawdownDistribution {
  if (!pnls.length) return { median: 0, p95: 0 };
  const rand = mulberry32(seed);
  const dds: number[] = new Array(n);
  const sample: number[] = new Array(pnls.length);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < pnls.length; j++) sample[j] = pnls[Math.floor(rand() * pnls.length)];
    dds[i] = maxDrawdown(sample);
  }
  dds.sort((a, b) => a - b);
  return {
    median: dds[Math.floor(n / 2)],
    p95: dds[Math.min(n - 1, Math.floor(n * 0.95))],
  };
}
