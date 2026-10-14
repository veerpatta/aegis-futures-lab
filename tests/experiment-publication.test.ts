import { describe, expect, it } from "vitest";
import { publicationWatermarks } from "@/lib/experiment/publication";
import { staleAtSignal } from "@/lib/signals/freshness";
import { stepDelayed } from "@/lib/experiment/delayed";
import { TAKE_ALL_V1 } from "@/lib/experiment/models";
import { nyTimeToUnix } from "@/lib/time/ny";
import type { TickInput } from "@/lib/experiment/step";
import type { Bar } from "@/lib/types";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { createCampaign, runJob } from "@/lib/experiment/jobs";
import type { SignalRow } from "@/lib/neon/client";
import { sourceTiming, type ExpOverview } from "@/lib/experiment/view";

const at = (minutes: number) => nyTimeToUnix("2026-10-14", 11 * 60 + minutes);
const bar = (minutes: number): Bar => ({ time: at(minutes), open: 6000, high: 6001, low: 5999, close: 6000 });
const marks = (minutes: number) => ({ MES: at(minutes), MNQ: at(minutes) });
const batch = (minutes: number, now = 60) => publicationWatermarks(
  { MES: new Date(at(minutes) * 1000).toISOString(), MNQ: new Date(at(minutes) * 1000).toISOString() }, marks(minutes), at(now));
const input = (): TickInput => ({
  exp: { id: "d-1", lineage: "d", campaign: 1, mode: "live", status: "active", capital: 10000,
    startedAt: at(-60), simulationFrom: at(-60), seed: 1, executionClock: "delayed_market" },
  account: { equity: 10000, peak: 10000, realized: 0, unrealized: 0, dailyPnl: 0, dayStartEquity: 10000,
    unpricedPositions: 0, dayKey: "", dayHalted: false, openRisk: 0, lockedAt: null,
    cursor: marks(-30), staleSymbols: [], lastOkTickAt: null },
  positions: [], outcomes: [], opportunities: [], model: { versionId: "d-1:v1-take-all", artifact: TAKE_ALL_V1 },
  challengers: [], quota: "normal", nowSec: at(60),
  bars: { MES: Array.from({ length: 18 }, (_, i) => bar(-30 + i * 5)), MNQ: Array.from({ length: 18 }, (_, i) => bar(-30 + i * 5)) },
});
const idea = () => ({ key: "B:rsi-reversion:MES:one", signalId: 1, symbol: "MES" as const, side: "LONG" as const,
  entry: 6000, stop: 5990, target: 6020, signalTs: at(0), seenAt: at(40), exitTs: null,
  strategy: "rsi-reversion", tier: "B", regime: null, vixBucket: null, score: null, rr: 2 });

describe("source eligibility and delayed portfolio publication", () => {
  it("carries source timing through the scheduled job and its saved UI evidence", async () => {
    const store = new MemoryStore();
    await createCampaign(store, { lineage: "d", campaign: 1, mode: "live", startedAt: at(-30),
      simulationFrom: at(-30), executionClock: "delayed_market", reason: "timing regression" });
    store.bars = input().bars;
    store.publishedBatch = { id: "first", watermarks: batch(25) };
    const run = (id: string) => runJob({ job: "tick", invocationId: id, trigger: "test", store, lineage: "d", nowSec: at(60) });
    await run("first");
    store.publishedBatch = { id: "second", watermarks: batch(45) };
    store.signalRows = [{ id: 1, dedupe_key: idea().key, symbol: "MES", direction: "long", entry_price: 6000,
      stop_price: 5990, target_price: 6020, signal_ts: new Date(at(0) * 1000).toISOString(),
      created_at: new Date(at(40) * 1000).toISOString(), status: "triggered", tier: "B" } as unknown as SignalRow];
    const result = await run("second");
    expect(result.status).toBe("ok"); expect(result.counts.entries).toBe(1);
    expect(result.counts.sourceSettlementSeconds).toBe(1800);
    expect(result.counts.freshness).toEqual({ MES: "current", MNQ: "current" });
    const overview = { last_runs: { tick: { counts: result.counts } } } as unknown as ExpOverview;
    expect(sourceTiming(overview)).toEqual({ availableAt: at(45), settlementMinutes: 30 });
    expect(sourceTiming(null)).toBeNull();
    expect((await run("second")).status).toBe("replayed");
    expect(store.fills.size).toBe(1);
  });
  it("waits for the source guard, then accepts and fills the idea once", () => {
    // Pass 1: source has bars through 11:25; entry at 11:00 is still hidden.
    expect(staleAtSignal(at(0), at(20))).toBe(true);
    const oldFirst = stepDelayed(input(), marks(25));
    const oldNext = stepDelayed({ ...input(), account: oldFirst.account, opportunities: [idea()] }, marks(45));
    expect(oldNext.decisions[0].reason).toBe("late-source");
    expect(oldNext.fills).toHaveLength(0);
    const first = stepDelayed(input(), batch(25));
    expect(first.account.dataAsOf).toBe(at(-5));
    expect(first.decisions).toHaveLength(0);
    // Pass 2: the source can now publish the same setup. Previously the account
    // was already at 11:25 and permanently rejected it as late-source.
    expect(staleAtSignal(at(0), at(40))).toBe(false);
    const second = stepDelayed({ ...input(), account: first.account, opportunities: [idea()] }, batch(45));
    expect(second.decisions.map(d => d.reason)).toEqual(["taken"]);
    expect(second.decisions[0].decidedAt).toBe(at(5));
    expect(second.decisions[0].observedAt).toBe(at(40));
    expect(second.decisions[0].provenance).toBe("replay");
    expect(second.fills.map(f => f.kind)).toEqual(["entry"]);
    expect(second.positions[0].fillTs).toBe(at(5));
    expect(second.account.openRisk).toBeLessThanOrEqual(200);
    const retry = stepDelayed({ ...input(), account: second.account, positions: second.positions, outcomes: second.outcomes }, batch(45));
    expect(retry.fills).toHaveLength(0);
    expect(retry.account.equity).toBe(second.account.equity);
  });

  it("includes the exact eligibility boundary, with no lookahead into waiting bars", () => {
    expect(staleAtSignal(at(0), at(30))).toBe(false);
    const a = stepDelayed({ ...input(), opportunities: [idea()] }, batch(35));
    expect(a.decisions[0].reason).toBe("taken");
    expect(a.account.dataAsOf).toBe(at(5));
    expect(a.positions[0].status).toBe("pending_fill");
    const changed = input();
    changed.bars.MES = changed.bars.MES!.map(b => b.time >= at(5) ? { ...b, open: 6100, high: 6200, low: 5800, close: 6100 } : b);
    const b = stepDelayed({ ...changed, opportunities: [idea()] }, batch(35));
    expect(b.decisions).toEqual(a.decisions);
    expect(b.fills).toHaveLength(0);
  });

  it("uses actual feed availability for freshness, not the intentional delay", () => {
    const r = stepDelayed(input(), batch(45));
    expect(r.account.dataAsOf).toBe(at(15));
    expect(r.freshness).toEqual({ MES: "current", MNQ: "current" });
    const stalled = stepDelayed({ ...input(), nowSec: at(100) }, batch(45, 100));
    expect(stalled.freshness.MES).toBe("stale");
  });

  it("never rewinds an existing cursor when the holdback is first enabled", () => {
    const state = { ...input(), account: { ...input().account, cursor: marks(25) }, opportunities: [idea()] };
    const waiting = stepDelayed(state, batch(45));
    expect(waiting.account.cursor).toEqual(marks(25));
    expect(waiting.decisions).toHaveLength(0);
    expect(waiting.fills).toHaveLength(0);
    const later = stepDelayed(state, batch(60));
    expect(later.decisions[0].reason).toBe("late-source");
    expect(later.fills).toHaveLength(0);
    expect(later.account.realized).toBe(0);
  });

  it("bounds each feed by both the completed pass and the actual archive", () => {
    const r = publicationWatermarks({ MES: new Date(at(45) * 1000).toISOString(), MNQ: new Date(at(55) * 1000).toISOString() },
      { MES: at(60), MNQ: at(40) }, at(60));
    expect(r.available).toEqual({ MES: at(45), MNQ: at(40) });
    expect(r.MES).toBe(at(15)); expect(r.MNQ).toBe(at(10));
    expect(stepDelayed(input(), r).account.dataAsOf).toBe(at(10));
    expect(() => publicationWatermarks({}, marks(40), at(60))).toThrow("Completed source");
    expect(() => publicationWatermarks({ MES: "invalid" }, marks(40), at(60))).toThrow();
  });

  it("leaves publications without metadata on their legacy clock", () => {
    const r = stepDelayed(input(), marks(45));
    expect(r.account.dataAsOf).toBe(at(45));
  });
});
