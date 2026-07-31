import { describe, it, expect } from "vitest";
import {
  EULER_MASCHERONI,
  kurtosis,
  mean,
  normalCdf,
  normalInv,
  skewness,
  stdevP,
} from "@/lib/validation/gaussian";
import {
  DSR_THRESHOLD,
  HLZ_T_HURDLE,
  deflatedSharpe,
  describeDeflated,
  expectedMaxSharpe,
  minimumBacktestLength,
  probabilisticSharpe,
  sharpeMoments,
  trialSharpeDispersion,
} from "@/lib/validation/deflatedSharpe";
import {
  combinations,
  probabilityOfBacktestOverfitting,
  sharpeOf,
} from "@/lib/validation/pbo";
import {
  DEFAULT_EMBARGO_SEC,
  combinatorialPurgedCv,
  cpcvPaths,
  purgedKFold,
  summariseFolds,
  timeGroups,
  type LabelledObservation,
} from "@/lib/validation/purgedCv";
import {
  GATE,
  REFUTED_STREAM_EVIDENCE,
  evaluatePromotion,
} from "@/lib/validation/promotionGate";
import { mulberry32 } from "@/scripts/engine/montecarlo";

/* ── Gaussian primitives ─────────────────────────────────────────────────
   Pinned against textbook values. Everything downstream composes these, so an
   error here would move every significance claim without failing loudly. */
describe("normalCdf / normalInv", () => {
  it("matches standard normal table values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 8);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-2.5758)).toBeCloseTo(0.005, 5);
  });

  /* Pins the approximation's actual accuracy rather than trusting the comment.
     A&S 7.1.26 is good to ~1.5e-7 absolute; no threshold in this codebase
     (DSR 0.95, PSR 0.5, PBO 0.5) turns on anything near that. */
  it("stays within its documented 1.5e-7 error bound across the range", () => {
    const reference: [number, number][] = [
      [-3, 0.001349898], [-2, 0.022750132], [-1, 0.158655254], [-0.5, 0.308537539],
      [0, 0.5], [0.5, 0.691462461], [1, 0.841344746], [2, 0.977249868], [3, 0.998650102],
    ];
    for (const [x, expected] of reference) {
      expect(Math.abs(normalCdf(x) - expected)).toBeLessThan(1.5e-7);
    }
  });

  it("is symmetric, so the two tails cannot disagree", () => {
    for (const x of [0.25, 1, 1.96, 2.5, 3.5]) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 7);
    }
  });

  it("inverts the classic critical values", () => {
    expect(normalInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalInv(0.95)).toBeCloseTo(1.644854, 5);
    expect(normalInv(0.5)).toBeCloseTo(0, 8);
    expect(normalInv(0.005)).toBeCloseTo(-2.575829, 5);
  });

  it("round-trips against its own CDF", () => {
    for (const p of [0.001, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999]) {
      expect(normalCdf(normalInv(p))).toBeCloseTo(p, 8);
    }
  });

  it("returns infinities at the boundaries rather than NaN", () => {
    expect(normalInv(0)).toBe(-Infinity);
    expect(normalInv(1)).toBe(Infinity);
  });
});

describe("moment estimators", () => {
  it("reports NON-excess kurtosis, so a normal series gives ~3", () => {
    const rand = mulberry32(9);
    // Box-Muller normal draws.
    const xs = Array.from({ length: 20000 }, () => {
      const u = Math.max(1e-12, rand());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    });
    expect(mean(xs)).toBeCloseTo(0, 1);
    expect(stdevP(xs)).toBeCloseTo(1, 1);
    expect(skewness(xs)).toBeCloseTo(0, 1);
    expect(kurtosis(xs)).toBeGreaterThan(2.8);
    expect(kurtosis(xs)).toBeLessThan(3.2);
  });

  it("detects the negative skew a stop-loss book actually has", () => {
    // Many small wins, occasional large loss.
    const xs = [...Array(90).fill(1), ...Array(10).fill(-9)];
    expect(skewness(xs)).toBeLessThan(-1);
  });
});

/* ── Deflated Sharpe ─────────────────────────────────────────────────────*/
describe("expectedMaxSharpe", () => {
  /* The load-bearing intuition: selection alone manufactures Sharpe. With unit
     dispersion, ten trials expect ~1.74 and a hundred ~2.51 from nothing. */
  it("grows with the trial count", () => {
    expect(expectedMaxSharpe(1, 1)).toBe(0);
    const ten = expectedMaxSharpe(10, 1);
    const hundred = expectedMaxSharpe(100, 1);
    expect(ten).toBeGreaterThan(1.5);
    expect(ten).toBeLessThan(2);
    expect(hundred).toBeGreaterThan(ten);
    expect(hundred).toBeGreaterThan(2.3);
  });

  it("scales linearly with trial dispersion", () => {
    expect(expectedMaxSharpe(50, 2)).toBeCloseTo(2 * expectedMaxSharpe(50, 1), 9);
  });

  it("is zero when every trial produced the same Sharpe", () => {
    expect(expectedMaxSharpe(100, 0)).toBe(0);
  });

  it("uses the Euler-Mascheroni weighting", () => {
    const n = 25;
    const expected =
      (1 - EULER_MASCHERONI) * normalInv(1 - 1 / n) +
      EULER_MASCHERONI * normalInv(1 - 1 / (n * Math.E));
    expect(expectedMaxSharpe(n, 1)).toBeCloseTo(expected, 12);
  });
});

describe("probabilisticSharpe", () => {
  const positive = Array.from({ length: 500 }, (_, i) => 0.1 + Math.sin(i) * 0.5);

  it("is high for a clearly positive series", () => {
    expect(probabilisticSharpe(sharpeMoments(positive), 0)).toBeGreaterThan(0.95);
  });

  it("falls as the benchmark rises", () => {
    const m = sharpeMoments(positive);
    expect(probabilisticSharpe(m, 0)).toBeGreaterThan(probabilisticSharpe(m, 0.15));
  });

  it("is 0.5 when the Sharpe exactly equals the benchmark", () => {
    const m = sharpeMoments(positive);
    expect(probabilisticSharpe(m, m.sharpe)).toBeCloseTo(0.5, 6);
  });

  /* Negative skew and fat tails must REDUCE confidence — that is the whole
     reason PSR is not a plain t-test, and it is the shape a stop-loss book
     has. Two series with the same Sharpe, different third moment. */
  it("penalises negative skew at equal Sharpe", () => {
    const symmetric = [...Array(100).fill(1), ...Array(100).fill(-0.8)];
    const skewed = [...Array(180).fill(0.2), ...Array(20).fill(-1.5)];
    const a = sharpeMoments(symmetric);
    const b = sharpeMoments(skewed);
    // Compare at a shared benchmark, holding sample size equal.
    expect(b.skew).toBeLessThan(a.skew);
    expect(probabilisticSharpe(b, 0)).toBeLessThan(probabilisticSharpe(a, 0) + 1e-9);
  });
});

describe("deflatedSharpe", () => {
  const rand = mulberry32(3);
  const noise = Array.from({ length: 1000 }, () => rand() - 0.5);

  it("refuses to call pure noise significant", () => {
    const r = deflatedSharpe(noise, 50, 0.3);
    expect(r.dsr).toBeLessThan(DSR_THRESHOLD);
    expect(r.significant).toBe(false);
  });

  /* The core claim: the same returns become less significant the more things
     you tried to find them. */
  it("deflates the same series further as the trial count grows", () => {
    const good = Array.from({ length: 1000 }, (_, i) => 0.04 + (rand() - 0.5) * 0.6 + i * 0);
    const few = deflatedSharpe(good, 2, 0.3);
    const many = deflatedSharpe(good, 500, 0.3);
    expect(many.expectedMaxSharpe).toBeGreaterThan(few.expectedMaxSharpe);
    expect(many.dsr).toBeLessThan(few.dsr);
    expect(many.sharpe).toBeCloseTo(few.sharpe, 12); // the strategy did not change
  });

  it("requires BOTH the DSR threshold and the t hurdle", () => {
    const r = deflatedSharpe(noise, 2, 0.05);
    // Force each condition independently and confirm the conjunction.
    expect(deflatedSharpe(noise, 2, 0.05).significant).toBe(
      r.dsr > DSR_THRESHOLD && r.tStat > HLZ_T_HURDLE,
    );
  });

  it("names which hurdle failed", () => {
    expect(describeDeflated(deflatedSharpe(noise, 100, 0.4))).toMatch(/Clears neither|Clears DSR|Clears t/);
  });

  it("computes trial dispersion from the Sharpes actually tried", () => {
    expect(trialSharpeDispersion([1, 1, 1])).toBeCloseTo(0, 9);
    expect(trialSharpeDispersion([0, 1, 2])).toBeCloseTo(1, 9);
    expect(trialSharpeDispersion([1])).toBe(0);
  });
});

describe("minimumBacktestLength", () => {
  it("grows with trials and shrinks with the target Sharpe", () => {
    expect(minimumBacktestLength(100, 1)).toBeGreaterThan(minimumBacktestLength(10, 1));
    expect(minimumBacktestLength(100, 2)).toBeLessThan(minimumBacktestLength(100, 1));
  });

  it("is infinite for a non-positive target — no data rescues no edge", () => {
    expect(minimumBacktestLength(100, 0)).toBe(Infinity);
    expect(minimumBacktestLength(100, -1)).toBe(Infinity);
  });
});

/* ── PBO ─────────────────────────────────────────────────────────────────*/
describe("combinations", () => {
  it("enumerates C(n,k) without repeats", () => {
    expect(combinations(4, 2)).toEqual([
      [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
    ]);
    expect(combinations(16, 8)).toHaveLength(12870);
  });
});

describe("probabilityOfBacktestOverfitting", () => {
  const T = 320;

  it("is near 0.5 when every configuration is pure noise", () => {
    const rand = mulberry32(11);
    const matrix = Array.from({ length: 8 }, () =>
      Array.from({ length: T }, () => rand() - 0.5),
    );
    const r = probabilityOfBacktestOverfitting(matrix, { splits: 8 });
    // Selection among noise carries no information: the IS winner lands on
    // either side of the OOS median about equally often.
    expect(r.pbo).toBeGreaterThan(0.25);
    expect(r.pbo).toBeLessThan(0.75);
    expect(r.combinations).toBe(combinations(8, 4).length);
  });

  it("is low when one configuration genuinely dominates throughout", () => {
    const rand = mulberry32(13);
    const matrix = Array.from({ length: 8 }, (_, s) =>
      Array.from({ length: T }, () => (s === 0 ? 0.5 : 0) + (rand() - 0.5) * 0.2),
    );
    const r = probabilityOfBacktestOverfitting(matrix, { splits: 8 });
    expect(r.pbo).toBeLessThan(0.1);
    expect(r.degradationSlope).not.toBeNaN();
  });

  it("reports out-of-sample degradation and loss probability", () => {
    const rand = mulberry32(17);
    const matrix = Array.from({ length: 6 }, () =>
      Array.from({ length: T }, () => rand() - 0.5),
    );
    const r = probabilityOfBacktestOverfitting(matrix, { splits: 8 });
    expect(r.meanIsPerformance).toBeGreaterThan(r.meanOosPerformance);
    expect(r.probabilityOfLoss).toBeGreaterThanOrEqual(0);
    expect(r.probabilityOfLoss).toBeLessThanOrEqual(1);
  });

  it("refuses ragged input rather than silently comparing different periods", () => {
    expect(() =>
      probabilityOfBacktestOverfitting([Array(100).fill(1), Array(90).fill(1)], { splits: 4 }),
    ).toThrow(/same observations/);
  });

  it("returns NaN rather than a number it cannot support", () => {
    expect(probabilityOfBacktestOverfitting([[1, 2, 3]], { splits: 4 }).pbo).toBeNaN();
    expect(probabilityOfBacktestOverfitting([], { splits: 4 }).pbo).toBeNaN();
  });

  it("sharpeOf is zero for a constant series rather than infinite", () => {
    expect(sharpeOf([1, 1, 1, 1])).toBe(0);
  });
});

/* ── Purged CV ───────────────────────────────────────────────────────────*/
describe("purged k-fold", () => {
  const DAY = 86400;
  // 200 trades, one per day, each resolving 12 hours after it opens.
  const obs: LabelledObservation[] = Array.from({ length: 200 }, (_, i) => ({
    t0: i * DAY,
    t1: i * DAY + DAY / 2,
  }));

  it("splits into contiguous time groups", () => {
    const g = timeGroups(10, 5);
    expect(g).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]]);
  });

  it("never puts a training index in the test set", () => {
    for (const f of purgedKFold(obs, 5, 0)) {
      const test = new Set(f.test);
      for (const i of f.train) expect(test.has(i)).toBe(false);
    }
  });

  /* The core guarantee: no training observation may overlap the test window. */
  it("purges every training observation overlapping the test window", () => {
    for (const f of purgedKFold(obs, 5, 0)) {
      for (const i of f.train) {
        const overlaps = obs[i].t1 >= f.testFrom && obs[i].t0 <= f.testTo;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("embargoes training observations just after the test window", () => {
    const embargo = 10 * DAY;
    for (const f of purgedKFold(obs, 5, embargo)) {
      for (const i of f.train) {
        const inEmbargo = obs[i].t0 > f.testTo && obs[i].t0 <= f.testTo + embargo;
        expect(inEmbargo).toBe(false);
      }
    }
  });

  it("embargoes forward in time only", () => {
    // Observations BEFORE the test window are kept: information flows forward,
    // so an earlier trade cannot be contaminated by a later test window.
    const folds = purgedKFold(obs, 5, 30 * DAY);
    const middle = folds[2];
    expect(middle.train.some((i) => obs[i].t1 < middle.testFrom)).toBe(true);
  });

  it("drops more data as the embargo lengthens", () => {
    const short = summariseFolds(purgedKFold(obs, 5, 0), obs.length);
    const long = summariseFolds(purgedKFold(obs, 5, 30 * DAY), obs.length);
    expect(long.totalEmbargoed).toBeGreaterThan(short.totalEmbargoed);
    expect(long.meanTrain).toBeLessThan(short.meanTrain);
  });

  it("defaults the embargo to roughly one trading month", () => {
    expect(DEFAULT_EMBARGO_SEC).toBe(21 * DAY);
  });

  it("returns nothing rather than a degenerate fold for tiny samples", () => {
    expect(purgedKFold(obs.slice(0, 2), 5)).toEqual([]);
    expect(purgedKFold(obs, 1)).toEqual([]);
  });

  /* A long-held position must purge far more than a short one — this is the
     leak ordinary k-fold misses entirely. */
  it("purges more when trades are held longer", () => {
    const longHeld = obs.map((o, i) => ({ t0: o.t0, t1: o.t0 + 20 * DAY + i * 0 }));
    const shortP = summariseFolds(purgedKFold(obs, 5, 0), obs.length).totalPurged;
    const longP = summariseFolds(purgedKFold(longHeld, 5, 0), obs.length).totalPurged;
    expect(longP).toBeGreaterThan(shortP);
  });
});

describe("combinatorial purged CV", () => {
  const DAY = 86400;
  const obs: LabelledObservation[] = Array.from({ length: 300 }, (_, i) => ({
    t0: i * DAY,
    t1: i * DAY + DAY / 2,
  }));

  it("produces C(groups, testGroups) folds", () => {
    expect(combinatorialPurgedCv(obs, 6, 2, 0)).toHaveLength(15);
  });

  /* The reason CPCV exists: walk-forward gives ONE out-of-sample path, and one
     path is one draw you cannot judge. */
  it("yields many out-of-sample paths, not one", () => {
    expect(cpcvPaths(6, 2)).toBe(5);
    expect(cpcvPaths(10, 2)).toBe(9);
    expect(cpcvPaths(2, 1)).toBe(1);
  });

  it("still purges overlaps in every fold", () => {
    for (const f of combinatorialPurgedCv(obs, 6, 2, 0)) {
      for (const i of f.train) {
        expect(obs[i].t1 >= f.testFrom && obs[i].t0 <= f.testTo).toBe(false);
      }
    }
  });

  it("rejects impossible configurations rather than guessing", () => {
    expect(combinatorialPurgedCv(obs, 6, 6, 0)).toEqual([]);
    expect(combinatorialPurgedCv(obs, 1, 1, 0)).toEqual([]);
    expect(cpcvPaths(6, 6)).toBe(0);
  });
});

/* ── The promotion gate ──────────────────────────────────────────────────*/
describe("promotion gate", () => {
  const passing = {
    randomEntryPercentile: 97,
    deflated: { dsr: 0.98, tStat: 3.4, trials: 40 } as never,
    pbo: { pbo: 0.2 } as never,
    oosNetExpectancy: 12.5,
    cvFoldSurvival: 0.8,
    trades: 400,
  };

  it("promotes only when every check passes", () => {
    expect(evaluatePromotion(passing).promote).toBe(true);
  });

  it("blocks on any single failure and names it", () => {
    const v = evaluatePromotion({ ...passing, randomEntryPercentile: 60 });
    expect(v.promote).toBe(false);
    expect(v.failed).toContain("randomEntry");
  });

  /* The distinction that keeps a gate from becoming decoration. */
  it("never counts an unmeasured check as a pass", () => {
    const v = evaluatePromotion({ ...passing, pbo: null });
    expect(v.promote).toBe(false);
    expect(v.evidenceGaps).toContain("pbo");
    expect(v.failed).not.toContain("pbo");
    expect(v.summary).toMatch(/not measured/);
  });

  it("blocks a strategy that only clears DSR but not the t hurdle", () => {
    const v = evaluatePromotion({
      ...passing,
      deflated: { dsr: 0.99, tStat: 1.2, trials: 40 } as never,
    });
    expect(v.promote).toBe(false);
    expect(v.failed).toContain("tStat");
  });

  it("blocks on a thin sample even when everything else passes", () => {
    expect(evaluatePromotion({ ...passing, trades: 20 }).failed).toContain("trades");
  });

  /* Exercised in the direction that matters: a gate first tried on something
     you want to promote has never been tested. */
  it("refuses all three refuted live streams", () => {
    for (const [key, evidence] of Object.entries(REFUTED_STREAM_EVIDENCE)) {
      const v = evaluatePromotion(evidence);
      expect(v.promote, `${key} must not be promotable`).toBe(false);
      expect(v.failed).toContain("randomEntry");
      expect(v.failed).toContain("oosNetExpectancy");
    }
  });

  it("publishes the thresholds it used", () => {
    expect(GATE.randomEntryPercentile).toBe(95);
    expect(GATE.pbo).toBe(0.5);
    const v = evaluatePromotion(passing);
    for (const c of v.checks) expect(Number.isFinite(c.threshold)).toBe(true);
  });
});
