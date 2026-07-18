import { describe, it, expect } from "vitest";
import { sma, ema, rsi, atr, stdev, bollinger, sessionVwap } from "@/lib/indicators";
import type { Bar } from "@/lib/types";

describe("indicators — known values", () => {
  it("sma", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it("ema seeds with SMA then smooths (k = 2/(n+1))", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(2); // SMA seed
    expect(out[3]).toBeCloseTo(2 + 0.5 * (4 - 2), 10); // 3
    expect(out[4]).toBeCloseTo(3 + 0.5 * (5 - 3), 10); // 4
  });

  it("rsi is 100 on a pure uptrend and ~0 on a pure downtrend", () => {
    const up = rsi([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(up[4]).toBe(100);
    const down = rsi([8, 7, 6, 5, 4, 3, 2, 1], 4);
    expect(down[4]).toBeCloseTo(0, 6);
  });

  it("rsi matches the classic Wilder worked example region", () => {
    // Alternating ±1 changes with equal gains/losses → RSI 50.
    const closes = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
    const out = rsi(closes, 4);
    expect(out[9]).toBeGreaterThan(40);
    expect(out[9]).toBeLessThan(60);
  });

  it("atr equals the constant bar range when every bar is identical", () => {
    const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({
      time: i * 300,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
    }));
    const out = atr(bars, 14);
    expect(out[19]).toBeCloseTo(4, 10);
  });

  it("stdev of a constant series is 0; of {1,5} window 2 is 2", () => {
    expect(stdev([3, 3, 3, 3], 2)[3]).toBeCloseTo(0, 10);
    expect(stdev([1, 5], 2)[1]).toBeCloseTo(2, 10);
  });

  it("bollinger bands bracket the mid by mult × sd", () => {
    const closes = [1, 2, 3, 4, 5, 6];
    const out = bollinger(closes, 4, 2);
    const p = out[5]!;
    expect(p.mid).toBeCloseTo(4.5, 10);
    expect(p.upper - p.mid).toBeCloseTo(p.mid - p.lower, 10);
  });

  it("sessionVwap resets at each NY session date", () => {
    // Two sessions: 2026-06-01 and 2026-06-02, 13:30 UTC opens (EDT).
    const s1 = Date.UTC(2026, 5, 1, 13, 30) / 1000;
    const s2 = Date.UTC(2026, 5, 2, 13, 30) / 1000;
    const bars: Bar[] = [
      { time: s1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: s1 + 300, open: 20, high: 20, low: 20, close: 20, volume: 1 },
      { time: s2, open: 100, high: 100, low: 100, close: 100, volume: 1 },
    ];
    const out = sessionVwap(bars);
    expect(out[0]).toBeCloseTo(10, 10);
    expect(out[1]).toBeCloseTo(15, 10); // cumulative within session 1
    expect(out[2]).toBeCloseTo(100, 10); // reset on the new session
  });
});
