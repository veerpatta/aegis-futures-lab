import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { createCampaign, runJob } from "@/lib/experiment/jobs";
import { stepDelayed } from "@/lib/experiment/delayed";
import { TAKE_ALL_V1 } from "@/lib/experiment/models";
import { opportunitiesFromSignals, publishableSignals } from "@/lib/experiment/opportunities";
import {
  CAMPAIGN_RISK, EXP_RISK, EXP_RISK_V3, perContractRisk, perTradeCap, riskFor, sizeExperimentTrade, standaloneQty, type RiskLimits,
} from "@/lib/experiment/policy";
import { CAMPAIGN_RULES, PREREG, PREREG_2026_10_07, PREREG_V3, rulesFor, type Prereg } from "@/lib/experiment/prereg";
import { stableHash } from "@/lib/experiment/hash";
import { nyTimeToUnix } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import type { SignalRow } from "@/lib/neon/client";
import type { Account, Opportunity } from "@/lib/experiment/types";

const V3 = "exp-prereg-2026-11-06-v3";
const RISK_V3 = "exp-risk-2026-11-06";
const at = (m: number) => nyTimeToUnix("2026-11-04", 10 * 60 + m);
const b = (m: number, open = 6000, low = 5999, high = 6001): Bar => ({ time: at(m), open, low, high, close: open });
const base: Account = { equity: 10000, peak: 10000, realized: 0, unrealized: 0, dailyPnl: 0, dayStartEquity: 10000,
  unpricedPositions: 0, dayKey: "", dayHalted: false, openRisk: 0, lockedAt: null, cursor: {}, staleSymbols: [], lastOkTickAt: null };
const idea = (over: Partial<Opportunity> = {}): Opportunity => ({ key: "B:rsi-reversion:MES:1", signalId: 1, symbol: "MES", side: "LONG",
  entry: 6000, stop: 5990, target: 6020, signalTs: at(0), seenAt: at(5), exitTs: null, strategy: "rsi-reversion", tier: "B",
  regime: "range-low-vol", vixBucket: "low", score: null, rr: 2, ...over });
const input = (exp: { preregVersion?: string; riskVersion?: string } = {}, over: Partial<Parameters<typeof stepDelayed>[0]> = {}) => ({
  exp: { id: "v-1", lineage: "v", campaign: 1, mode: "live" as const, status: "active" as const, capital: 10000,
    startedAt: at(0), simulationFrom: at(0), seed: 1, executionClock: "delayed_market" as const, ...exp },
  account: base, positions: [], outcomes: [], opportunities: [idea()], model: { versionId: "v-1:v1-take-all", artifact: TAKE_ALL_V1 },
  challengers: [], quota: "normal" as const, nowSec: at(45), bars: { MES: [b(0), b(5), b(10), b(15)], MNQ: [b(0), b(5), b(10), b(15)] }, ...over });
const marks = { MES: at(20), MNQ: at(20) };
const state = { equity: 10000, peak: 10000, dailyPnl: 0, openRisk: 0, locked: false, dayHalted: false };

describe("v3 rules: registered next to v1/v2, never instead of them", () => {
  it("new campaigns get v3; running campaigns keep the rules stored with them", () => {
    expect(CAMPAIGN_RULES).toBe(PREREG_V3);
    expect(CAMPAIGN_RISK).toBe(EXP_RISK_V3);
    expect(rulesFor(V3)).toBe(PREREG_V3);
    expect(rulesFor(PREREG.version)).toBe(PREREG);
    expect(rulesFor(PREREG_2026_10_07.version)).toBe(PREREG_2026_10_07);
    expect(riskFor(RISK_V3)).toBe(EXP_RISK_V3);
    expect(riskFor(EXP_RISK.version)).toBe(EXP_RISK);
    expect(riskFor(undefined)).toBe(EXP_RISK);
    expect(() => riskFor("exp-risk-made-up")).toThrow(/Unknown risk version/);
  });

  it("v1/v2 keep their meaning: no idea rule, no fresh delayed evidence, no single-contract exception", () => {
    for (const p of [PREREG_2026_10_07, PREREG] as Prereg[]) {
      expect(p.ideas).toBeUndefined();
      expect(p.freshness).toBeUndefined();
    }
    expect((EXP_RISK as RiskLimits).singleContractMax).toBeUndefined();
    // learner-1's frozen rules hash is pinned elsewhere; the v1 object itself must not have grown.
    expect(Object.keys(PREREG_2026_10_07).sort()).toEqual(["allowSyntheticEvidence", "gates", "incumbent", "lifecycle", "rollback", "search", "seed", "version"]);
  });

  it("v3 changes only what the learner sees, never what counts as a pass", () => {
    const { version: _v, ideas, freshness, ...rest } = PREREG_V3;
    const { version: _w, ...v2 } = PREREG;
    expect(stableHash(rest)).toBe(stableHash(v2));
    expect(ideas).toBe("all-filled");
    expect(freshness).toEqual({ delayedProspectiveLagSec: 7200 });
    const { version: _a, singleContractMax, ...riskRest } = EXP_RISK_V3;
    const { version: _b, ...risk2 } = EXP_RISK;
    expect(riskRest).toEqual(risk2);
    expect(singleContractMax).toBe(150);
  });
});

describe("v3 handover fence", () => {
  it("lets the outdated Neon build run v1/v2 campaigns only", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(`${__dirname}/../db/migrations/20261106_learner_v3_runner_fence.sql`, "utf8");
    const allowed = [...sql.matchAll(/''(exp-prereg-[a-z0-9-]+)''/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual([PREREG_2026_10_07.version, PREREG.version].sort());
    expect(allowed).not.toContain(V3);
    expect(sql).toContain("NEW.code_sha = ''f194c9a99c5e9bd1131863897839d42d959403f8''");
    expect(sql).toMatch(/BEFORE INSERT ON public\.experiment_runs/);
  });
});

describe("v3 sizing: one micro contract up to $150, inside every other limit", () => {
  it("takes one contract a v2 campaign would skip", () => {
    expect(sizeExperimentTrade(state, 123)).toEqual({ qty: 0, reason: "risk-budget" });
    expect(sizeExperimentTrade(state, 123, EXP_RISK_V3)).toEqual({ qty: 1, reason: null });
    expect(sizeExperimentTrade(state, 151, EXP_RISK_V3)).toEqual({ qty: 0, reason: "risk-budget" });
  });

  it("sizes ordinary ideas exactly as before", () => {
    for (const r of [20, 33.3, 45, 99.9, 100]) expect(sizeExperimentTrade(state, r, EXP_RISK_V3)).toEqual(sizeExperimentTrade(state, r));
  });

  it("never breaks the open-risk or daily room", () => {
    expect(sizeExperimentTrade({ ...state, openRisk: 120 }, 123, EXP_RISK_V3)).toEqual({ qty: 0, reason: "open-risk" });
    expect(sizeExperimentTrade({ ...state, equity: 9670, dailyPnl: -330 }, 123, EXP_RISK_V3)).toEqual({ qty: 0, reason: "daily-loss" });
    expect(sizeExperimentTrade({ ...state, locked: true }, 123, EXP_RISK_V3).qty).toBe(0);
  });

  it("caps a one-contract fill at $150 and anything larger at $100", () => {
    expect(perTradeCap(1, EXP_RISK_V3)).toBe(150);
    expect(perTradeCap(2, EXP_RISK_V3)).toBe(100);
    expect(perTradeCap(1)).toBe(100);
    expect(standaloneQty(123, EXP_RISK_V3)).toBe(1);
    expect(standaloneQty(123)).toBe(0);
    expect(standaloneQty(151, EXP_RISK_V3)).toBe(0);
    expect(standaloneQty(45, EXP_RISK_V3)).toBe(2);
  });

  it("a wide-stop idea: skipped under v2, filled at one contract under v3", () => {
    const wide = idea({ stop: 5976, target: 6048 });
    expect(perContractRisk("MES", 6000, 5976, at(5))).toBeGreaterThan(100);
    const v2 = stepDelayed(input({}, { opportunities: [wide] }), marks);
    const v3 = stepDelayed(input({ preregVersion: V3, riskVersion: RISK_V3 }, { opportunities: [wide] }), marks);
    expect(v2.decisions[0].reason).toBe("risk-budget");
    expect(v3.decisions[0]).toMatchObject({ reason: "taken", qty: 1 });
    expect(v3.positions[0]).toMatchObject({ qty: 1, status: "open" });
    expect(v3.positions[0].risk!).toBeLessThanOrEqual(150);
    expect(v3.decisions[0].idea.decisionEvidence?.limits).toMatchObject({ version: RISK_V3, singleContractMax: 150 });
  });
});

describe("v3 fresh evidence on the delayed-market clock", () => {
  it("labels a decision processed within two hours prospective, a later backlog replay", () => {
    const soon = stepDelayed(input({ preregVersion: V3, riskVersion: RISK_V3 }, { nowSec: at(45) }), marks);
    const late = stepDelayed(input({ preregVersion: V3, riskVersion: RISK_V3 }, { nowSec: at(5) + 2 * 3600 + 60 }), marks);
    expect(soon.decisions[0].provenance).toBe("prospective");
    expect(late.decisions[0].provenance).toBe("replay");
    // Identical decision either way: only the evidence label differs.
    const strip = (d: (typeof soon.decisions)[number]) => ({ ...d, provenance: null });
    expect(strip(soon.decisions[0])).toEqual(strip(late.decisions[0]));
  });

  it("v2 campaigns stay replay, as registered", () => {
    expect(stepDelayed(input({}, { nowSec: at(45) }), marks).decisions[0].provenance).toBe("replay");
    expect(stepDelayed(input({ preregVersion: PREREG.version }, { nowSec: at(45) }), marks).decisions[0].provenance).toBe("replay");
  });
});

describe("v3 ideas: paused methods are decided too, and flagged", () => {
  const row = (over: Partial<SignalRow>): SignalRow => ({
    id: 1, symbol: "MES", direction: "long", entry_price: 6000, stop_price: 5990, target_price: 6020, status: "triggered",
    signal_ts: new Date(at(0) * 1000).toISOString(), created_at: new Date(at(5) * 1000).toISOString(),
    exit_ts: null, dedupe_key: "B:rsi-reversion:MES:1", tier: "B", suppressed: false, stale_data: false, ...over,
  } as unknown as SignalRow);
  const rows = [
    row({}),
    row({ id: 2, dedupe_key: "B:rsi-reversion:MES:2", suppressed: true }),
    row({ id: 3, dedupe_key: "B:rsi-reversion:MES:3", stale_data: true }),
  ];

  it("v2 drops paused ideas and keeps its stored shape; v3 includes them, flagged", () => {
    const v2 = opportunitiesFromSignals(rows, at(0), new Set(), at(60));
    const v3 = opportunitiesFromSignals(rows, at(0), new Set(), at(60), { includePaused: true });
    expect(v2.map((o) => o.key)).toEqual(["B:rsi-reversion:MES:1"]);
    expect("sourcePaused" in v2[0]).toBe(false);
    expect(v3.map((o) => [o.key, o.sourcePaused])).toEqual([["B:rsi-reversion:MES:1", false], ["B:rsi-reversion:MES:2", true]]);
  });

  it("publishes paused ideas but never ones built on stale bars", () => {
    expect(publishableSignals(rows).map((r) => r.id)).toEqual([1, 2]);
  });

  it("a v3 campaign trades a paused method's idea end to end", async () => {
    const store = new MemoryStore();
    const exp = await createCampaign(store, { lineage: "v3", campaign: 1, mode: "live", startedAt: at(0), simulationFrom: at(0),
      executionClock: "delayed_market", reason: "v3 end-to-end test" });
    expect(exp).toMatchObject({ preregVersion: V3, riskVersion: RISK_V3 });
    store.signalRows = [row({ dedupe_key: "B:rsi-reversion:MES:9", suppressed: true })];
    store.bars = input().bars;
    store.publishedBatch = { id: "batch", watermarks: marks };
    const res = await runJob({ job: "tick", invocationId: "t1", trigger: "test", store, lineage: "v3", nowSec: at(45), ignoreSchedule: true });
    expect(res.status).toBe("ok");
    const decisions = [...store.decisions.values()].filter((d) => d.experimentId === exp.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ reason: "taken", provenance: "prospective" });
    expect(decisions[0].idea.sourcePaused).toBe(true);
  });
});
