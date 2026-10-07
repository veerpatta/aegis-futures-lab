import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AMENDMENTS, IMPORTED_LIFECYCLES, LIFECYCLE_EVIDENCE_HORIZON, PREREG, PREREG_2026_10_07, challengerSlots, lifecycleAt, lifecycleFor,
  recordedAmendments, retirementDecision, rulesFor,
} from "@/lib/experiment/prereg";
import { stableHash } from "@/lib/experiment/hash";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { createCampaign, runJob } from "@/lib/experiment/jobs";
import type { VersionRecord } from "@/lib/experiment/store";

const WEEK = 7 * 86400;
const AMEND = AMENDMENTS[PREREG_2026_10_07.version][0];
const record = (at: number, over: Record<string, unknown> = {}) => ({
  kind: "rules_amended", createdAt: at, evidence: { amendment: AMEND.id, section: "lifecycle", rules: { ...LIFECYCLE_EVIDENCE_HORIZON }, ...over },
});

describe("the running campaign's rules stay frozen", () => {
  it("v1 still hashes to the fingerprint stored with learner-1 in production", () => {
    expect(stableHash(PREREG_2026_10_07)).toBe("50c2fd5db4fbccf2c09a6d48cc7b20e2a3978295f64e0951bd9a48624b9e4105");
    expect(rulesFor("exp-prereg-2026-10-07")).toBe(PREREG_2026_10_07);
    expect(PREREG_2026_10_07.lifecycle).toEqual({ maxInconclusive: 6, shadowWeeks: 6 });
  });

  it("new campaigns get the same floors, grid and rollback rule — only the lifecycle differs", () => {
    const strip = (p: typeof PREREG) => { const { version, lifecycle, ...rest } = p; void version; void lifecycle; return rest; };
    expect(strip(PREREG)).toEqual(strip(PREREG_2026_10_07));
    expect(PREREG.lifecycle).toEqual(LIFECYCLE_EVIDENCE_HORIZON);
    expect(rulesFor(PREREG.version)).toBe(PREREG);
  });

  it("the migration records exactly the declared amendment, for the v1 campaign only", () => {
    const sql = readFileSync(join(__dirname, "..", "db/migrations/20261007_experiment_lifecycle_amendment.sql"), "utf8");
    const body = sql.match(/'rules', jsonb_build_object\(([^)]*)\)/)![1];
    const parts = body.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    const rules: Record<string, unknown> = {};
    for (let i = 0; i < parts.length; i += 2) rules[parts[i]] = /^\d+$/.test(parts[i + 1]) ? Number(parts[i + 1]) : parts[i + 1];
    expect(rules).toEqual({ ...AMEND.lifecycle });
    expect(sql).toContain(`'amendment', '${AMEND.id}'`);
    expect(sql).toContain(`prereg ->> 'version' = '${PREREG_2026_10_07.version}'`);
    expect(sql).toContain("'rules_amended'");
  });
});

describe("recorded amendments", () => {
  it("apply only when recorded and only as declared", () => {
    expect(recordedAmendments(PREREG_2026_10_07.version, [])).toEqual([]);
    expect(recordedAmendments(PREREG_2026_10_07.version, [record(100)])).toEqual([{ amendment: AMEND, at: 100 }]);
    expect(() => recordedAmendments(PREREG_2026_10_07.version, [record(100, { amendment: "made-up" })])).toThrow(/not declared/);
    expect(() => recordedAmendments(PREREG_2026_10_07.version, [record(100, { rules: { ...LIFECYCLE_EVIDENCE_HORIZON, shadowWeeks: 520 } })])).toThrow(/does not match/);
    expect(() => recordedAmendments(PREREG.version, [record(100)])).toThrow(/not declared/); // v2 has nothing to amend
  });

  it("reach only challengers registered after the record; imported candidates keep their study's lifecycle", () => {
    const rec = recordedAmendments(PREREG_2026_10_07.version, [record(1000)]);
    expect(lifecycleFor(PREREG_2026_10_07, { registeredAt: 999 }, IMPORTED_LIFECYCLES, rec)).toEqual(PREREG_2026_10_07.lifecycle);
    expect(lifecycleFor(PREREG_2026_10_07, { registeredAt: 1001 }, IMPORTED_LIFECYCLES, rec)).toEqual(LIFECYCLE_EVIDENCE_HORIZON);
    expect(lifecycleFor(PREREG_2026_10_07, { registeredAt: 1001, origin: { rulesVersion: "hist-study-2026-10-07" } }, IMPORTED_LIFECYCLES, rec)).toEqual(IMPORTED_LIFECYCLES["hist-study-2026-10-07"]);
    expect(lifecycleAt(PREREG_2026_10_07, rec, 999).maxShadowing).toBeUndefined();
    expect(lifecycleAt(PREREG_2026_10_07, rec, 1000).maxShadowing).toBe(3);
  });
});

describe("retirement", () => {
  const inc = (n: number, nOos: number) => Array.from({ length: n }, () => ({ verdict: "inconclusive", nOos }));
  const t0 = 1_800_000_000;

  it("the original rule retired a challenger at 6 weeks or 6 inconclusive reviews, whatever the data", () => {
    const life = PREREG_2026_10_07.lifecycle;
    expect(retirementDecision({ life, reviews: inc(6, 0), minOos: 150, registeredAt: t0, nowSec: t0 + 6 * WEEK }).reason).toBe("inconclusive-limit");
    expect(retirementDecision({ life, reviews: inc(1, 0), minOos: 150, registeredAt: t0, nowSec: t0 + 6 * WEEK + 1 }).reason).toBe("shadow-expired");
  });

  it("the amended rule waits while it is only too early to tell", () => {
    const life = LIFECYCLE_EVIDENCE_HORIZON;
    expect(retirementDecision({ life, reviews: inc(30, 120), minOos: 150, registeredAt: t0, nowSec: t0 + 30 * WEEK }).retire).toBe(false);
    expect(retirementDecision({ life, reviews: [...inc(5, 160), ...inc(20, 100)], minOos: 150, registeredAt: t0, nowSec: t0 + 25 * WEEK }).retire).toBe(false);
  });

  it("retires after 6 inconclusive reviews with enough data, after a year without a pass, never in between on a pass", () => {
    const life = LIFECYCLE_EVIDENCE_HORIZON;
    const six = retirementDecision({ life, reviews: [...inc(6, 160), ...inc(10, 100)], minOos: 150, registeredAt: t0, nowSec: t0 + 16 * WEEK });
    expect(six).toEqual({ retire: true, reason: "inconclusive-limit", streak: 6 });
    // A pass resets the run.
    expect(retirementDecision({ life, reviews: [...inc(3, 170), { verdict: "pass", nOos: 165 }, ...inc(5, 160)], minOos: 150, registeredAt: t0, nowSec: t0 + 20 * WEEK }).retire).toBe(false);
    expect(retirementDecision({ life, reviews: inc(1, 120), minOos: 150, registeredAt: t0, nowSec: t0 + 52 * WEEK + 1 }).reason).toBe("shadow-expired");
    expect(retirementDecision({ life, reviews: [{ verdict: "pass", nOos: 200 }], minOos: 150, registeredAt: t0, nowSec: t0 + 60 * WEEK }).retire).toBe(false);
  });
});

describe("search slots", () => {
  it("new challengers only fill free slots under the amendment; the weekly cap still applies", () => {
    expect(challengerSlots(3, LIFECYCLE_EVIDENCE_HORIZON, 3)).toBe(0);
    expect(challengerSlots(3, LIFECYCLE_EVIDENCE_HORIZON, 1)).toBe(2);
    expect(challengerSlots(1, LIFECYCLE_EVIDENCE_HORIZON, 0)).toBe(1);
    expect(challengerSlots(3, PREREG_2026_10_07.lifecycle, 12)).toBe(3);
    expect(challengerSlots(-1, LIFECYCLE_EVIDENCE_HORIZON, 0)).toBe(0);
  });
});

describe("the weekly review under the amendment", () => {
  it("keeps a too-early challenger registered after the record, retires one registered before it, and waits for a free slot", async () => {
    const store = new MemoryStore();
    const start = 1_800_000_000;
    const exp = await createCampaign(store, { lineage: "learner", campaign: 1, mode: "synthetic", startedAt: start, reason: "amendment test" });
    store.experiments.get(exp.id)!.preregVersion = PREREG_2026_10_07.version; // the running campaign's rules
    const amendedAt = start + WEEK;
    store.changes.push({ id: 900, experimentId: exp.id, eventKey: `amended:${exp.id}`, reason: "Amendment 1", ...record(amendedAt) } as never);
    const artifact = { kind: "logit" } as never;
    const mk = (id: string, registeredAt: number, specHash: string): VersionRecord => ({
      id, experimentId: exp.id, kind: "logit", spec: { windowSessions: null, featureSet: "v1", l2: 0.01 }, specHash, weekKey: "w", registeredAt,
      datasetId: null, artifact, artifactHash: "h", trainedAt: registeredAt, trainCutoff: registeredAt, status: "shadowing", statusReason: null,
    });
    store.versions.set("old", mk("old", start, "s-old"));
    for (const k of ["a", "b", "c"]) store.versions.set(k, mk(k, amendedAt + 3600, `s-${k}`));
    for (const id of ["old", "a", "b", "c"])
      for (let i = 1; i <= 6; i++)
        store.evaluations.push({ id: store.evaluations.length + 1, experimentId: exp.id, versionId: id, incumbentVersionId: null, datasetId: null, kind: "walk_forward",
          windowFrom: null, windowTo: null, nOos: 0, nSessions: 0, totalOutcomes: 0, metrics: {}, seeds: {}, verdict: "inconclusive", reasons: ["enoughOutcomes"], createdAt: amendedAt + i * WEEK - 60 });
    const r = await runJob({ job: "review", invocationId: "rev-1", trigger: "test", store, lineage: "learner", nowSec: amendedAt + 8 * WEEK });
    expect(r.status).toBe("ok");
    expect(store.versions.get("old")!.status).toBe("retired");
    expect(store.versions.get("old")!.statusReason).toBe("shadow-expired");
    for (const k of ["a", "b", "c"]) expect(store.versions.get(k)!.status).toBe("shadowing");
    expect(String(r.counts.searchWaiting)).toMatch(/3 candidates already being tested/);
  });
});
