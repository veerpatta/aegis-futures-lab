import { describe, expect, it } from "vitest";
import { decisionMix, loadedRange } from "@/lib/plain/desk";
import type { Bar } from "@/lib/types";

describe("visual desk summaries", () => {
  it("uses the loaded candles' extrema and chronological last close, without inventing missing prices", () => {
    const bar = (time: number, low: number, high: number, close: number): Bar => ({ time, low, high, close, open: close, volume: 1 });
    expect(loadedRange([])).toBeNull();
    expect(loadedRange([bar(4, 10, 20, 15), bar(1, 5, 15, 9), bar(8, 20, 10, 15), bar(9, 10, 20, NaN)]))
      .toEqual({ low: 5, high: 20, last: 15, from: 1, to: 4, n: 2, fraction: 2 / 3 });
    expect(loadedRange([bar(1, 10, 10, 10)])?.fraction).toBe(.5);
  });
  it("keeps skipped, unfilled and unknown decisions out of closed trade counts", () => {
    const mix = decisionMix([
      { action: "take", position_status: "closed" }, { action: "take", position_status: "open" },
      { action: "take", position_status: "pending_fill" }, { action: "take", position_status: "cancelled" },
      { action: "skip", position_status: null }, { action: "take", position_status: null },
    ]);
    expect(mix.every(x => x.count === 1)).toBe(true);
    expect(mix.reduce((n, x) => n + x.count, 0)).toBe(6);
    expect(decisionMix([]).every(x => x.count === 0)).toBe(true);
  });
});
