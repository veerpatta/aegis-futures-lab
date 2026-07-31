/* Purged k-fold and Combinatorial Purged Cross-Validation (López de Prado).
 *
 * WHY ORDINARY K-FOLD IS WRONG FOR THIS DATA. A trade is not a point in time,
 * it is an INTERVAL: it opens at t₀ and its outcome is only known at t₁. If a
 * training trade is still open when a test trade begins, the two overlap and
 * the training set contains information about the test period. Ordinary k-fold
 * shuffles that leak in everywhere and reports an out-of-sample score that is
 * partly in-sample.
 *
 * TWO SEPARATE FIXES, both needed:
 *
 *   PURGE — drop training observations whose [t₀, t₁] interval overlaps the
 *   test window at all. This removes direct label leakage.
 *
 *   EMBARGO — additionally drop a buffer of training observations immediately
 *   AFTER the test window. Purging alone does not handle serial correlation:
 *   a trade that opens the day after the test window ends is not overlapping,
 *   but on autocorrelated intraday data it is close to the same draw. The
 *   brief specifies roughly one trading month.
 *
 * CPCV extends this to multiple paths: instead of one train/test split per
 * fold, it takes every combination of k groups as the test set, which yields
 * many out-of-sample paths rather than the single one walk-forward gives.
 * Multiple paths matter because a single OOS path is itself one draw — a
 * strategy can survive it by luck, and you cannot tell from one number.
 */

import { combinations } from "./pbo";

/** An observation with a known outcome interval, in unix seconds. */
export interface LabelledObservation {
  t0: number;
  t1: number;
}

/** One trading month, the brief's embargo suggestion. */
export const DEFAULT_EMBARGO_SEC = 21 * 24 * 3600;

export interface Fold {
  /** Indices used for testing. */
  test: number[];
  /** Indices used for training, after purge and embargo. */
  train: number[];
  /** Dropped by purge (overlapping) and by embargo (too soon after). */
  purged: number;
  embargoed: number;
  testFrom: number;
  testTo: number;
}

/* Contiguous, time-ordered groups. Observations MUST already be sorted by t0;
   grouping shuffled data would make "contiguous" meaningless and silently
   defeat the purge. */
export function timeGroups(n: number, groups: number): number[][] {
  const out: number[][] = [];
  const size = n / groups;
  for (let g = 0; g < groups; g++) {
    const from = Math.floor(g * size);
    const to = Math.floor((g + 1) * size);
    out.push(Array.from({ length: to - from }, (_, i) => from + i));
  }
  return out.filter((g) => g.length > 0);
}

function buildFold(
  obs: LabelledObservation[],
  testIdx: number[],
  embargoSec: number,
): Fold {
  const testSet = new Set(testIdx);
  // The test window spans from the earliest open to the latest close, because
  // a trade opening inside the window can resolve outside it.
  let testFrom = Infinity;
  let testTo = -Infinity;
  for (const i of testIdx) {
    testFrom = Math.min(testFrom, obs[i].t0);
    testTo = Math.max(testTo, obs[i].t1);
  }

  const train: number[] = [];
  let purged = 0;
  let embargoed = 0;
  for (let i = 0; i < obs.length; i++) {
    if (testSet.has(i)) continue;
    const { t0, t1 } = obs[i];
    // Overlap in either direction, including containment.
    if (t1 >= testFrom && t0 <= testTo) {
      purged++;
      continue;
    }
    // Embargo only AFTER the test window: information flows forward in time,
    // so a trade before the window cannot be contaminated by it.
    if (t0 > testTo && t0 <= testTo + embargoSec) {
      embargoed++;
      continue;
    }
    train.push(i);
  }
  return { test: testIdx, train, purged, embargoed, testFrom, testTo };
}

/** Purged k-fold with an embargo. One test group per fold. */
export function purgedKFold(
  obs: LabelledObservation[],
  k = 5,
  embargoSec = DEFAULT_EMBARGO_SEC,
): Fold[] {
  if (obs.length < k || k < 2) return [];
  return timeGroups(obs.length, k).map((g) => buildFold(obs, g, embargoSec));
}

/* Combinatorial Purged CV: every combination of `testGroups` of `groups` is a
   test set, so N groups choose k test groups gives C(N,k) folds and
   C(N,k)·k/N distinct out-of-sample paths. Defaults (6 groups, 2 test) give
   15 folds and 5 paths — far more than walk-forward's single path, at a cost
   that stays tractable. */
export function combinatorialPurgedCv(
  obs: LabelledObservation[],
  groups = 6,
  testGroups = 2,
  embargoSec = DEFAULT_EMBARGO_SEC,
): Fold[] {
  if (obs.length < groups || groups < 2 || testGroups < 1 || testGroups >= groups) return [];
  const g = timeGroups(obs.length, groups);
  return combinations(g.length, testGroups).map((combo) =>
    buildFold(obs, combo.flatMap((i) => g[i]).sort((a, b) => a - b), embargoSec),
  );
}

/** Number of distinct out-of-sample paths CPCV produces. */
export function cpcvPaths(groups: number, testGroups: number): number {
  if (groups < 2 || testGroups < 1 || testGroups >= groups) return 0;
  return (combinations(groups, testGroups).length * testGroups) / groups;
}

export interface CvSummary {
  folds: number;
  meanTrain: number;
  meanTest: number;
  totalPurged: number;
  totalEmbargoed: number;
  /** Share of the sample discarded to prevent leakage. */
  discardedShare: number;
}

export function summariseFolds(folds: Fold[], total: number): CvSummary {
  if (!folds.length) {
    return { folds: 0, meanTrain: 0, meanTest: 0, totalPurged: 0, totalEmbargoed: 0, discardedShare: 0 };
  }
  const sum = (f: (x: Fold) => number) => folds.reduce((a, x) => a + f(x), 0);
  const purged = sum((f) => f.purged);
  const embargoed = sum((f) => f.embargoed);
  return {
    folds: folds.length,
    meanTrain: sum((f) => f.train.length) / folds.length,
    meanTest: sum((f) => f.test.length) / folds.length,
    totalPurged: purged,
    totalEmbargoed: embargoed,
    discardedShare: total ? (purged + embargoed) / (folds.length * total) : 0,
  };
}

/* Run a scoring function over every fold. `score` receives training and test
   index arrays and returns whatever performance number the caller cares about;
   this module deliberately does not know what a "good" score is. */
export function runFolds<T>(folds: Fold[], score: (fold: Fold) => T): T[] {
  return folds.map(score);
}
