/* Probability of Backtest Overfitting, via Combinatorially Symmetric
 * Cross-Validation (Bailey, Borwein, López de Prado & Zhu).
 *
 * THE QUESTION IT ANSWERS is not "is this strategy good" but "if I pick the
 * best of these N configurations in-sample, how often does it land below the
 * median out-of-sample?" A selection procedure with PBO near 0.5 is choosing
 * at random with extra steps: whatever made a configuration look best on the
 * training half carried no information about the test half.
 *
 * WHY COMBINATORIAL AND NOT A SINGLE SPLIT. One train/test split gives one
 * observation of the selection procedure, which tells you almost nothing about
 * the procedure itself. CSCV forms every balanced split of the sample into
 * halves, so PBO is measured over C(S, S/2) independent selections rather than
 * one lucky or unlucky one.
 *
 * SYMMETRIC means both halves are used as training in different combinations,
 * so no part of the sample is privileged. Note the deliberate consequence: the
 * splits are NOT contiguous in time, so CSCV alone does not protect against
 * leakage from serially correlated labels. That is what purgedCv.ts is for;
 * the two are complementary and the promotion gate requires both.
 */

import { mean, stdevP } from "./gaussian";

export interface PboResult {
  /** Probability the in-sample winner lands below the out-of-sample median. */
  pbo: number;
  /** Number of balanced splits evaluated. */
  combinations: number;
  strategies: number;
  /** Logit of the OOS relative rank, one per split. */
  logits: number[];
  /** Mean in-sample and out-of-sample performance of the selected strategy. */
  meanIsPerformance: number;
  meanOosPerformance: number;
  /** OLS slope of OOS on IS across splits. Negative = degradation. */
  degradationSlope: number;
  /** Share of splits where the selected strategy lost money out of sample. */
  probabilityOfLoss: number;
}

/** All ways to choose k of n indices. */
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (start: number) => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i < n; i++) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

/** Sharpe over a slice. The default CSCV performance measure. */
export function sharpeOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const s = stdevP(xs);
  return s > 0 ? mean(xs) / s : 0;
}

export interface PboOptions {
  /** Number of disjoint sub-samples. Must be even. 16 is the paper's default. */
  splits?: number;
  performance?: (xs: number[]) => number;
}

/* `matrix` is strategies × observations: one row per configuration tried, each
   row the SAME length and aligned on the same observations. Alignment is the
   whole basis of the comparison — rows measured over different periods would
   make the in-sample winner an artefact of who got the easy window. */
export function probabilityOfBacktestOverfitting(
  matrix: number[][],
  opts: PboOptions = {},
): PboResult {
  const perf = opts.performance ?? sharpeOf;
  const S = opts.splits ?? 16;
  const N = matrix.length;
  const T = N ? matrix[0].length : 0;

  const empty: PboResult = {
    pbo: NaN,
    combinations: 0,
    strategies: N,
    logits: [],
    meanIsPerformance: NaN,
    meanOosPerformance: NaN,
    degradationSlope: NaN,
    probabilityOfLoss: NaN,
  };
  if (N < 2 || T < S * 2 || S % 2 !== 0) return empty;
  if (matrix.some((row) => row.length !== T)) {
    throw new Error("PBO: every strategy must be measured over the same observations");
  }

  // Contiguous, equal-size blocks; any remainder is dropped from the tail so
  // every block weighs the same.
  const blockSize = Math.floor(T / S);
  const blocks: number[][] = Array.from({ length: S }, (_, i) =>
    Array.from({ length: blockSize }, (_, j) => i * blockSize + j),
  );

  const logits: number[] = [];
  const isPerf: number[] = [];
  const oosPerf: number[] = [];
  let losses = 0;

  for (const train of combinations(S, S / 2)) {
    const inTrain = new Set(train);
    const trainIdx = train.flatMap((b) => blocks[b]);
    const testIdx = blocks.flatMap((b, i) => (inTrain.has(i) ? [] : b));

    const isScores = matrix.map((row) => perf(trainIdx.map((i) => row[i])));
    const oosScores = matrix.map((row) => perf(testIdx.map((i) => row[i])));

    let best = 0;
    for (let n = 1; n < N; n++) if (isScores[n] > isScores[best]) best = n;

    // Relative rank of the IS winner among OOS scores, in (0,1).
    const rank = oosScores.filter((s) => s < oosScores[best]).length + 1;
    const omega = rank / (N + 1);
    logits.push(Math.log(omega / (1 - omega)));
    isPerf.push(isScores[best]);
    oosPerf.push(oosScores[best]);
    if (mean(testIdx.map((i) => matrix[best][i])) <= 0) losses++;
  }

  // OLS slope of OOS on IS: how much of the in-sample edge survives.
  const mx = mean(isPerf);
  const my = mean(oosPerf);
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < isPerf.length; i++) {
    cov += (isPerf[i] - mx) * (oosPerf[i] - my);
    varx += (isPerf[i] - mx) ** 2;
  }

  return {
    // λ ≤ 0 means the IS winner ranked at or below the OOS median.
    pbo: logits.filter((l) => l <= 0).length / logits.length,
    combinations: logits.length,
    strategies: N,
    logits,
    meanIsPerformance: mx,
    meanOosPerformance: my,
    degradationSlope: varx > 0 ? cov / varx : NaN,
    probabilityOfLoss: losses / logits.length,
  };
}

export const PBO_THRESHOLD = 0.5;

export function describePbo(r: PboResult): string {
  if (!Number.isFinite(r.pbo)) {
    return "Not computable: PBO needs at least two configurations and enough observations to split.";
  }
  const head =
    `PBO ${(r.pbo * 100).toFixed(1)}% over ${r.combinations.toLocaleString()} balanced splits of ` +
    `${r.strategies} configurations. In-sample Sharpe ${r.meanIsPerformance.toFixed(3)} → ` +
    `out-of-sample ${r.meanOosPerformance.toFixed(3)}. `;
  if (r.pbo >= PBO_THRESHOLD) {
    return (
      head +
      "At or above 50%, the selection procedure is no better than picking at random: whatever " +
      "made a configuration best in-sample carried no information about the test half."
    );
  }
  return head + `Below the 50% threshold; the selection carries some information.`;
}
