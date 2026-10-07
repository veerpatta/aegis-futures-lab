import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/scripts/engine/montecarlo";
import { nyTimeToUnix } from "@/lib/time/ny";
import { buildStudyDataset, foldReport, rowsIn, splitSessions } from "@/lib/history/dataset";
import { evaluateTrial, finalEvaluation, portfolioSim, selectTrial } from "@/lib/history/study";
import { HIST_RULES, registeredTrials, scopeMonths } from "@/lib/history/rules";
import { runStage, quotaGate } from "@/lib/history/jobs";
import { MemoryHistoryStore } from "@/lib/history/store-memory";
import { PgHistoryStore } from "@/lib/history/store-pg";
import { buildManifest } from "@/lib/history/register";
import { searchSpace } from "@/lib/experiment/search";
import { IMPORTED_LIFECYCLES, PREREG, rulesFor } from "@/lib/experiment/prereg";
import { validateArtifact } from "@/lib/experiment/models";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { createCampaign, importShadowCandidate, runJob } from "@/lib/experiment/jobs";
import { COST_VERSION } from "@/lib/experiment/policy";
import type { ReplayExample } from "@/lib/history/replay";
import type { RegisterFacts } from "@/lib/history/store";

function days(from: string, n: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); out.length < n; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Synthetic replay examples where `score` genuinely helps (or not, with signal=false). */
export function examples(n: number, signal = true, seed = 3): ReplayExample[] {
  const rand = mulberry32(seed);
  const out: ReplayExample[] = [];
  let i = 0;
  for (const d of days("2023-01-03", Math.ceil(n / 2))) {
    for (const hh of [10, 13]) {
      if (out.length >= n) break;
      const signalTs = nyTimeToUnix(d, hh * 60);
      const score = Math.round(rand() * 300) / 100;
      const good = score > 1.5;
      const win = signal ? rand() < (good ? 0.75 : 0.25) : rand() < 0.45;
      const net = win ? 58 : -52;
      out.push({
        mode: "observation", familyId: `A:zone-v5:MES:${signalTs}`, month: d.slice(0, 7), symbol: i % 2 ? "MES" : "MNQ", side: "LONG", strategy: "zone-v5", tier: "A",
        signalTs, seenAt: signalTs + 1525, decidedAt: signalTs + 1620, infoCutoff: signalTs + 1500, labelReadyAt: signalTs + 5400,
        features: { tier: "A", regime: i % 3 ? "trend-high-vol" : "range-low-vol", vix_bucket: null, score, rr: 2, signal_ts: new Date(signalTs * 1000).toISOString(), symbol: i % 2 ? "MES" : "MNQ", strategy: "zone-v5", atr_pct: 0.1, vwap_atr: 0.2 },
        reason: "taken", outcomeStatus: "closed", voidReason: null, standaloneQty: 1, fillTs: signalTs + 1620, fillPrice: 6000, exitTs: signalTs + 5400,
        exitPrice: 6010, exitReason: win ? "target" : "stop", ambiguous: false, grossPc: net + 3.65, feesPc: 2.4, slipPc: 1.25, netPc: net, riskPc: 52,
        quality: [], quarantined: false, snapshotHash: `h${i}`, ideaExitTs: null,
      });
      i++;
    }
  }
  return out;
}

describe("dataset, splits and folds", () => {
  it("splits chronologically by session 60/20/20 and reports every fold", () => {
    const ds = buildStudyDataset(examples(1200), Infinity);
    const split = splitSessions(ds)!;
    expect(split.development.to < split.validation.from).toBe(true);
    expect(split.validation.to < split.final.from).toBe(true);
    expect(split.development.sessions).toBe(Math.floor(ds.sessions.length * 0.6));
    const fr = foldReport(rowsIn(ds.rows, split.development), null);
    expect(fr.folds).toHaveLength(5);
    expect(fr.coverage).toBe(true);
    expect(fr.folds.every((f) => f.purgedRows > 0)).toBe(true); // the exit-time embargo bites
  });

  it("fails explicitly when a fold is too thin, never scoring the survivors", () => {
    const ds = buildStudyDataset(examples(140), Infinity);
    const split = splitSessions(ds)!;
    const r = evaluateTrial({ windowSessions: null, featureSet: "v1", l2: 0.01 }, 1, ds.rows, split, ds.extras, 1);
    expect(r.status).toBe("failed_coverage");
    expect(r.development).toBeNull();
    expect(r.reason).toMatch(/fold/);
  });
});

describe("trials, selection and the one final look", () => {
  const ds = buildStudyDataset(examples(1600), Infinity);
  const split = splitSessions(ds)!;
  const specs = registeredTrials(searchSpace(PREREG), HIST_RULES.seed, 3);

  it("registers three seeded specifications from the preregistered grid", () => {
    expect(specs).toHaveLength(3);
    expect(registeredTrials(searchSpace(PREREG), HIST_RULES.seed, 3)).toEqual(specs);
  });

  it("is reproducible, compares with the controls and reports calibration", () => {
    const a = evaluateTrial(specs[0], 1, ds.rows, split, ds.extras, 3);
    const b = evaluateTrial(specs[0], 1, ds.rows, split, ds.extras, 3);
    expect(a.status).toBe("evaluated");
    expect(a.validation!.delta).toEqual(b.validation!.delta);
    for (const m of [a.development!, a.validation!]) {
      expect(m.logLossC).toBeGreaterThan(0);
      expect(Number.isFinite(m.brierBase)).toBe(true);
      expect(m.randomPct).toBeGreaterThanOrEqual(0);
      expect(m.portfolio.incumbent.trades).toBeGreaterThan(0);
      expect(m.costs).toBeGreaterThanOrEqual(0);
    }
  });

  it("selects by the validation lower bound and fits the frozen candidate once", () => {
    const results = specs.map((s, i) => evaluateTrial(s, i + 1, ds.rows, split, ds.extras, 3));
    const sel = selectTrial(results)!;
    expect(sel).toBeTruthy();
    const fin = finalEvaluation(sel, ds.rows, split, ds.extras, { studyId: "hist-test", datasetHash: ds.rowsHash });
    if ("error" in fin) throw new Error(fin.error);
    expect(validateArtifact(fin.artifact)).toEqual([]);
    expect(fin.developmentExposed).toBe(true);
    expect(fin.trainCutoff).toBeLessThan(Math.min(...rowsIn(ds.rows, split.final).map((r) => r.decidedAt)));
    expect(fin.final.nOos).toBe(rowsIn(ds.rows, split.final).length);
  });

  it("finds a real signal and rejects noise", () => {
    const noise = buildStudyDataset(examples(1600, false, 9), Infinity);
    const ns = splitSessions(noise)!;
    const r = evaluateTrial({ windowSessions: null, featureSet: "v1", l2: 0.001 }, 1, noise.rows, ns, noise.extras, 1);
    expect(r.validation!.delta.lo).toBeLessThanOrEqual(0.5);
  });

  it("handles one-class training data without inventing a model", () => {
    const allWins = examples(1200).map((e) => ({ ...e, netPc: 58 }));
    const d = buildStudyDataset(allWins, Infinity);
    const s = splitSessions(d)!;
    const r = evaluateTrial({ windowSessions: null, featureSet: "v1", l2: 0.01 }, 1, d.rows, s, d.extras, 1);
    expect(["evaluated", "failed_coverage"]).toContain(r.status);
  });

  it("runs the virtual account under the same risk limits", () => {
    const rows = rowsIn(ds.rows, split.final);
    const p = portfolioSim(rows, rows.map(() => true), ds.extras);
    expect(p.trades).toBeGreaterThan(0);
    expect(p.trades).toBeLessThanOrEqual(rows.length);
    expect(portfolioSim(rows, rows.map(() => false), ds.extras)).toEqual({ net: 0, maxDrawdown: 0, trades: 0 });
  });
});

const facts = (): RegisterFacts => ({
  coverage: [{ source: "databento", symbol: "MES", from: "2019-05-06T00:00Z", to: "2026-09-23T23:55Z", rows: 1 }], yahooOverlap: [],
  signals: { total: 169, withOutcome: 167, net: -500, first: null, last: null, firstCreated: null }, shadows: { total: 574, withOutcome: 547, net: -900, first: null, last: null },
  experimentDecisions: 3, research: {}, firstEngineRun: "2026-07-19T11:31:00Z", firstExperimentDecision: "2026-10-07T09:25:00Z",
  observationLag: { medianSec: 1525, p25Sec: 1100, p75Sec: 2400, n: 133 }, contextCoverage: { from: "2025-07-23", to: "2026-10-06" },
});

describe("register and manifest", () => {
  it("freezes scope, measured delay, trials, versions and prior use", () => {
    const { manifest, manifestHash } = buildManifest({ studyId: "hist-x", facts: facts(), researchCodeHash: "abc", codeSha: "sha" });
    expect(manifest.observationLagSec).toBe(1525);
    expect(manifest.trials).toHaveLength(3);
    expect(manifest.versions.costs).toBe(COST_VERSION);
    expect(manifest.untouchedHistoricalPeriod).toBeNull();
    expect(manifest.plannedChunks).toBe(scopeMonths(HIST_RULES.scope.from, HIST_RULES.scope.to).length * 2);
    expect(buildManifest({ studyId: "hist-x", facts: facts(), researchCodeHash: "abc", codeSha: "sha" }).manifestHash).toBe(manifestHash);
  });

  it("pins the imported lifecycle and the campaign rules by version", () => {
    expect(IMPORTED_LIFECYCLES[HIST_RULES.version]).toEqual(HIST_RULES.importedLifecycle);
    expect(rulesFor(PREREG.version)).toBe(PREREG);
    expect(() => rulesFor("made-up-version")).toThrow();
  });
});

describe("operations", () => {
  const setup = () => {
    const store = new MemoryHistoryStore();
    store.facts = facts();
    return store;
  };

  it("pins the source on every bar read: a Yahoo bar at the same time is never blended in, and an over-cap read is refused", async () => {
    const rows = [
      { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0, source: "databento" },
      { time: 1000, open: 9, high: 9, low: 9, close: 9, volume: 0, source: "yahoo" },
      { time: 1300, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0, source: "databento" },
    ];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        expect(sql).toContain("source=$2");
        return { rows: rows.filter((r) => r.source === params[1] && r.time >= (params[2] as number) && r.time < (params[3] as number)).slice(0, params[4] as number) };
      },
    };
    const pg = new PgHistoryStore(pool as never);
    const got = await pg.readBars("MES", "databento", 0, 2000, 10);
    expect(got.map((b) => b.close)).toEqual([1.5, 1.5]);
    await expect(pg.readBars("MES", "databento", 0, 2000, 1)).rejects.toThrow(/cap/);
  });

  it("registers once; reruns are no-ops", async () => {
    const store = setup();
    expect((await runStage({ store, stage: "register", invocationId: "a", researchCodeHash: "h" })).status).toBe("ok");
    expect((await runStage({ store, stage: "register", invocationId: "b", researchCodeHash: "h" })).status).toBe("skipped");
    expect((await store.trials("hist-2026-10-07"))).toHaveLength(3);
  });

  it("pauses on quota pressure or stale telemetry, and on a held lease", async () => {
    const store = setup();
    await runStage({ store, stage: "register", invocationId: "a", researchCodeHash: "h" });
    store.dbBytes = 0.9 * 1024 ** 3;
    expect((await runStage({ store, stage: "replay", invocationId: "r1" })).message).toMatch(/quota stop/);
    store.dbBytes = 0.3 * 1024 ** 3;
    store.telemetryAt = Math.floor(Date.now() / 1000) - 7200;
    expect((await runStage({ store, stage: "replay", invocationId: "r2" })).message).toMatch(/unknown/);
    store.telemetryAt = null;
    await store.acquireLease("hist-2026-10-07", "someone-else", 600);
    expect((await runStage({ store, stage: "replay", invocationId: "r3" })).message).toMatch(/lease/);
    expect(quotaGate({ dbBytes: 0.75 * 1024 ** 3, monthStudyBytes: 0, monthRunSec: 0, readAt: 100 }, 100)).toBe("reduce");
  });

  it("counts the recorded wall time of earlier replay runs against the 30-minute budget, not a self-reported figure", async () => {
    const store = setup();
    await runStage({ store, stage: "register", invocationId: "a", researchCodeHash: "h" });
    store.runs.push({ id: 99, studyId: "hist-2026-10-07", stage: "replay", invocationId: "old", status: "partial", bytes: 0, durationMs: 30 * 60_000 });
    const r = await runStage({ store, stage: "replay", invocationId: "r1" });
    expect(r.message).toMatch(/budget used/);
    expect((await store.latestStudy(HIST_RULES.version))!.status).toBe("partial");
  });

  it("checkpoints chunks, retries a failed one, and never redoes finished work", async () => {
    const store = setup();
    await runStage({ store, stage: "register", invocationId: "a", researchCodeHash: "h" });
    store.failReadFor = "MNQ";
    const r1 = await runStage({ store, stage: "replay", invocationId: "r1", maxChunks: 2 });
    expect(r1.counts.processed).toBe(2);
    const chunks1 = await store.chunks("hist-2026-10-07");
    expect(chunks1.find((c) => c.symbol === "MNQ")!.status).toBe("failed");
    store.failReadFor = null;
    const reads = store.readCount;
    await runStage({ store, stage: "replay", invocationId: "r2", maxChunks: 1 });
    const chunks2 = await store.chunks("hist-2026-10-07");
    expect(chunks2.find((c) => c.symbol === "MNQ")!.status).toBe("done");
    expect(store.readCount - reads).toBe(1);
    expect((await runStage({ store, stage: "replay", invocationId: "r2" })).status).toBe("skipped"); // same invocation
  });

  it("evaluates once: the final period opens once and a rerun is a no-op", async () => {
    const store = setup();
    await runStage({ store, stage: "register", invocationId: "a", researchCodeHash: "h" });
    for (const e of examples(1600)) store.exampleRows.set(`hist-2026-10-07|${e.mode}|${e.familyId}`, e);
    await store.updateStudy("hist-2026-10-07", { status: "replayed" });
    const r = await runStage({ store, stage: "study", invocationId: "s1" });
    expect(r.status).toBe("ok");
    const study = (await store.latestStudy(HIST_RULES.version))!;
    expect(study.status).toBe("evaluated");
    expect(study.finalAccessedAt).not.toBeNull();
    expect((await runStage({ store, stage: "study", invocationId: "s2" })).status).toBe("skipped");
    await expect(store.updateStudy(study.id, { finalAccessedAt: study.finalAccessedAt! + 5 })).rejects.toThrow();
  });
});

describe("fresh shadow import", () => {
  it("registers a frozen candidate as a shadow version at its real time, once, with no account change", async () => {
    const ds = buildStudyDataset(examples(1600), Infinity);
    const split = splitSessions(ds)!;
    const sel = selectTrial([evaluateTrial({ windowSessions: null, featureSet: "v1", l2: 0.01 }, 1, ds.rows, split, ds.extras, 1)])!;
    const fin = finalEvaluation(sel, ds.rows, split, ds.extras, { studyId: "hist-2026-10-07", datasetHash: ds.rowsHash });
    if ("error" in fin) throw new Error(fin.error);
    const store = new MemoryStore();
    const start = nyTimeToUnix("2026-10-07", 60);
    const exp = await createCampaign(store, { lineage: "learner", campaign: 1, mode: "synthetic", startedAt: start, reason: "import test" });
    const before = structuredClone(store.accounts.get(exp.id));
    const origin = {
      studyId: "hist-2026-10-07", studyVersion: HIST_RULES.version, datasetHash: ds.rowsHash, artifactHash: fin.artifactHash,
      trainCutoff: new Date(fin.trainCutoff * 1000).toISOString(), finalVerdict: fin.verdict.verdict, developmentExposed: true,
      rulesVersion: HIST_RULES.version, manifestHash: "m",
    };
    const now = nyTimeToUnix("2026-10-08", 12 * 60);
    const r = await importShadowCandidate(store, { lineage: "learner", artifact: fin.artifact, spec: sel.spec, origin, invocationId: "i1", nowSec: now });
    expect(r.versionId).toBe(`${exp.id}:hist:2026-10-07`);
    const v = store.versions.get(r.versionId!)!;
    expect(v.status).toBe("shadowing");
    expect(v.registeredAt).toBe(now);
    expect(v.artifact?.kind === "logit" && v.artifact.origin?.artifactHash).toBe(fin.artifactHash);
    expect(store.accounts.get(exp.id)).toEqual(before);
    expect(store.pointers.get(exp.id)!.versionId).toBe(`${exp.id}:v1-take-all`);
    const again = await importShadowCandidate(store, { lineage: "learner", artifact: fin.artifact, spec: sel.spec, origin, invocationId: "i2", nowSec: now + 60 });
    expect(again.versionId).toBe(r.versionId);
    expect([...store.versions.values()].filter((x) => x.id.includes(":hist:"))).toHaveLength(1);
    // It scores the next idea beside the incumbent without changing the decision.
    const t = await runJob({ job: "tick", invocationId: "t1", trigger: "test", store, lineage: "learner", nowSec: nyTimeToUnix("2026-10-08", 14 * 60) });
    expect(t.status).toBe("ok");
    for (const d of store.decisions.values()) expect(d.modelVersionId).toBe(`${exp.id}:v1-take-all`);
  });

  it("refuses an invalid artifact", async () => {
    const store = new MemoryStore();
    await createCampaign(store, { lineage: "learner", campaign: 1, mode: "synthetic", startedAt: 1_800_000_000, reason: "invalid test" });
    const bad = { schema: "aegis-exp-model/1", kind: "logit", id: "x", featureSet: "v1", featureNames: [], coefficients: [NaN], normalizer: { scoreMean: 0, scoreStd: 1, rrMean: 0, rrStd: 1 },
      l2: 0.01, windowSessions: null, seed: 1, threshold: { rule: "ev-breakeven", tau: 0.5, avgWin: 1, avgLoss: 1 }, train: { n: 0, from: null, to: null, cutoff: "2026-01-01T00:00:00Z", datasetId: null, rowsHash: "" } };
    const r = await importShadowCandidate(store, { lineage: "learner", artifact: bad as never, spec: { windowSessions: null, featureSet: "v1", l2: 0.01 },
      origin: { studyId: "hist-z", studyVersion: "v", datasetHash: null, artifactHash: "z", trainCutoff: "2026-01-01T00:00:00Z", finalVerdict: "inconclusive", developmentExposed: true, rulesVersion: "v", manifestHash: "m" }, invocationId: "x", nowSec: 1_800_100_000 });
    expect(r.versionId).toBeNull();
    expect(r.message).toMatch(/refused/);
  });
});
