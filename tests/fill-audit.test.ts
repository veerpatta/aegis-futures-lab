import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { auditFill } from "../scripts/engine/fill-audit";

/* Fill-realism classes, pinned per the documented rule: clean = traded
   through the limit by ≥ 1 tick on the entry or next bar; marginal =
   touched thinly but the level was revisited within the trade's life;
   doubtful = touch-only, never revisited. */

const T0 = 1_780_000_000;

const bar = (i: number, high: number, low: number): Bar => ({
  time: T0 + i * 300,
  open: (high + low) / 2,
  high,
  low,
  close: (high + low) / 2,
  volume: 0,
});

const LIMIT = 100;

function audit(
  bars: Bar[],
  over: Partial<Parameters<typeof auditFill>[0]> = {}
) {
  return auditFill({
    fillModel: "limit",
    direction: "long",
    limit: LIMIT,
    entryTime: T0,
    exitTime: bars[bars.length - 1].time,
    bars,
    ...over,
  });
}

describe("auditFill — limit fills (long)", () => {
  it("clean when the entry bar trades a full tick through the limit", () => {
    expect(audit([bar(0, 102, 99.75), bar(1, 103, 101)])).toBe("clean");
  });

  it("clean when only the NEXT bar trades through", () => {
    expect(audit([bar(0, 102, 100), bar(1, 101, 99.5), bar(2, 103, 101)])).toBe("clean");
  });

  it("marginal when the touch is thin but the level is revisited later", () => {
    // entry bar touches exactly, bar 2 comes back to the level (no full tick).
    expect(audit([bar(0, 102, 100), bar(1, 104, 101), bar(2, 103, 100)])).toBe("marginal");
  });

  it("doubtful when the extreme only kisses the limit and never returns", () => {
    expect(audit([bar(0, 102, 100), bar(1, 104, 101), bar(2, 105, 102)])).toBe("doubtful");
  });

  it("ignores revisits after the exit time", () => {
    const bars = [bar(0, 102, 100), bar(1, 104, 101), bar(2, 103, 99)];
    // exit before bar 2 — the later revisit doesn't count.
    expect(audit(bars, { exitTime: T0 + 300 })).toBe("doubtful");
  });

  it("mirrors for shorts (highs above the limit)", () => {
    const mk = (i: number, high: number, low: number) => bar(i, high, low);
    expect(
      audit([mk(0, 100.25, 98), mk(1, 99, 97)], { direction: "short" })
    ).toBe("clean");
    expect(
      audit([mk(0, 100, 98), mk(1, 100, 97), mk(2, 99, 96)], { direction: "short" })
    ).toBe("marginal");
    expect(
      audit([mk(0, 100, 98), mk(1, 99, 97)], { direction: "short" })
    ).toBe("doubtful");
  });

  it("returns null when the entry bar predates the series", () => {
    expect(audit([bar(1, 102, 99)], { entryTime: T0 - 900 })).toBeNull();
  });
});

describe("auditFill — nextOpen fills", () => {
  it("clean on a real traded bar", () => {
    expect(audit([bar(0, 102, 99)], { fillModel: "nextOpen" })).toBe("clean");
  });

  it("marginal when the fill bar's OHLC is not finite", () => {
    const broken = { ...bar(0, 102, 99), open: NaN };
    expect(audit([broken], { fillModel: "nextOpen" })).toBe("marginal");
  });
});
