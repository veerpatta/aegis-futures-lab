import { describe, expect, it } from "vitest";
import { dailyReferencePrice } from "@/lib/data/daily-change";

describe("dailyReferencePrice", () => {
  it("uses yesterday's settle, not the close before a 5-day chart window", () => {
    // Real MES=F meta on 2026-11-06 (range=5d): the 5-day reference made a
    // +0.07% day read as -2.44%.
    const meta = { previousClose: 7383, chartPreviousClose: 7574.5 };
    expect(dailyReferencePrice(meta, 7650)).toBe(7383);
    const pct = ((7388 - dailyReferencePrice(meta, 7650)) / dailyReferencePrice(meta, 7650)) * 100;
    expect(pct).toBeCloseTo(0.068, 2);
  });

  it("falls back to the range close, then the first bar", () => {
    expect(dailyReferencePrice({ chartPreviousClose: 7574.5 }, 7650)).toBe(7574.5);
    expect(dailyReferencePrice({}, 7650)).toBe(7650);
    expect(dailyReferencePrice({ previousClose: 0, chartPreviousClose: null }, 7650)).toBe(7650);
    expect(dailyReferencePrice({ previousClose: Number.NaN }, 7650)).toBe(7650);
  });
});
