import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyBreakers, breakerEvidence, evaluateBreaker, type ClosedSignal } from "@/scripts/engine/breakers";
import { sourceActivity, activityMarker, readSourceActivity } from "@/lib/engine/activity";
import { dayBounds, calendarDay, latestPolicies, pauseTrigger, recoveryWords } from "@/lib/plain/activity";
import { decisionExplanation, skipWords } from "@/lib/plain/experiment";
import { opportunitiesFromSignals } from "@/lib/experiment/opportunities";
import type { BotPolicyRow, SignalRow } from "@/lib/neon/client";
import { parseDailyFunnel } from "@/lib/signals/daily-funnel";

vi.mock("@/scripts/engine/notify", () => ({ sendTelegram: vi.fn() }));
const now = Date.parse("2026-10-09T16:00:00Z") / 1000;
const pauseAt = "2026-10-01T16:00:00Z";
const events = [{ action: "paused", changed_at: pauseAt, reason: "rolling PF 0.4 over last 20 closed (< 0.8)", metrics: { rollingPf: 0.4, window: 20 } }];
const closed = (n: number, good: boolean): ClosedSignal[] => Array.from({ length: n }, (_, i) => ({ pnl_usd: good ? i % 2 ? -20 : 100 : -100, fill_confidence: "clean", signal_ts: new Date(Date.parse(pauseAt) + (i + 1) * 3600000).toISOString() }));

describe("recorded source recovery independent of learner trades", () => {
  it("shows the same latest in-pause clean window the guard evaluates", () => {
    const rows = [...closed(20, false), ...closed(15, true).map(r => ({ ...r, signal_ts: new Date(Date.parse(r.signal_ts) + 3 * 86400000).toISOString() }))];
    const evidence = breakerEvidence(events, rows, now, false);
    expect(evidence).toMatchObject({ paused: true, recoveryCount: 15, recoveryPf: 5.71, triggerPf: 0.4, triggerWindow: 20 });
    expect(evaluateBreaker({ events, closed: rows, nowSec: now, frozen: false }).flip?.action).toBe("resumed");
    expect(recoveryWords(evidence)).toContain("15/15");
    expect(pauseTrigger(evidence)).toContain("0.40");
  });
  it("can resume from suppressed SOURCE rows while the learner receives zero ideas", async () => {
    const sigs = closed(20, true).map((r, i) => ({ ...r, suppressed: true, orphaned: false, symbol: "MES", tier: "A", dedupe_key: `A:zone-v5:MES:${i}`, status: "hit_target", entry_price: 6000, stop_price: 5990, target_price: 6010, id: i })) as SignalRow[];
    expect(opportunitiesFromSignals(sigs, 0, new Set(), now)).toHaveLength(0);
    const inserts: unknown[] = [];
    const db = { from(table: string) {
      const query = { select: () => query, in: () => query, order: () => query, range: () => query, not: () => query, eq: () => query, like: () => query,
        insert: (row: unknown) => { inserts.push(row); return Promise.resolve({ error: null }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: table === "bot_policy" ? events : [...sigs].reverse(), error: null }).then(resolve); } };
      return query;
    } } as unknown as SupabaseClient;
    const result = await applyBreakers(db, now);
    expect(inserts).toEqual(expect.arrayContaining([expect.objectContaining({ action: "resumed", stream: "A" })]));
    expect(result.evidenceByStream.get("A")?.paused).toBe(false);
    expect(result.pausedStreams).not.toContain("A");
  });
  it("does not mistake 19 doubtful results and one clean loss for 20 usable results", () => {
    const rows = closed(20, false).map((r, i) => ({ ...r, fill_confidence: i ? "doubtful" : "clean" }));
    expect(evaluateBreaker({ events: [], closed: rows, nowSec: now, frozen: false }).flip).toBeNull();
  });
  it("keeps old missing metrics and frozen recovery honest", () => {
    expect(pauseTrigger()).toContain("not recorded");
    expect(recoveryWords()).toContain("unavailable");
    expect(recoveryWords(breakerEvidence(events, closed(20, true), now, true))).toContain("frozen");
    expect(parseDailyFunnel({ dateKey: "2026-10-09", streams: [{ key: "A", breaker: { paused: true } }] })?.streams[0].breaker).toBeUndefined();
  });
});

describe("calendar totals and compatible policy history", () => {
  it("uses precisely the October 9 IST interval", () => {
    expect(dayBounds("2026-10-09", "IST")).toEqual({ start: "2026-10-08T18:30:00.000Z", end: "2026-10-09T18:30:00.000Z" });
    expect(calendarDay(Date.parse("2026-10-08T18:30:00Z") / 1000, "IST")).toBe("2026-10-09");
  });
  it("follows both ET daylight-saving transitions", () => {
    for (const [day, hours] of [["2026-03-08", 23], ["2026-11-01", 25]] as const) {
      const b = dayBounds(day, "ET"); expect((Date.parse(b.end) - Date.parse(b.start)) / 3600000).toBe(hours);
    }
  });
  it("a newer canonical resume supersedes a legacy pause", () => {
    const rows = [{ id: 1, stream: "B:MNQ", action: "paused", changed_at: pauseAt }, { id: 2, stream: "B:rsi-reversion:MNQ", action: "resumed", changed_at: "2026-10-09T15:00:00Z" }] as BotPolicyRow[];
    expect(latestPolicies(rows).get("B:rsi-reversion:MNQ")?.action).toBe("resumed");
    expect(latestPolicies(rows, "2026-10-08T18:30:00Z").get("B:rsi-reversion:MNQ")?.action).toBe("paused");
  });
});

describe("canonical zero-trade source outcomes", () => {
  const base = { codeSha: "sha", observedAt: "2026-10-09T16:00:00Z", tradingDay: "2026-10-09", marketAsOf: { MES: "2026-10-09T15:45:00Z", MNQ: "2026-10-09T15:45:00Z" }, pausedStreams: ["A"], simulatedIdeas: 3, eligibleIdeas: 0, scheduled: true, entryWindow: true, stale: false, errors: [] };
  it("records pause plus zero ideas rather than a model rejection", () => {
    const a = sourceActivity(base); expect(a.state).toBe("source-paused");
    expect(a.reasonCodes).toEqual(["source-paused", "no-eligible-ideas"]);
    expect(readSourceActivity(`old note; ${activityMarker(a)}`)).toEqual(a);
    expect(readSourceActivity("old note only")).toBeNull();
  });
  it("distinguishes missing data, stale data, faults and the resting schedule", () => {
    expect(sourceActivity({ ...base, marketAsOf: { MES: null, MNQ: null } }).state).toBe("data-unavailable");
    expect(sourceActivity({ ...base, stale: true }).state).toBe("data-stale");
    expect(sourceActivity({ ...base, errors: ["archive-write"] }).state).toBe("component-error");
    expect(sourceActivity({ ...base, scheduled: false, entryWindow: false, stale: true }).state).toBe("market-closed");
  });
});

describe("exact learner skip explanations", () => {
  it("does not claim a full limit was already reached when only room was too small", () => {
    expect(skipWords("open-risk")).toContain("room remained");
    expect(skipWords("daily-loss")).toContain("remaining");
    expect(skipWords("future-reason")).toContain("future-reason");
    const row = { reason: "open-risk", p_win: null, threshold: null, ref_price: 6000, idea: null };
    expect(decisionExplanation(row, String)[0]).toContain("not saved");
    expect(decisionExplanation({ ...row, reason: "model-skip", p_win: 0.421, threshold: 0.525 }, String)[0]).toContain("42.1%; required 52.5%");
  });
});
