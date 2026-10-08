import { describe, expect, it } from "vitest";
import { trainLogit } from "@/scripts/engine/winprob";
import { FEATURE_SETS, TAKE_ALL_V1, evThreshold, scoreOpportunity, trainChallenger, trainLogitL2, validateArtifact, ModelOutputError } from "@/lib/experiment/models";
import { matchedRandomPercentile, maxDrawdown, sessionBootstrapMean, stressDrawdownP95 } from "@/lib/experiment/stats";
import { adoptionDecision, evidenceRows, rollbackDecision, verdictOf, walkForward, type EvalRow, type Metrics } from "@/lib/experiment/evaluate";
import { pickChallengers, searchSpace, specHash, inSearchSpace } from "@/lib/experiment/search";
import { buildEvalRows, datasetFor, weekKeyOf } from "@/lib/experiment/learning";
import { quotaLevel, allowed, searchBudget } from "@/lib/experiment/quota";
import { PREREG } from "@/lib/experiment/prereg";
import { mulberry32 } from "@/scripts/engine/montecarlo";
import { createFitCache } from "@/lib/experiment/fit-cache";
import { fitLogit } from "@/lib/experiment/models";
import { auditLearningData } from "@/lib/experiment/learning-audit";
import type { Decision, FrozenFeatures, Outcome } from "@/lib/experiment/types";

const feat = (i: number, over: Partial<FrozenFeatures> = {}): FrozenFeatures => ({
  tier: i % 2 ? "A" : "B", regime: ["trend-high-vol", "range-low-vol"][i % 2], vix_bucket: "low", score: (i % 7) / 3, rr: 1.5 + (i % 3) / 2,
  signal_ts: new Date(Date.UTC(2026, 5, 1 + Math.floor(i / 4), 14 + (i % 4))).toISOString(), symbol: i % 3 ? "MES" : "MNQ", strategy: "zone-v5",
  atr_pct: 0.1 + (i % 5) / 50, vwap_atr: ((i % 9) - 4) / 2, ...over,
});

/** Rows where `score` genuinely predicts the outcome (for the learner to find). */
function rows(n: number, seed = 1, signal = true): EvalRow[] {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const f = feat(i);
    const good = signal ? (f.score ?? 0) > 1 : rand() > 0.5;
    const win = (signal ? rand() < (good ? 0.8 : 0.2) : good) ? 1 : 0;
    const net = win ? 60 : -50;
    const day = Math.floor(i / 4);
    const decidedAt = Date.UTC(2026, 5, 1 + day, 15) / 1000;
    return {
      key: `k${i}`, session: new Date((decidedAt - 4 * 3600) * 1000).toISOString().slice(0, 10), decidedAt, exitTs: decidedAt + 3600, features: f, win,
      net, netPerContract: net, frictionPerContract: 3.65, standaloneQty: 1, provenance: "prospective",
    } as EvalRow;
  });
}

describe("experiment models", () => {
  it("reuses identical effective windows with exactly the same coefficients and thresholds", () => {
    const r = rows(120).map(x => ({ features: x.features, win: x.win, net: x.net, sessionKey: x.session }));
    const cache = createFitCache();
    for (const windowSessions of [null, 60, 120]) {
      const spec = { windowSessions, featureSet: "v2" as const, l2: 0.01 };
      expect(cache.fit(spec, r)).toEqual(fitLogit(spec, r));
    }
    expect(cache.stats).toEqual({ computed: 1, reused: 2 });
    // Content, not object identity. Changed costs, labels and features must miss.
    const spec = { windowSessions: null, featureSet: "v2" as const, l2: 0.01 };
    cache.fit(spec, structuredClone(r));
    for (const patch of [{ net: r[0].net + 1 }, { win: (1 - r[0].win) as 0 | 1 }, { features: { ...r[0].features, score: 99 } }])
      cache.fit(spec, [{ ...r[0], ...patch }, ...r.slice(1)]);
    expect(cache.stats).toEqual({ computed: 4, reused: 3 });
    cache.fit({ ...spec, windowSessions: 10 }, r);
    cache.fit({ ...spec, l2: 0.1 }, r);
    expect(cache.stats.computed).toBe(6);
  });

  it("bounds the cache and produces identical walk-forward evidence with reuse enabled", () => {
    const r = rows(320), spec = { windowSessions: null, featureSet: "v1" as const, l2: 0.01 };
    const cache = createFitCache(1);
    const opts = { seedKey: "cache-parity", comparisons: 3 };
    expect(walkForward(r, spec, TAKE_ALL_V1, { ...opts, fitModel: cache.fit })).toEqual(walkForward(r, spec, TAKE_ALL_V1, opts));
    const train = r.map(x => ({ features: x.features, win: x.win, net: x.net, sessionKey: x.session }));
    cache.fit(spec, train);
    cache.fit({ ...spec, l2: .1 }, train);
    const before = cache.stats.computed;
    cache.fit(spec, train);
    expect(cache.stats.computed).toBe(before + 1);
  });
  it("trainLogitL2 at 1e-3 is exactly winprob's trainer", () => {
    const X = [[1, 0, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0]];
    const y = [1, 0, 1, 0];
    expect(trainLogitL2(X, y, 1e-3)).toEqual(trainLogit(X, y));
  });

  it("v1 takes everything; challengers carry an EV break-even threshold and validate", () => {
    expect(scoreOpportunity(TAKE_ALL_V1, feat(1))).toEqual({ p: null, take: true, threshold: null });
    const r = rows(120).map((x) => ({ features: x.features, win: x.win, net: x.net, sessionKey: x.session }));
    for (const featureSet of ["v1", "v2"] as const) {
      const a = trainChallenger("c", { windowSessions: null, featureSet, l2: 0.01 }, r, { seed: 1, cutoff: "2026-07-01T00:00:00Z", datasetId: null, rowsHash: "x" });
      expect(validateArtifact(a)).toEqual([]);
      expect(a.coefficients.length).toBe(FEATURE_SETS[featureSet].length);
      expect(a.threshold.tau).toBeCloseTo(50 / 110, 5);
    }
    expect(evThreshold([{ net: 60 }, { net: -50 }]).tau).toBeCloseTo(50 / 110, 6);
  });

  it("rejects broken artifacts and refuses unusable output", () => {
    const r = rows(80).map((x) => ({ features: x.features, win: x.win, net: x.net, sessionKey: x.session }));
    const a = trainChallenger("c", { windowSessions: null, featureSet: "v1", l2: 0.01 }, r, { seed: 1, cutoff: "2026-07-01T00:00:00Z", datasetId: null, rowsHash: "x" });
    expect(validateArtifact({ ...a, coefficients: a.coefficients.slice(1) })).toContain("coefficient count does not match the features");
    expect(validateArtifact({ ...a, coefficients: a.coefficients.map(() => NaN) })).toContain("a coefficient is not a number");
    expect(validateArtifact({ ...a, normalizer: { ...a.normalizer, scoreStd: 0 } })).toContain("bad normalizer");
    expect(validateArtifact({ ...a, threshold: { ...a.threshold, tau: 1.2 } })).toContain("threshold outside 0–1");
    expect(() => scoreOpportunity({ ...a, coefficients: a.coefficients.map(() => NaN) }, feat(1))).toThrow(ModelOutputError);
  });
});

describe("experiment statistics", () => {
  it("bootstrap is reproducible and resamples whole sessions", () => {
    const r = rows(200).map((x) => ({ session: x.session, value: x.net }));
    expect(sessionBootstrapMean(r, 500, 7, 0.05)).toEqual(sessionBootstrapMean(r, 500, 7, 0.05));
    const i = sessionBootstrapMean(r, 500, 7, 0.05);
    expect(i.lo).toBeLessThanOrEqual(i.est);
    expect(i.hi).toBeGreaterThanOrEqual(i.est);
    // One session can't make an interval.
    expect(sessionBootstrapMean([{ session: "a", value: 1 }, { session: "a", value: 2 }], 100, 1, 0.05).lo).toBe(-Infinity);
  });

  it("random picks score near the 50th percentile; perfect picks near 100", () => {
    const rand = mulberry32(3);
    const r = rows(400, 9, false).map((x) => ({ session: x.session, value: x.net, take: rand() < 0.5 }));
    const pct = matchedRandomPercentile(r, 400, 11);
    expect(pct).toBeGreaterThan(5);
    expect(pct).toBeLessThan(95);
    const perfect = r.map((x) => ({ ...x, take: x.value > 0 }));
    expect(matchedRandomPercentile(perfect, 400, 11)).toBeGreaterThan(95);
  });

  it("drawdowns", () => {
    expect(maxDrawdown([10, -30, 5, -10])).toBe(35);
    expect(stressDrawdownP95([{ session: "a", value: -10 }, { session: "b", value: 5 }], 50, 1)).toBeGreaterThanOrEqual(5);
  });
});

describe("walk-forward evaluation", () => {
  it("never trains on rows inside the embargo before a test fold, and labels evidence", () => {
    const r = rows(400);
    const wf = walkForward(r, { windowSessions: null, featureSet: "v1", l2: 0.01 }, TAKE_ALL_V1, { seedKey: "t", comparisons: 1 });
    expect(wf.metrics.folds).toBeGreaterThan(0);
    expect(wf.metrics.nOos).toBeGreaterThan(150);
    // Late rows are never evidence.
    const late = r.map((x) => ({ ...x, provenance: "late" as const }));
    expect(evidenceRows(late)).toHaveLength(0);
    expect(walkForward(late, { windowSessions: null, featureSet: "v1", l2: 0.01 }, TAKE_ALL_V1, { seedKey: "t", comparisons: 1 }).metrics.nOos).toBe(0);
  });

  it("finds a real signal and does not find one in noise", () => {
    const real = walkForward(rows(600, 2, true), { windowSessions: null, featureSet: "v1", l2: 0.001 }, TAKE_ALL_V1, { seedKey: "a", comparisons: 1 });
    expect(real.metrics.delta.est).toBeGreaterThan(0);
    const noise = walkForward(rows(600, 2, false), { windowSessions: null, featureSet: "v1", l2: 0.001 }, TAKE_ALL_V1, { seedKey: "a", comparisons: 1 });
    expect(verdictOf(noise.metrics).verdict).not.toBe("pass");
  });
});

describe("verdicts, adoption and rollback", () => {
  const good: Metrics = {
    nOos: 200, nSessions: 40, folds: 5, delta: { est: 5, lo: 1, hi: 9 }, expectancy: { est: 6, lo: 2, hi: 10 }, randomPct: 97, stressP95: 800,
    costStressNet: 300, brierC: 0.2, brierInc: 0.25, takeRate: 0.5, chalNet: 1200, incNet: 200, maxDrawdown: 300, alpha: 0.05,
  };

  it("passes only when every check holds; thin evidence is inconclusive, never a pass", () => {
    expect(verdictOf(good).verdict).toBe("pass");
    expect(verdictOf({ ...good, nOos: 149 }).verdict).toBe("inconclusive");
    expect(verdictOf({ ...good, delta: { est: 2, lo: -1, hi: 5 } }).verdict).toBe("inconclusive");
    expect(verdictOf({ ...good, delta: { est: -4, lo: -8, hi: -1 } }).verdict).toBe("fail");
    expect(verdictOf({ ...good, expectancy: { est: -3, lo: -6, hi: -1 } }).verdict).toBe("fail");
    expect(verdictOf({ ...good, randomPct: 80 }).verdict).toBe("inconclusive");
    expect(verdictOf({ ...good, stressP95: 2500 }).verdict).toBe("fail");
    expect(verdictOf({ ...good, costStressNet: -1 }).verdict).toBe("inconclusive");
    expect(verdictOf({ ...good, brierC: 0.3 }).verdict).toBe("fail");
    expect(verdictOf({ ...good, delta: { est: NaN, lo: NaN, hi: NaN } }).verdict).toBe("invalid");
  });

  it("adopts only after a fresh window and two passing reviews six days apart", () => {
    const now = 1_800_000_000;
    const fresh = { sessions: 20, decisions: 60, deltaPerIdea: 2, netPerIdea: 3 };
    const prev = [{ at: now - 7 * 86400, verdict: "pass" as const, newOutcomes: 12 }];
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 11 }, previous: prev, fresh, active: true }).adopt).toBe(true);
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 11 }, previous: [], fresh, active: true }).reasons).toContain("needs-second-passing-review");
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 11 }, previous: [{ ...prev[0], at: now - 5 * 86400 }], fresh, active: true }).adopt).toBe(false);
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 9 }, previous: prev, fresh, active: true }).reasons).toContain("too-few-new-outcomes");
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 11 }, previous: prev, fresh: { ...fresh, sessions: 19 }, active: true }).adopt).toBe(false);
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 11 }, previous: prev, fresh: { ...fresh, decisions: 59 }, active: true }).adopt).toBe(false);
    expect(adoptionDecision({ current: { at: now, verdict: "pass", newOutcomes: 11 }, previous: prev, fresh, active: false }).adopt).toBe(false);
    expect(adoptionDecision({ current: { at: now, verdict: "inconclusive", newOutcomes: 11 }, previous: prev, fresh, active: true }).adopt).toBe(false);
  });

  it("rolls back on a drawdown or a clearly worse fresh window, not on one loss", () => {
    expect(rollbackDecision({ post: [{ session: "a", delta: -50, net: -50 }], brierRegressions: 0, seedKey: "x" }).rollback).toBe(false);
    expect(rollbackDecision({ post: Array.from({ length: 20 }, (_, i) => ({ session: `s${i}`, delta: -60, net: -60 })), brierRegressions: 0, seedKey: "x" }).reason).toBe("post-adoption-drawdown");
    const worse = Array.from({ length: 40 }, (_, i) => ({ session: `s${i % 20}`, delta: -5 - (i % 3), net: i % 2 ? 10 : -9 }));
    expect(rollbackDecision({ post: worse, brierRegressions: 0, seedKey: "x" }).reason).toBe("worse-than-control");
    const fine = Array.from({ length: 40 }, (_, i) => ({ session: `s${i % 20}`, delta: i % 2 ? 4 : -3, net: i % 2 ? 10 : -9 }));
    expect(rollbackDecision({ post: fine, brierRegressions: 2, seedKey: "x" }).reason).toBe("calibration-worse");
  });
});

describe("search, datasets and quota", () => {
  it("draws at most three untried specs a week from the preregistered grid, deterministically", () => {
    expect(searchSpace()).toHaveLength(18);
    const a = pickChallengers("2026-W41", new Set(), 5);
    expect(a).toHaveLength(3);
    expect(pickChallengers("2026-W41", new Set(), 3)).toEqual(a);
    const tried = new Set(a.map(specHash));
    expect(pickChallengers("2026-W42", tried, 3).some((s) => tried.has(specHash(s)))).toBe(false);
    expect(inSearchSpace({ windowSessions: 45, featureSet: "v1", l2: 0.01 })).toBe(false);
    expect(PREREG.search.maxPerWeek).toBe(3);
  });

  it("builds each decision once, closed before the cutoff, with a stable hash", () => {
    const mk = (k: string, opp: string, exitTs: number, net: number): [Decision, Outcome] => [
      { key: k, opportunityKey: opp, decidedAt: exitTs - 100, sessionKey: "2026-10-07", features: feat(1), provenance: "prospective" } as Decision,
      { decisionKey: k, status: "closed", voidReason: null, standaloneQty: 2, sim: { symbol: "MES", exitTs, net, fees: 2.4, entrySlip: 0.25, exitSlip: 0.25 } } as Outcome,
    ];
    const pairs = [mk("a", "o1", 100, 10), mk("b", "o1", 110, 12), mk("c", "o2", 500, -8)];
    const r = buildEvalRows(pairs.map((p) => p[0]), pairs.map((p) => p[1]), 200);
    expect(r.map((x) => x.key)).toEqual(["a"]);
    expect(r[0].net).toBe(20);
    expect(r[0].frictionPerContract).toBeCloseTo(2.4 + 0.5 * 5, 6);
    expect(datasetFor("e", r, 200).rowsHash).toBe(datasetFor("e", [...r], 200).rowsHash);
    const audit = auditLearningData(pairs.map(p => p[0]), pairs.map(p => p[1]), r, 200);
    expect(audit).toMatchObject({ checked: 3, usable: 1, duplicate: 1, afterCutoff: 1, prospective: 1 });
  });

  it("explains excluded examples without changing the dataset or counting replay as fresh", () => {
    const decisions = ["take", "skip", "wait", "void", "risk", "missing"].map((key, i) => ({
      key, opportunityKey: key, decidedAt: i, sessionKey: "2026-10-07", features: key === "missing" ? null : feat(i), provenance: "replay", action: key === "take" ? "take" : "skip",
    } as Decision));
    const outcomes = decisions.map(d => ({ decisionKey: d.key, status: d.key === "wait" ? "open" : d.key === "void" ? "void" : "closed", standaloneQty: d.key === "risk" ? 0 : 1,
      sim: { symbol: "MES", net: 10, exitTs: 20, ambiguous: d.key === "skip", fees: 2.4, entrySlip: 0, exitSlip: 0 },
    } as Outcome));
    const rows = buildEvalRows(decisions, outcomes, 100);
    expect(auditLearningData(decisions, outcomes, rows, 100)).toMatchObject({ checked: 6, usable: 2, fromTaken: 1, fromSkipped: 1, replay: 2, prospective: 0, awaiting: 1, noFill: 1, tooRisky: 1, missingFeatures: 1, ambiguous: 1 });
  });

  it("quota levels at 70, 85 and 95 percent", () => {
    const gb = 1024 ** 3;
    expect(quotaLevel({ dbBytes: 0.5 * gb, monthRunSec: 0 })).toBe("normal");
    expect(quotaLevel({ dbBytes: 0.71 * gb, monthRunSec: 0 })).toBe("reduce");
    expect(quotaLevel({ dbBytes: 0.86 * gb, monthRunSec: 0 })).toBe("conserve");
    expect(quotaLevel({ dbBytes: 0.96 * gb, monthRunSec: 0 })).toBe("essential");
    expect(allowed("essential", "tick")).toBe(true);
    expect(allowed("essential", "learn")).toBe(false);
    expect(allowed("conserve", "search")).toBe(false);
    expect(searchBudget("reduce", 3)).toBe(2);
  });

  it("week keys follow the New York trading day", () => {
    expect(weekKeyOf(Date.UTC(2026, 9, 7, 15) / 1000)).toBe("2026-W41");
  });
});
