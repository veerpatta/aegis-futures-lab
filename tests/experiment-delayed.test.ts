import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { createCampaign, runJob } from "@/lib/experiment/jobs";
import { stepDelayed } from "@/lib/experiment/delayed";
import { TAKE_ALL_V1 } from "@/lib/experiment/models";
import { nyTimeToUnix } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import type { SignalRow } from "@/lib/neon/client";
import type { Account, Opportunity } from "@/lib/experiment/types";

const at = (m: number) => nyTimeToUnix("2026-10-07", 11 * 60 + m);
const b = (m: number, open = 6000, low = 5999, high = 6001): Bar => ({ time: at(m), open, low, high, close: open });
const base: Account = { equity: 10000, peak: 10000, realized: 0, unrealized: 0, dailyPnl: 0, dayStartEquity: 10000,
  unpricedPositions: 0, dayKey: "", dayHalted: false, openRisk: 0, lockedAt: null, cursor: {}, staleSymbols: [], lastOkTickAt: null };
const idea = (over: Partial<Opportunity> = {}): Opportunity => ({ key: "B:rsi-reversion:MES:1", signalId: 1, symbol: "MES", side: "LONG",
  entry: 6000, stop: 5990, target: 6010, signalTs: at(0), seenAt: at(50), exitTs: at(15), strategy: "rsi-reversion", tier: "B",
  regime: "range-low-vol", vixBucket: "low", score: null, rr: 1, ...over });
const input = (over: Partial<Parameters<typeof stepDelayed>[0]> = {}) => ({
  exp: { id: "delayed-1", lineage: "delayed", campaign: 1, mode: "live" as const, status: "active" as const,
    capital: 10000, startedAt: at(60), simulationFrom: at(0), seed: 1, executionClock: "delayed_market" as const },
  account: base, positions: [], outcomes: [], opportunities: [idea()], model: { versionId: "delayed-1:v1-take-all", artifact: TAKE_ALL_V1 },
  challengers: [], quota: "normal" as const, nowSec: at(60), bars: { MES: [b(0), b(5), b(10, 6011, 6000, 6012)], MNQ: [b(0), b(5), b(10)] }, ...over });
const marks = { MES: at(15), MNQ: at(15) };

describe("delayed-market portfolio execution", () => {
  it("fills and exits a delivered-late, already-closed source idea without leaking its result", () => {
    const r = stepDelayed(input(), marks);
    expect(r.decisions[0].reason).toBe("taken");
    expect(r.decisions[0].decidedAt).toBe(at(5));
    expect(r.decisions[0].observedAt).toBe(at(50));
    expect(r.decisions[0].provenance).toBe("replay");
    expect(r.decisions[0].idea.exitTs).toBeNull();
    expect(r.positions[0].fillTs).toBe(at(5));
    expect(r.positions[0].status).toBe("closed");
    expect(r.fills.map((f) => f.kind)).toEqual(["entry", "exit"]);
    expect(r.account.equity).toBeCloseTo(10000 + r.account.realized + r.account.unrealized, 2);
  });
  it("future prices do not change the frozen decision", () => {
    const a = stepDelayed(input(), marks);
    const c = input(); c.bars.MES![2] = b(10, 5900, 5800, 6200);
    const z = stepDelayed(c, marks);
    expect(z.decisions).toEqual(a.decisions);
    expect(z.account.realized).not.toBe(a.account.realized);
  });
  it("never crosses the completed publication boundary or fills without a bar", () => {
    const r = stepDelayed(input(), { MES: at(5), MNQ: at(5) });
    expect(r.positions[0].status).toBe("pending_fill");
    expect(r.fills).toHaveLength(0);
    expect(r.account.dataAsOf).toBe(at(5));
    const missing = stepDelayed(input({ bars: {}, opportunities: [] }), marks);
    expect(missing.fills).toHaveLength(0);
  });
  it("rechecks remaining portfolio risk at the actual fill", () => {
    const ops = [idea({ key: "one", stop: 5991 }), idea({ key: "two", stop: 5991 }), idea({ key: "three", stop: 5991 })];
    const r = stepDelayed(input({ opportunities: ops, bars: { MES: [b(0), b(5, 6005, 6004, 6006)], MNQ: [b(0), b(5)] } }), { MES: at(10), MNQ: at(10) });
    expect(r.account.openRisk).toBeLessThanOrEqual(200);
    for (const p of r.positions.filter((p) => p.status === "open")) expect(p.risk).toBeLessThanOrEqual(100);
    expect(r.fills.length).toBeGreaterThan(0);
  });
  it("audits a source correction behind the cursor instead of rewriting the balance", () => {
    const r = stepDelayed(input({ account: { ...base, cursor: { MES: at(15), MNQ: at(15) } } }), marks);
    expect(r.decisions[0].reason).toBe("late-source");
    expect(r.account.realized).toBe(0);
    expect(r.fills).toHaveLength(0);
  });
});

describe("published batches, transaction recovery and duplicate runners", () => {
  it("waits for publication, preserves a crash, and books a batch only once", async () => {
    const store = new MemoryStore();
    const exp = await createCampaign(store, { lineage: "d", campaign: 1, mode: "live", startedAt: at(60), simulationFrom: at(0),
      executionClock: "delayed_market", reason: "test delayed execution" });
    const row = { id: 1, symbol: "MES", direction: "long", entry_price: 6000, stop_price: 5990, target_price: 6010,
      signal_ts: new Date(at(0) * 1000).toISOString(), created_at: new Date(at(50) * 1000).toISOString(),
      status: "hit_target", exit_ts: new Date(at(15) * 1000).toISOString(), dedupe_key: "B:rsi-reversion:MES:1", tier: "B" } as unknown as SignalRow;
    store.signalRows = [row]; store.bars = input().bars;
    const run = (id: string) => runJob({ job: "tick", invocationId: id, trigger: "test", store, lineage: "d", nowSec: at(60), ignoreSchedule: true });
    expect((await run("empty")).status).toBe("skipped");
    store.publishedBatch = { id: "batch", watermarks: marks };
    store.failNextPersist = true;
    expect((await run("crash")).status).toBe("error"); expect(store.decisions.size).toBe(0);
    expect((await run("good")).status).toBe("ok");
    expect([...store.positions.values()].some((p) => p.status === "closed")).toBe(true);
    const equity = store.accounts.get(exp.id)!.equity;
    expect((await run("good")).status).toBe("replayed");
    expect((await run("other-runner")).status).toBe("ok");
    expect(store.accounts.get(exp.id)!.equity).toBe(equity);
    expect(store.decisions.size).toBe(1); expect(store.fills.size).toBe(2);
  });
});
