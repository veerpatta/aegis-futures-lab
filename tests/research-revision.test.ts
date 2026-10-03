import { describe, expect, it } from "vitest";
import { decisionIndexes, sessionEndSec, untakenReadyToClose, UNTAKEN_GRACE_SEC } from "@/scripts/engine/research-observer";
import { isUnmeasured, standingOf, STRATEGIES } from "@/lib/strategies/registry";
import type { Bar } from "@/lib/types";

const bars = (n: number, start = 1_790_000_000): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: start + i * 300, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe("observer catch-up (2026-10-03 research-code revision)", () => {
  it("defaults to the legacy last-bar-only decision", () => {
    expect(decisionIndexes(bars(10))).toEqual([9]);
    expect(decisionIndexes(bars(10), 0)).toEqual([9]);
    expect(decisionIndexes([])).toEqual([]);
  });

  it("decides on every finished bar in the window, oldest first", () => {
    // 30 minutes of 5-minute bars = the last bar plus the six before it.
    expect(decisionIndexes(bars(20), 1800)).toEqual([13, 14, 15, 16, 17, 18, 19]);
  });

  it("never reaches before the first bar", () => {
    expect(decisionIndexes(bars(3), 1800)).toEqual([0, 1, 2]);
  });
});

describe("untaken intents close once their session is over", () => {
  // Tuesday 2026-08-18, 10:00 ET (EDT) = 14:00 UTC; flat at 15:25 ET = 19:25 UTC.
  const entry = Date.parse("2026-08-18T14:00:00Z") / 1000;
  it("ends the session at the engine's flatten time", () => {
    expect(sessionEndSec(entry)).toBe(Date.parse("2026-08-18T19:25:00Z") / 1000);
  });
  it("waits a grace period before closing", () => {
    const end = sessionEndSec(entry);
    expect(untakenReadyToClose(entry, end + UNTAKEN_GRACE_SEC)).toBe(false);
    expect(untakenReadyToClose(entry, end + UNTAKEN_GRACE_SEC + 1)).toBe(true);
  });
  it("treats a Globex-evening decision as the next session's", () => {
    // 20:00 ET Monday belongs to Tuesday's session, so it is not closed Tuesday morning.
    const evening = Date.parse("2026-08-18T00:00:00Z") / 1000;
    expect(untakenReadyToClose(evening, Date.parse("2026-08-18T13:00:00Z") / 1000)).toBe(false);
  });
});

describe("standing of the benchmark-less classics", () => {
  it("is 'unmeasured', not the old default 'measured'", () => {
    for (const id of ["ema-cross", "orb", "vwap-reversion", "bollinger-breakout"]) {
      expect(isUnmeasured(id), id).toBe(true);
      expect(standingOf(id), id).toBe("unmeasured");
    }
  });
  it("leaves no registered strategy in the unbacked 'measured' state", () => {
    for (const s of STRATEGIES) expect(standingOf(s.id), s.id).not.toBe("measured");
  });
});
