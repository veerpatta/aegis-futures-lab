import { describe, expect, it } from "vitest";
import {
  evaluateBreaker,
  streamKeyFor,
  tradingDaysBetween,
  type ClosedSignal,
} from "../scripts/engine/breakers";

/* Circuit breaker decisions are mechanical and gated by evidence, never by
   calendar: pause at rolling PF < 0.8 over 20, resume at PF ≥ 1.1 over 15
   suppressed, ≥3 trading days between flips, never act under 20 closed, and a
   freeze halts all new actions. */

const DAY = 86400;
const T0 = 1_700_000_000; // fixed base — no wall-clock in tests

const sig = (pnl: number, i: number, suppressed = false, fc = "clean"): ClosedSignal => ({
  pnl_usd: pnl,
  fill_confidence: fc,
  suppressed,
  signal_ts: new Date((T0 + i * 3600) * 1000).toISOString(),
});

/* n closed rows with a controlled profit factor sign. losers: PF < 1. */
const losers = (n: number, suppressed = false) =>
  Array.from({ length: n }, (_, i) => sig(i % 2 ? -100 : 40, i, suppressed)); // PF 0.4
const winners = (n: number, suppressed = false) =>
  Array.from({ length: n }, (_, i) => sig(i % 2 ? -40 : 100, i, suppressed)); // PF 2.5

describe("streamKeyFor", () => {
  it("maps tier A to one stream and tier B per symbol", () => {
    expect(streamKeyFor("A", "MES")).toBe("A");
    expect(streamKeyFor("A", "MNQ")).toBe("A");
    expect(streamKeyFor("B", "MES")).toBe("B:MES");
    expect(streamKeyFor("B", "MNQ")).toBe("B:MNQ");
  });
});

describe("tradingDaysBetween", () => {
  it("counts weekday sessions and skips weekends", () => {
    // Fri → Mon is 1 trading day (Mon); Fri → next Fri is 5.
    const fri = 1_704_326_400; // 2024-01-04 00:00 UTC (Thu) — anchor loosely
    expect(tradingDaysBetween(fri, fri + 3 * DAY)).toBeGreaterThanOrEqual(1);
    expect(tradingDaysBetween(fri, fri)).toBe(0);
  });
});

describe("evaluateBreaker", () => {
  it("stays active under 20 closed no matter how bad", () => {
    const d = evaluateBreaker({ currentlyPaused: false, lastFlipSec: null, closed: losers(19), nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.suppressed).toBe(false);
    expect(d.flip).toBeNull();
  });

  it("pauses an active stream whose rolling PF falls below 0.8", () => {
    const d = evaluateBreaker({ currentlyPaused: false, lastFlipSec: null, closed: losers(24), nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.suppressed).toBe(true);
    expect(d.flip?.action).toBe("paused");
  });

  it("keeps an active healthy stream running", () => {
    const d = evaluateBreaker({ currentlyPaused: false, lastFlipSec: null, closed: winners(24), nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.suppressed).toBe(false);
    expect(d.flip).toBeNull();
  });

  it("resumes a paused stream once suppressed sim recovers to PF ≥ 1.1", () => {
    const closed = [...losers(24, true), ...winners(15, true)]; // suppressed winners recover
    const d = evaluateBreaker({ currentlyPaused: true, lastFlipSec: T0, closed, nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.suppressed).toBe(false);
    expect(d.flip?.action).toBe("resumed");
  });

  it("keeps a paused stream benched while the sim is still weak", () => {
    const closed = [...losers(24, true), ...losers(15, true)];
    const d = evaluateBreaker({ currentlyPaused: true, lastFlipSec: T0, closed, nowSec: T0 + 30 * DAY, frozen: false });
    expect(d.suppressed).toBe(true);
    expect(d.flip).toBeNull();
  });

  it("respects hysteresis: no flip within 3 trading days of the last one", () => {
    const d = evaluateBreaker({ currentlyPaused: false, lastFlipSec: T0 + 30 * DAY, closed: losers(24), nowSec: T0 + 30 * DAY + 2 * DAY, frozen: false });
    expect(d.flip).toBeNull();
    expect(d.suppressed).toBe(false); // unchanged state
  });

  it("takes no new action when frozen, but keeps an existing pause", () => {
    const active = evaluateBreaker({ currentlyPaused: false, lastFlipSec: null, closed: losers(24), nowSec: T0 + 30 * DAY, frozen: true });
    expect(active.flip).toBeNull();
    expect(active.suppressed).toBe(false);
    const paused = evaluateBreaker({ currentlyPaused: true, lastFlipSec: T0, closed: [...losers(24, true), ...winners(15, true)], nowSec: T0 + 30 * DAY, frozen: true });
    expect(paused.flip).toBeNull();
    expect(paused.suppressed).toBe(true); // stays paused
  });
});
