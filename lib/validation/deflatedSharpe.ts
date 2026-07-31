/* Deflated Sharpe Ratio, Probabilistic Sharpe Ratio, and minimum backtest
 * length (Bailey & López de Prado).
 *
 * THE PROBLEM THIS SOLVES. A Sharpe ratio computed on the best of N tried
 * configurations is not the Sharpe of a strategy — it is the maximum of N
 * draws, and the maximum of N draws from a zero-mean distribution is
 * comfortably positive for any N worth mentioning. Deflating means asking
 * whether the observed Sharpe beats what selection alone would have produced.
 *
 * THE TRIAL COUNT MUST BE HONEST OR THIS IS THEATRE. N is read from the
 * research_trials registry, not passed as a convenient constant. That is the
 * whole reason the registry was built early and made write-once: a trial that
 * was run and not logged silently inflates every DSR computed afterwards, and
 * there is no way to recover it later.
 *
 * The returns series here is PER TRADE, not per day. Sharpe is therefore in
 * per-trade units unless the caller annualises; nothing in this module
 * annualises silently.
 */

import { EULER_MASCHERONI, kurtosis, mean, normalCdf, normalInv, skewness, stdevP, stdevS } from "./gaussian";

export interface SharpeMoments {
  sharpe: number;
  n: number;
  skew: number;
  /** NON-excess kurtosis: a normal series gives 3. */
  kurtosis: number;
}

export function sharpeMoments(returns: number[]): SharpeMoments {
  const s = stdevP(returns);
  return {
    sharpe: s > 0 ? mean(returns) / s : 0,
    n: returns.length,
    skew: skewness(returns),
    kurtosis: kurtosis(returns),
  };
}

/* Probabilistic Sharpe Ratio: P(true SR > benchmark), correcting for sample
 * length, skew and fat tails.
 *
 *   PSR(SR*) = Z[ (SR − SR*)·sqrt(n−1) / sqrt(1 − γ₃·SR + (γ₄−1)/4·SR²) ]
 *
 * The denominator is why this is not just a t-test: negative skew and fat
 * tails inflate it, which is exactly the shape a stop-loss strategy produces
 * (many small wins, occasional large losses), and ignoring it overstates
 * confidence on precisely the strategies most likely to be wrong.
 */
export function probabilisticSharpe(m: SharpeMoments, benchmark = 0): number {
  if (m.n < 2) return NaN;
  const variance = 1 - m.skew * m.sharpe + ((m.kurtosis - 1) / 4) * m.sharpe ** 2;
  if (!(variance > 0)) return NaN;
  return normalCdf(((m.sharpe - benchmark) * Math.sqrt(m.n - 1)) / Math.sqrt(variance));
}

/* Expected MAXIMUM Sharpe from `trials` independent attempts whose Sharpes
 * have dispersion `trialSharpeStdev`. This is the benchmark a real strategy
 * has to beat.
 *
 *   E[max SR] ≈ σ · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
 *
 * Note how fast it grows: with σ = 1, ten trials expect ~1.74 and a hundred
 * expect ~2.51 purely from selection. Quoting an undeflated Sharpe of 2 after
 * a hundred trials is quoting noise.
 */
export function expectedMaxSharpe(trials: number, trialSharpeStdev: number): number {
  const n = Math.max(1, Math.floor(trials));
  if (n === 1) return 0;
  const g = EULER_MASCHERONI;
  return (
    trialSharpeStdev *
    ((1 - g) * normalInv(1 - 1 / n) + g * normalInv(1 - 1 / (n * Math.E)))
  );
}

export interface DeflatedSharpeResult {
  sharpe: number;
  n: number;
  skew: number;
  kurtosis: number;
  trials: number;
  trialSharpeStdev: number;
  /** The selection-adjusted hurdle this Sharpe had to clear. */
  expectedMaxSharpe: number;
  /** P(true SR > 0), before any trial-count correction. */
  psr: number;
  /** P(true SR > expectedMaxSharpe). The number that matters. */
  dsr: number;
  /** Implied t-statistic, for the Harvey/Liu/Zhu > 3.0 comparison. */
  tStat: number;
  significant: boolean;
}

export const DSR_THRESHOLD = 0.95;

/* Harvey, Liu & Zhu (RFS 2016) argue a new factor needs t > ~3.0 to be
   credible given the search intensity in the literature. Applied here as a
   second, independent hurdle rather than a replacement for DSR — they answer
   different questions and a candidate should clear both. */
export const HLZ_T_HURDLE = 3.0;

export function deflatedSharpe(
  returns: number[],
  trials: number,
  trialSharpeStdev: number,
): DeflatedSharpeResult {
  const m = sharpeMoments(returns);
  const hurdle = expectedMaxSharpe(trials, trialSharpeStdev);
  const dsr = probabilisticSharpe(m, hurdle);
  // t = SR·sqrt(n−1) under the same variance correction PSR uses.
  const variance = 1 - m.skew * m.sharpe + ((m.kurtosis - 1) / 4) * m.sharpe ** 2;
  const tStat = variance > 0 ? (m.sharpe * Math.sqrt(m.n - 1)) / Math.sqrt(variance) : NaN;
  return {
    sharpe: m.sharpe,
    n: m.n,
    skew: m.skew,
    kurtosis: m.kurtosis,
    trials,
    trialSharpeStdev,
    expectedMaxSharpe: hurdle,
    psr: probabilisticSharpe(m, 0),
    dsr,
    tStat,
    significant: dsr > DSR_THRESHOLD && tStat > HLZ_T_HURDLE,
  };
}

/** Dispersion of the Sharpes actually tried — the σ in expectedMaxSharpe. */
export const trialSharpeDispersion = (sharpes: number[]): number =>
  sharpes.length > 1 ? stdevS(sharpes) : 0;

/* Minimum backtest length, in the same time unit as the returns series.
 *
 * "How much data would I need before a Sharpe this size stops being
 * explainable by having tried N things?" If your sample is shorter than this,
 * the result cannot be distinguished from selection no matter how good it
 * looks. Returns Infinity for a non-positive target Sharpe — no amount of data
 * rescues a strategy with no edge.
 */
export function minimumBacktestLength(trials: number, targetSharpe: number): number {
  if (!(targetSharpe > 0)) return Infinity;
  const n = Math.max(2, Math.floor(trials));
  const g = EULER_MASCHERONI;
  const z = (1 - g) * normalInv(1 - 1 / n) + g * normalInv(1 - 1 / (n * Math.E));
  return (z / targetSharpe) ** 2;
}

/* Plain-language verdict. Deliberately refuses to call a result significant on
   DSR alone when the t-statistic misses the hurdle, and says which one failed
   — "it passed one of two tests" is the kind of thing that gets rounded up to
   "it passed" if the report does not spell it out. */
export function describeDeflated(r: DeflatedSharpeResult): string {
  if (!Number.isFinite(r.dsr)) return "Not computable: the return series is degenerate.";
  const head =
    `Sharpe ${r.sharpe.toFixed(3)} over ${r.n.toLocaleString()} trades, against a ` +
    `selection hurdle of ${r.expectedMaxSharpe.toFixed(3)} from ${r.trials} logged trials. ` +
    `DSR ${(r.dsr * 100).toFixed(1)}%, t=${r.tStat.toFixed(2)}. `;
  if (r.significant) return head + "Clears both the DSR threshold and the t>3 hurdle.";
  if (r.dsr > DSR_THRESHOLD) return head + `Clears DSR but not the t>${HLZ_T_HURDLE} hurdle.`;
  if (r.tStat > HLZ_T_HURDLE) return head + "Clears t>3 but not DSR after the trial-count correction.";
  return head + "Clears neither. Not distinguishable from the best of the trials already run.";
}
