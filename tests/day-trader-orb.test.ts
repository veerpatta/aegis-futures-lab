import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/backtest/engine";
import { dayTraderOrb, buildDayRanges } from "@/lib/strategies/day-trader-orb";
import { standingOf, strategyById } from "@/lib/strategies/registry";
import { defaultParams } from "@/lib/strategies/types";
import { nyDateKey, nyMeta } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import mesFixture from "@/tests/fixtures/bars-mes.json";

/* The Day Trader skill pack's opening-range rule (trader-entry + trader-exit),
   pinned on hand-built bars so a later edit cannot quietly turn it into
   Aegis's own (refuted) orb. */

// 2026-10-19 09:30 New York = 13:30 UTC (EDT).
const OPEN = Date.UTC(2026, 9, 19, 13, 30) / 1000;
const bar = (slot: number, o: number, h: number, l: number, c: number, v = 100): Bar => ({
  time: OPEN + slot * 300,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

/* The reel's TSLA day, shape only: range 354.47–362.18, the 10:05 bar wicks
   above without closing above, the 10:10 bar closes above. */
function reelDay(): Bar[] {
  return [
    bar(0, 356, 360.0, 354.47, 358), // 09:30
    bar(1, 358, 362.18, 357, 361), // 09:35
    bar(2, 361, 361.5, 358, 360), // 09:40  -> range complete at 09:45
    bar(3, 360, 361.9, 359, 361), // 09:45
    bar(4, 361, 362.18, 360, 362.18), // 09:50  close AT the high: not above
    bar(5, 362, 363.0, 361, 361.2), // 09:55  wick above, close below
    bar(6, 361, 362.0, 360, 361.5), // 10:00
    bar(7, 361, 362.5, 360.5, 361.68), // 10:05
    bar(8, 361.7, 364.5, 361.5, 364.18), // 10:10  first close above -> trigger
    bar(9, 364.2, 366, 364, 365.75), // 10:15  a later close above does not reset it
  ];
}

describe("day-trader-orb: the skill's trigger", () => {
  it("builds the 15-minute range from the three opening bars and stops at its middle", () => {
    const ranges = buildDayRanges(reelDay(), 15, 0);
    const day = ranges.get(2)!;
    expect(day.complete).toBe(true);
    expect(day.high).toBeCloseTo(362.18, 6);
    expect(day.low).toBeCloseTo(354.47, 6);
    expect(day.mid).toBeCloseTo(358.325, 6);
  });

  it("triggers on the first bar that CLOSES strictly above the high, once per day", () => {
    const ranges = buildDayRanges(reelDay(), 15, 0);
    expect(ranges.get(9)!.triggerIndex).toBe(8);
  });

  it("the optional volume check moves the trigger to a heavier bar", () => {
    const bars = reelDay();
    bars[8] = { ...bars[8], volume: 60 }; // 0.6x the range's average
    bars[9] = { ...bars[9], volume: 800 };
    expect(buildDayRanges(bars, 15, 1).get(9)!.triggerIndex).toBe(9);
    expect(buildDayRanges(bars, 15, 0).get(9)!.triggerIndex).toBe(8);
  });

  it("does not trade an incomplete range", () => {
    const bars = reelDay().filter((_, i) => i !== 1); // the 09:35 bar is missing
    const ranges = buildDayRanges(bars, 15, 0);
    expect([...ranges.values()].every((d) => d.triggerIndex === null && !d.complete)).toBe(true);
  });

  it("expires a breakout that comes too late to be filled before the 15:25 flatten", () => {
    const bars: Bar[] = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
    for (let s = 3; s < 69; s++) bars.push(bar(s, 100, 100.5, 99.5, 100)); // quiet to 15:15
    bars.push(bar(69, 100, 103, 100, 102)); // 15:15 bar closes above -> still allowed
    expect(nyMeta(bars[69].time).minutes).toBe(15 * 60 + 15);
    expect(buildDayRanges(bars, 15, 0).get(69)!.triggerIndex).toBe(69);
    const late = bars.slice(0, 69);
    late.push(bar(69, 100, 100.5, 99.5, 100), bar(70, 100, 103, 100, 102)); // 15:20 bar: too late
    const day = buildDayRanges(late, 15, 0).get(70)!;
    expect(day.triggerIndex).toBeNull();
    expect(day.expired).toBe(true);
  });
});

describe("day-trader-orb in the engine", () => {
  const run = () =>
    runBacktest({
      series: { MES: mesFixture.bars as Bar[] },
      strategy: dayTraderOrb,
      params: defaultParams(dayTraderOrb),
      execution: { cost: 2.4, slippage: 0.25, maxRisk: 160, sizing: "risk" },
      locks: null,
      startingCapital: 2000,
      sessionExitMinute: 925,
      pointValueOf: () => 5,
    });

  it("is registered, long only, one trade a day, entered after the range and flat the same day", () => {
    expect(strategyById("day-trader-orb")).toBe(dayTraderOrb);
    const res = run();
    expect(res.trades.length).toBeGreaterThan(3);
    const perDay = new Map<string, number>();
    for (const t of res.trades) {
      expect(t.side).toBe("LONG");
      expect(nyMeta(t.entryTime).minutes).toBeGreaterThanOrEqual(9 * 60 + 45);
      expect(nyMeta(t.entryTime).minutes).toBeLessThan(15 * 60 + 25);
      perDay.set(nyDateKey(t.entryTime), (perDay.get(nyDateKey(t.entryTime)) ?? 0) + 1);
    }
    for (const n of perDay.values()) expect(n).toBe(1);
  });

  it("starts unmeasured: the weekly beat-random test has not run it yet", () => {
    expect(standingOf("day-trader-orb")).toBe("unmeasured");
  });
});
