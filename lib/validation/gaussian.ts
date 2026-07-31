/* Normal distribution helpers and moment estimators.
 *
 * Split out because the Deflated Sharpe Ratio needs BOTH the CDF (to turn a
 * test statistic into a probability) and its inverse (to find the expected
 * maximum of N draws). Getting either subtly wrong would move every
 * significance claim in the codebase without failing anything loudly, so both
 * are pinned against published reference values in tests/validation.test.ts.
 */

/* Standard normal CDF, Abramowitz & Stegun 7.1.26 via erf.
 *
 * ACCURACY: |error| < 1.5e-7 absolute, and ~1e-9 near zero — the polynomial's
 * coefficients do not sum to exactly 1, so erf(0) is 1e-9 rather than 0. That
 * bound is pinned in tests/validation.test.ts rather than left to trust.
 *
 * Adequate for this module's purpose by a wide margin: DSR is compared against
 * a 0.95 threshold and PSR against 0.5, so no decision in this codebase turns
 * on the seventh decimal. Stated explicitly because "how accurate is this
 * really" is exactly the question someone should ask of a hand-rolled CDF
 * sitting under every significance claim. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

/* Inverse standard normal CDF (probit). Acklam's rational approximation,
   refined by one Halley step against normalCdf so the two are mutually
   consistent — which matters because DSR composes them. ~1e-9. */
export function normalInv(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // One Halley refinement against our own CDF.
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : NaN;

/** Population standard deviation (÷n), the convention the DSR formula uses. */
export function stdevP(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

/** Sample standard deviation (÷(n−1)), for the trial-dispersion term. */
export function stdevS(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

/** Fisher-Pearson skewness (third standardised moment). */
export function skewness(xs: number[]): number {
  const s = stdevP(xs);
  if (!(s > 0)) return 0;
  const m = mean(xs);
  return xs.reduce((a, v) => a + ((v - m) / s) ** 3, 0) / xs.length;
}

/* Kurtosis, NON-excess (a normal distribution gives 3). The DSR formula's
   (γ₄ − 1)/4 term assumes this convention; passing excess kurtosis instead
   silently shifts every DSR. */
export function kurtosis(xs: number[]): number {
  const s = stdevP(xs);
  if (!(s > 0)) return 3;
  const m = mean(xs);
  return xs.reduce((a, v) => a + ((v - m) / s) ** 4, 0) / xs.length;
}

/** Euler–Mascheroni constant, used for the expected maximum of N draws. */
export const EULER_MASCHERONI = 0.5772156649015329;
