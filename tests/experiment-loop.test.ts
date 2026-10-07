import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { createCampaign, runJob } from "@/lib/experiment/jobs";
import { stepTick } from "@/lib/experiment/step";
import { TAKE_ALL_V1 } from "@/lib/experiment/models";
import { EXP_RISK } from "@/lib/experiment/policy";
import { nyTimeToUnix } from "@/lib/time/ny";
import { makeHandler } from "@/lib/experiment/http";
import type { Account, ExperimentConfig, Opportunity } from "@/lib/experiment/types";
import type { Bar } from "@/lib/types";

const day = (d: string, hh: number, mm = 0) => nyTimeToUnix(d, hh * 60 + mm);
function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); out.length < n; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function campaign(days: number, start = "2026-03-02") {
  const store = new MemoryStore();
  const exp = await createCampaign(store, { lineage: "syn", campaign: 1, mode: "synthetic", startedAt: day(start, 1), reason: "synthetic proof of the loop" });
  let n = 0;
  for (const d of tradingDays(start, days)) {
    for (let m = 2 * 60; m <= 15 * 60 + 30; m += 30) {
      const r = await runJob({ job: "tick", invocationId: `t${n++}`, trigger: "test", store, lineage: "syn", nowSec: day(d, 0, m) });
      expect(r.status, r.message).toBe("ok");
    }
    await runJob({ job: "learn", invocationId: `l${d}`, trigger: "test", store, lineage: "syn", nowSec: day(d, 20) });
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 5)
      await runJob({ job: "review", invocationId: `r${d}`, trigger: "test", store, lineage: "syn", nowSec: day(d, 22) });
  }
  return { store, exp };
}

describe("the experimental learner end to end (synthetic prices)", () => {
  it("opens and closes trades, keeps a reconciled ledger, trains challengers and records verdicts", { timeout: 240_000 }, async () => {
    const { store, exp } = await campaign(45);
    const decisions = [...store.decisions.values()];
    const positions = [...store.positions.values()];
    expect(decisions.length).toBeGreaterThan(40);
    expect(decisions.every((d) => d.provenance === "synthetic")).toBe(true);
    expect(decisions.some((d) => d.action === "skip")).toBe(true);
    const closed = positions.filter((p) => p.status === "closed");
    expect(closed.length).toBeGreaterThan(10);
    // Every taken idea has a position; every decision an outcome.
    for (const d of decisions) {
      expect(store.outcomes.has(d.key)).toBe(true);
      expect(store.positions.has(d.key)).toBe(d.action === "take");
    }
    // Ledger reconciles: equity = capital + closed net + open marks.
    const acct = store.accounts.get(exp.id)!;
    const realized = Math.round(closed.reduce((a, p) => a + (p.net ?? 0), 0) * 100) / 100;
    expect(acct.realized).toBeCloseTo(realized, 2);
    expect(acct.equity).toBeCloseTo(EXP_RISK.capital + acct.realized + acct.unrealized, 2);
    // Fills exist for every filled position, entry before exit.
    for (const p of closed) {
      expect(store.fills.has(`${p.id}:entry`)).toBe(true);
      expect(store.fills.has(`${p.id}:exit`)).toBe(true);
      expect(p.exitTs!).toBeGreaterThanOrEqual(p.fillTs!);
      expect(p.fillTs!).toBeGreaterThanOrEqual(p.decidedAt);
    }
    // Learning: datasets, preregistered challengers (≤3 a week), recorded verdicts.
    expect(store.datasets.length).toBeGreaterThan(0);
    const challengers = [...store.versions.values()].filter((v) => v.kind === "logit");
    expect(challengers.length).toBeGreaterThan(0);
    const perWeek = new Map<string, number>();
    for (const v of challengers) perWeek.set(v.weekKey, (perWeek.get(v.weekKey) ?? 0) + 1);
    expect(Math.max(...perWeek.values())).toBeLessThanOrEqual(3);
    expect(store.changes.some((c) => c.kind === "challenger_registered")).toBe(true);
    const evals = store.evaluations.filter((e) => e.kind === "walk_forward");
    expect(evals.length).toBeGreaterThan(0);
    expect(evals.every((e) => ["pass", "fail", "inconclusive", "invalid"].includes(e.verdict))).toBe(true);
    // Challengers scored every later decision in shadow.
    expect(store.shadowScores.length).toBeGreaterThan(0);
    // The active model is always a valid, experiment-owned version.
    const ptr = store.pointers.get(exp.id)!;
    expect(store.versions.get(ptr.versionId)?.experimentId).toBe(exp.id);
  });
});

describe("retries, crashes and rollback", () => {
  it("a retried invocation is a no-op and a re-run tick decides nothing twice", async () => {
    const store = new MemoryStore();
    await createCampaign(store, { lineage: "syn", campaign: 1, mode: "synthetic", startedAt: day("2026-03-02", 1), reason: "synthetic retry test" });
    let now = day("2026-03-02", 2);
    for (; now <= day("2026-03-03", 15); now += 1800) await runJob({ job: "tick", invocationId: `t${now}`, trigger: "test", store, lineage: "syn", nowSec: now });
    const before = store.decisions.size;
    const replay = await runJob({ job: "tick", invocationId: `t${day("2026-03-03", 15)}`, trigger: "test", store, lineage: "syn", nowSec: day("2026-03-03", 15) });
    expect(replay.status).toBe("replayed");
    const again = await runJob({ job: "tick", invocationId: "fresh-id", trigger: "test", store, lineage: "syn", nowSec: day("2026-03-03", 15) });
    expect(again.status).toBe("ok");
    expect(store.decisions.size).toBe(before);
  });

  it("a crash before commit leaves no trace and the next tick redoes the work", async () => {
    const store = new MemoryStore();
    const exp = await createCampaign(store, { lineage: "syn", campaign: 1, mode: "synthetic", startedAt: day("2026-03-02", 1), reason: "synthetic crash test" });
    const acct = structuredClone(store.accounts.get(exp.id));
    store.failNextPersist = true;
    const r = await runJob({ job: "tick", invocationId: "x1", trigger: "test", store, lineage: "syn", nowSec: day("2026-03-02", 12) });
    expect(r.status).toBe("error");
    expect(store.accounts.get(exp.id)).toEqual(acct);
    expect(store.decisions.size).toBe(0);
    const ok = await runJob({ job: "tick", invocationId: "x2", trigger: "test", store, lineage: "syn", nowSec: day("2026-03-02", 12) });
    expect(ok.status).toBe("ok");
    expect(store.accounts.get(exp.id)!.cursor.MES).toBeGreaterThan(acct!.cursor.MES ?? 0);
  });

  it("an adopted model that produces unusable output is rolled back to the control at once", async () => {
    const store = new MemoryStore();
    const exp = await createCampaign(store, { lineage: "syn", campaign: 1, mode: "synthetic", startedAt: day("2026-03-02", 1), reason: "synthetic rollback test" });
    const bad = {
      schema: "aegis-exp-model/1", kind: "logit", id: "bad", featureSet: "v1", featureNames: [] as string[], coefficients: [NaN], normalizer: { scoreMean: 0, scoreStd: 1, rrMean: 0, rrStd: 1 },
      l2: 0.01, windowSessions: null, seed: 1, threshold: { rule: "ev-breakeven", tau: 0.5, avgWin: 1, avgLoss: 1 }, train: { n: 0, from: null, to: null, cutoff: "2026-03-01T00:00:00Z", datasetId: null, rowsHash: "" },
    } as const;
    store.versions.set(`${exp.id}:bad`, {
      id: `${exp.id}:bad`, experimentId: exp.id, kind: "logit", spec: {}, specHash: "bad", weekKey: "2026-W10", registeredAt: day("2026-03-02", 1), datasetId: null,
      artifact: bad as never, artifactHash: "x", trainedAt: null, trainCutoff: null, status: "adopted", statusReason: "test",
    });
    store.changes.push({ id: 99, experimentId: exp.id, kind: "adopted", fromVersion: `${exp.id}:v1-take-all`, toVersion: `${exp.id}:bad`, reason: "test", eventKey: "test-adopt", createdAt: 0 });
    store.pointers.set(exp.id, { versionId: `${exp.id}:bad`, previousVersionId: `${exp.id}:v1-take-all`, updatedAt: day("2026-03-02", 1) });
    const r = await runJob({ job: "tick", invocationId: "rb", trigger: "test", store, lineage: "syn", nowSec: day("2026-03-02", 12) });
    expect(r.status).toBe("ok");
    expect(store.pointers.get(exp.id)!.versionId).toBe(`${exp.id}:v1-take-all`);
    expect(store.versions.get(`${exp.id}:bad`)!.status).toBe("rolled_back");
    expect(store.changes.some((c) => c.kind === "rolled_back" && c.fromVersion === `${exp.id}:bad`)).toBe(true);
  });

  it("a locked campaign never reopens, and a new one keeps the old one on record", async () => {
    const store = new MemoryStore();
    const exp = await createCampaign(store, { lineage: "syn", campaign: 1, mode: "synthetic", startedAt: day("2026-03-02", 1), reason: "synthetic lock test" });
    await expect(createCampaign(store, { lineage: "syn", campaign: 2, mode: "synthetic", startedAt: day("2026-03-03", 1), reason: "too early" })).rejects.toThrow();
    store.experiments.get(exp.id)!.status = "locked";
    await expect(store.setStatus(exp.id, "active", { kind: "resumed", reason: "try to reopen", eventKey: "r" })).rejects.toThrow();
    await createCampaign(store, { lineage: "syn", campaign: 2, mode: "synthetic", startedAt: day("2026-03-03", 1), reason: "preregistered second campaign" });
    expect(store.experiments.size).toBe(2);
    expect((await store.activeExperiment("syn"))!.campaign).toBe(2);
  });
});

describe("one batch", () => {
  const exp: ExperimentConfig = { id: "e", lineage: "e", campaign: 1, mode: "live", status: "active", capital: 10000, startedAt: day("2026-10-07", 1), seed: 1 };
  const account: Account = {
    equity: 10000, realized: 0, unrealized: 0, unpricedPositions: 0, peak: 10000, dayKey: "", dayStartEquity: 10000, dailyPnl: 0, openRisk: 0,
    dayHalted: false, lockedAt: null, cursor: {}, staleSymbols: [], lastOkTickAt: null,
  };
  const bars = (toMin: number): Bar[] => {
    const out: Bar[] = [];
    for (let m = 120; m < toMin; m += 5) out.push({ time: day("2026-10-07", 0, m), open: 6000, high: 6001, low: 5999, close: 6000 });
    return out;
  };
  const op = (over: Partial<Opportunity> = {}): Opportunity => ({
    key: "zone:MES:1", signalId: 1, symbol: "MES", side: "LONG", entry: 6000, stop: 5990, target: 6020, signalTs: day("2026-10-07", 11), seenAt: day("2026-10-07", 11, 5),
    exitTs: null, strategy: "zone-v5", tier: "A", regime: "trend-high-vol", vixBucket: "low", score: 1, rr: 2, ...over,
  });
  const input = (over: Partial<Parameters<typeof stepTick>[0]> = {}) => ({
    exp, account, positions: [], outcomes: [], bars: { MES: bars(11 * 60 + 10), MNQ: bars(11 * 60 + 10) }, opportunities: [op()],
    model: { versionId: "e:v1-take-all", artifact: TAKE_ALL_V1 }, challengers: [], nowSec: day("2026-10-07", 11, 12), quota: "normal" as const, ...over,
  });

  it("labels an idea seen more than 30 minutes late as late, and a fresh one as prospective", () => {
    expect(stepTick(input()).decisions[0].provenance).toBe("prospective");
    expect(stepTick(input({ nowSec: day("2026-10-07", 11, 50), bars: { MES: bars(11 * 60 + 50), MNQ: bars(11 * 60 + 50) } })).decisions[0].provenance).toBe("late");
  });

  it("takes no new entry on stale data and invents no exit", () => {
    const staleBars = { MES: bars(10 * 60), MNQ: bars(10 * 60) };
    const r = stepTick(input({ bars: staleBars }));
    expect(r.freshness.MES).toBe("stale");
    expect(r.decisions[0].reason).toBe("stale-data");
    expect(r.newPositionIds).toHaveLength(0);
  });

  it("skips ideas whose own trade already ended, and records the pause", () => {
    expect(stepTick(input({ opportunities: [op({ exitTs: day("2026-10-07", 11, 8) })] })).decisions[0].reason).toBe("idea-closed");
    expect(stepTick(input({ exp: { ...exp, status: "paused" } })).decisions[0].reason).toBe("paused");
  });

  it("takes a fresh idea with take-all and fills only on the next bar", () => {
    const r = stepTick(input());
    expect(r.decisions[0].action).toBe("take");
    expect(r.positions[0].status).toBe("pending_fill");
    expect(r.positions[0].fillTs).toBeNull();
  });
});

describe("Neon Function entry", () => {
  it("refuses calls without Neon's trigger header and runs genuine ones", async () => {
    const store = new MemoryStore();
    await createCampaign(store, { lineage: "learner", campaign: 1, mode: "synthetic", startedAt: day("2026-03-02", 1), reason: "handler test" });
    const handle = makeHandler({ store: () => store, health: async () => ({ ok: true }), now: () => day("2026-03-02", 12) });
    const body = JSON.stringify({ invocation_id: "abc", data: { scheduled_at: "2026-03-02T17:00:00Z" } });
    expect((await handle(new Request("https://x/tick", { method: "POST", body }))).status).toBe(403);
    expect((await handle(new Request("https://x/tick", { method: "POST", body, headers: { "x-neon-trigger-invocation-id": "other" } }))).status).toBe(403);
    const ok = await handle(new Request("https://x/tick", { method: "POST", body, headers: { "x-neon-trigger-invocation-id": "abc" } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ok");
    expect((await handle(new Request("https://x/health"))).status).toBe(200);
    expect((await handle(new Request("https://x/anything", { method: "POST", body }))).status).toBe(404);
  });
});
