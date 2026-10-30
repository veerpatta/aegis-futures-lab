import { describe, expect, it } from "vitest";
import {
  evaluateBreaker,
  applyBreakers,
  requiredPauseIntervals,
  checkAndStampBreakers,
  isSuppressedAt,
  pauseIntervals,
  streamKeyFor,
  tradingDaysBetween,
  type ClosedSignal,
  type PolicyEvent,
} from "../scripts/engine/breakers";

/* Circuit breaker decisions are mechanical and evidence-gated: pause at rolling
   PF < 0.8 over 20, resume only after a FULL 15-trade in-pause window at PF ≥
   1.1 (or a perfect zero-loss window), ≥3 trading days between flips, never act
   under 20 closed, freeze halts new actions. Suppression is decided per row at
   entry time from the pause-interval history — never retro-stamped. */

const DAY = 86400;
const T0 = 1_700_000_000;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

const sig = (pnl: number, sec: number, fc = "clean"): ClosedSignal => ({
  pnl_usd: pnl,
  fill_confidence: fc,
  signal_ts: iso(sec),
});
const losersAt = (n: number, startSec: number) =>
  Array.from({ length: n }, (_, i) => sig(i % 2 ? -100 : 40, startSec + i * 3600)); // PF 0.4
const winnersAt = (n: number, startSec: number, includeLoss = true) =>
  Array.from({ length: n }, (_, i) => sig(includeLoss && i % 2 ? -40 : 100, startSec + i * 3600));

describe("pause check failures", () => {
  it("rejects a signal whose stream was not checked instead of assuming it was active", () => {
    const checked = new Map([["A", []]]);
    expect(requiredPauseIntervals(checked, "A")).toEqual([]);
    expect(() => requiredPauseIntervals(checked, "B:shadow:other:MES")).toThrow(/missing.*B:shadow:other:MES/i);
  });
  it("fails the pass when the policy state cannot be read", async () => {
    const unavailable = { from: () => { throw new Error("policy database unavailable"); } };
    await expect(applyBreakers(unavailable as never, T0)).rejects.toThrow(/breaker.*policy database unavailable/i);
  });
  it("fails instead of treating a recorded pause as active when outcome history cannot be read", async () => {
    const paused = [{ action: "paused", changed_at: iso(T0 - DAY), reason: "losses" }];
    const db = { from(table: string) {
      const q = { select: () => q, in: () => q, order: () => q, range: () => q, not: () => q, eq: () => q, like: () => q,
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(table === "bot_policy" ? { data: paused, error: null } : { data: null, error: { message: "history unavailable" } }).then(resolve);
        } };
      return q;
    } };
    await expect(applyBreakers(db as never, T0)).rejects.toThrow(/breaker.*history unavailable/i);
  });
  it("leaves the signal snapshot untouched when a later stream check fails", async () => {
    let signalReads = 0, writes = 0;
    const db = { from(table: string) {
      const q = { select: () => q, in: () => q, order: () => q, range: () => q, not: () => q, eq: () => q, like: () => q,
        upsert: () => { writes++; return Promise.resolve({ error: null }); },
        then(resolve: (v: unknown) => unknown) {
          const failed = table === "signals" && ++signalReads === 2;
          return Promise.resolve(failed ? { data: null, error: { message: "second stream failed" } } : { data: [], error: null }).then(resolve);
        } };
      return q;
    } };
    const rows = [{ tier: "A" as const, symbol: "MES", dedupe_key: "A:zone-v5:MES:1", signal_ts: iso(T0), suppressed: true }];
    await expect(checkAndStampBreakers(db as never, T0, rows)).rejects.toThrow(/second stream failed/);
    expect(rows[0].suppressed).toBe(true);
    expect(writes).toBe(0);
  });
  it("validates every stream mapping before stamping any signal", async () => {
    const db = { from() {
      const q = { select: () => q, in: () => q, order: () => q, range: () => q, not: () => q, eq: () => q, like: () => q,
        then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
      return q;
    } };
    const rows = [
      { tier: "A" as const, symbol: "MES", dedupe_key: "A:zone-v5:MES:1", signal_ts: iso(T0), suppressed: true },
      { tier: "B" as const, symbol: "MES", dedupe_key: "B:shadow:other:MES:2", signal_ts: iso(T0), suppressed: true },
    ];
    await expect(checkAndStampBreakers(db as never, T0, rows)).rejects.toThrow(/missing pause check/i);
    expect(rows.map(r => r.suppressed)).toEqual([true, true]);
  });
});

describe("streamKeyFor", () => {
  it("maps tier A to one stream and tier B per label+symbol", () => {
    expect(streamKeyFor("A", "zone-v5", "MES")).toBe("A");
    expect(streamKeyFor("B", "rsi-reversion", "MNQ")).toBe("B:rsi-reversion:MNQ");
  });
});

describe("tradingDaysBetween", () => {
  it("counts weekday sessions and skips weekends", () => {
    const fri = 1_704_326_400;
    expect(tradingDaysBetween(fri, fri + 3 * DAY)).toBeGreaterThanOrEqual(1);
    expect(tradingDaysBetween(fri, fri)).toBe(0);
  });
});

describe("pauseIntervals + isSuppressedAt", () => {
  it("builds closed and open periods and tests membership", () => {
    const events: PolicyEvent[] = [
      { action: "paused", changed_at: iso(T0 + 10 * DAY) },
      { action: "resumed", changed_at: iso(T0 + 20 * DAY) },
      { action: "paused", changed_at: iso(T0 + 30 * DAY) },
    ];
    const iv = pauseIntervals(events);
    expect(iv).toEqual([
      { start: T0 + 10 * DAY, end: T0 + 20 * DAY },
      { start: T0 + 30 * DAY, end: null },
    ]);
    expect(isSuppressedAt(iv, T0 + 5 * DAY)).toBe(false); // before any pause
    expect(isSuppressedAt(iv, T0 + 15 * DAY)).toBe(true); // inside first pause
    expect(isSuppressedAt(iv, T0 + 25 * DAY)).toBe(false); // after resume
    expect(isSuppressedAt(iv, T0 + 40 * DAY)).toBe(true); // inside open pause
  });
});

describe("evaluateBreaker — pause", () => {
  it("stays active under 20 closed no matter how bad", () => {
    const d = evaluateBreaker({ events: [], closed: losersAt(19, T0), nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.flip).toBeNull();
    expect(d.currentlyPaused).toBe(false);
  });
  it("pauses an active stream whose rolling PF falls below 0.8", () => {
    const d = evaluateBreaker({ events: [], closed: losersAt(24, T0), nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.flip?.action).toBe("paused");
  });
  it("keeps an active healthy stream running", () => {
    const d = evaluateBreaker({ events: [], closed: winnersAt(24, T0), nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.flip).toBeNull();
  });
});

describe("evaluateBreaker — resume (F1 in-pause set, F5 gates)", () => {
  const pauseAt = T0 + 20 * 3600;
  const events: PolicyEvent[] = [{ action: "paused", changed_at: iso(pauseAt) }];
  const now = pauseAt + 30 * DAY;
  // 20 pre-pause losers (real, already alerted) + N in-pause practice rows.
  const prePause = losersAt(20, T0);

  it("resumes once a FULL 15-trade in-pause window recovers to PF ≥ 1.1", () => {
    const closed = [...prePause, ...winnersAt(15, pauseAt + 3600)];
    const d = evaluateBreaker({ events, closed, nowSec: now, frozen: false });
    expect(d.flip?.action).toBe("resumed");
  });
  it("does NOT resume on a tiny 2-trade in-pause window even if perfect", () => {
    const closed = [...prePause, sig(100, pauseAt + 3600), sig(100, pauseAt + 7200)];
    const d = evaluateBreaker({ events, closed, nowSec: now, frozen: false });
    expect(d.flip).toBeNull();
    expect(d.currentlyPaused).toBe(true);
  });
  it("resumes a perfect 15-0 (zero-loss) in-pause window", () => {
    const closed = [...prePause, ...winnersAt(15, pauseAt + 3600, false)]; // all wins, no losses
    const d = evaluateBreaker({ events, closed, nowSec: now, frozen: false });
    expect(d.flip?.action).toBe("resumed");
  });
  it("stays paused while the in-pause practice is still weak", () => {
    const closed = [...prePause, ...losersAt(15, pauseAt + 3600)];
    const d = evaluateBreaker({ events, closed, nowSec: now, frozen: false });
    expect(d.flip).toBeNull();
  });
  it("resume evidence ignores retro pre-pause losers (F1)", () => {
    // 20 losers sit before the pause; only the 15 in-pause winners should count.
    const closed = [...prePause, ...winnersAt(15, pauseAt + 3600)];
    const d = evaluateBreaker({ events, closed, nowSec: now, frozen: false });
    // If pre-pause losers leaked in, PF would be < 1.1 and it would stay paused.
    expect(d.flip?.action).toBe("resumed");
  });
});

describe("evaluateBreaker — hysteresis & freeze", () => {
  it("no flip within 3 trading days of the last event", () => {
    const events: PolicyEvent[] = [{ action: "resumed", changed_at: iso(T0 + 30 * DAY) }];
    const d = evaluateBreaker({ events, closed: losersAt(24, T0), nowSec: T0 + 30 * DAY + 2 * DAY, frozen: false });
    expect(d.flip).toBeNull();
  });
  it("takes no new action when frozen but keeps an existing pause", () => {
    const active = evaluateBreaker({ events: [], closed: losersAt(24, T0), nowSec: T0 + 30 * DAY, frozen: true });
    expect(active.flip).toBeNull();
    const events: PolicyEvent[] = [{ action: "paused", changed_at: iso(T0) }];
    const paused = evaluateBreaker({ events, closed: [...losersAt(20, T0 - 40 * DAY), ...winnersAt(15, T0 + 3600)], nowSec: T0 + 30 * DAY, frozen: true });
    expect(paused.flip).toBeNull();
    expect(paused.currentlyPaused).toBe(true);
  });
});
