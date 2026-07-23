import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { aggregate1h, computeRegime } from "../scripts/engine/regime";

/* The regime tag is bookkeeping stamped on signals at entry: trend vs range
   from EMA(20)/EMA(50) agreement with price on 1H closes, high vs low vol
   from ATR(14) vs its trailing 20-day median. Deterministic, and it must
   never read bars from the future. */

const T0 = 1_780_000_000 - (1_780_000_000 % 3600); // hour-aligned epoch

/* One 5m bar per hour is enough — each lands in its own 1H bucket. */
function hourBar(i: number, o: number, h: number, l: number, c: number): Bar {
  return { time: T0 + i * 3600, open: o, high: h, low: l, close: c, volume: 0 };
}

/* Steadily rising closes, constant 2-point range. */
function trendingBars(hours: number, widenLastRanges = 0): Bar[] {
  return Array.from({ length: hours }, (_, i) => {
    const pad = i >= hours - 15 ? widenLastRanges : 0;
    return hourBar(i, 100 + i, 101.5 + i + pad, 99.5 + i - pad, 101 + i);
  });
}

/* A long climb ending in a deep pullback: price drops far below EMA(20)
   while both EMAs still point up — price and EMAs disagree, so no clean
   trend reading. */
function pullbackBars(hours: number): Bar[] {
  const bars = trendingBars(hours - 1);
  const prevClose = 101 + (hours - 2);
  bars.push(hourBar(hours - 1, prevClose, prevClose + 0.5, prevClose - 15, prevClose - 14));
  return bars;
}

describe("aggregate1h", () => {
  it("keeps only hours fully completed by the entry time", () => {
    const bars = trendingBars(60);
    const entryMidHour = T0 + 59 * 3600 + 1800; // half-way through hour 59
    const h1 = aggregate1h(bars, entryMidHour);
    expect(h1[h1.length - 1].time).toBe(T0 + 58 * 3600); // hour 59 not complete
  });

  it("folds multiple 5m bars into one hourly candle", () => {
    const bars: Bar[] = [
      { time: T0, open: 10, high: 12, low: 9, close: 11, volume: 0 },
      { time: T0 + 300, open: 11, high: 15, low: 11, close: 14, volume: 0 },
      { time: T0 + 600, open: 14, high: 14, low: 8, close: 9, volume: 0 },
    ];
    const h1 = aggregate1h(bars, T0 + 3600);
    expect(h1).toHaveLength(1);
    expect(h1[0]).toMatchObject({ time: T0, open: 10, high: 15, low: 8, close: 9 });
  });
});

describe("computeRegime", () => {
  const after = (bars: Bar[]) => bars[bars.length - 1].time + 3600;

  it("returns null without 50 completed 1H bars", () => {
    const bars = trendingBars(40);
    expect(computeRegime(bars, after(bars))).toBeNull();
  });

  it("tags a steady climb with flat ranges as trend-low-vol", () => {
    const bars = trendingBars(80);
    expect(computeRegime(bars, after(bars))).toBe("trend-low-vol");
  });

  it("tags a steady climb with expanding recent ranges as trend-high-vol", () => {
    const bars = trendingBars(80, 4);
    expect(computeRegime(bars, after(bars))).toBe("trend-high-vol");
  });

  it("tags a deep pullback against the moving averages as range", () => {
    const bars = pullbackBars(80);
    const regime = computeRegime(bars, after(bars));
    expect(regime).not.toBeNull();
    expect(regime!.startsWith("range-")).toBe(true);
  });
});
