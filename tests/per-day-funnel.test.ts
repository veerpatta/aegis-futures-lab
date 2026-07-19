import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import { nyDateKey } from "@/lib/time/ny";
import type { Strategy } from "@/lib/strategies/types";
import type { Bar } from "@/lib/types";

/* Synthetic NY-session bars: 2026-06-01 was a Monday. 09:30 NY = 13:30 UTC
   (EDT), matching engine.test.ts. */
const SESSION_OPEN_UTC = Date.UTC(2026, 5, 1, 13, 30) / 1000;

function mkBars(count: number, start = SESSION_OPEN_UTC): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const p = 5000;
    bars.push({ time: start + i * 300, open: p, high: p + 2, low: p - 2, close: p, volume: 100 });
  }
  return bars;
}

/* Notes one "probe" per snapshot and never signals. */
const prober: Strategy<unknown> = {
  id: "prober",
  name: "Prober",
  blurb: "",
  symbolMode: "single",
  params: [],
  prepare: () => ({}),
  onSnapshot(_ctx, _snap, _params, note) {
    note("probe", "TEST");
    return [];
  },
};

function baseInput(bars: Bar[], strategy: Strategy<unknown>): BacktestInput {
  return {
    series: { TEST: bars },
    strategy,
    params: {},
    execution: { cost: 2, slippage: 0.25, maxRisk: 160, sizing: "fixed", fixedQty: 1 },
    locks: null,
    startingCapital: 2000,
    sessionExitMinute: 925,
    pointValueOf: () => 5,
  };
}

describe("per-day skip funnel", () => {
  const day1 = mkBars(20);
  const day2 = mkBars(20, SESSION_OPEN_UTC + 86400);
  const bars = [...day1, ...day2];

  it("splits skip reasons by NY date and sums to the aggregate", () => {
    const res = runBacktest(baseInput(bars, prober));
    const d1 = nyDateKey(day1[0].time);
    const d2 = nyDateKey(day2[0].time);
    expect(Object.keys(res.skipReasonsByDay).sort()).toEqual([d1, d2].sort());
    expect(res.skipReasonsByDay[d1].probe).toBe(20);
    expect(res.skipReasonsByDay[d2].probe).toBe(20);
    const summed = Object.values(res.skipReasonsByDay).reduce(
      (n, day) => n + (day.probe || 0),
      0
    );
    expect(summed).toBe(res.skipReasons.probe);
  });

  it("omits events unless collectEvents is set", () => {
    const res = runBacktest(baseInput(bars, prober));
    expect(res.events).toBeUndefined();
  });

  it("collects timestamped, time-ordered events with symbol and NY date", () => {
    const input = baseInput(bars, prober);
    input.collectEvents = true;
    const res = runBacktest(input);
    expect(res.events).toBeDefined();
    const events = res.events!;
    expect(events.length).toBe(40);
    for (let i = 1; i < events.length; i++)
      expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    for (const e of events) {
      expect(e.reason).toBe("probe");
      expect(e.symbol).toBe("TEST");
      expect(e.date).toBe(nyDateKey(e.time));
    }
  });

  it("attributes engine-level news locks to the signal's symbol", () => {
    const signaler: Strategy<unknown> = {
      ...prober,
      onSnapshot(_ctx, snap) {
        const vis = snap.bySymbol.TEST;
        if (!vis || vis.index !== 5) return [];
        const bar = vis.bars[vis.index];
        return [
          { symbol: "TEST", side: "LONG" as const, stop: bar.close - 10, target: { kind: "rMultiple" as const, r: 1 } },
        ];
      },
    };
    const input = baseInput(day1, signaler);
    input.newsTimes = [day1[5].time + 600];
    input.collectEvents = true;
    const res = runBacktest(input);
    expect(res.trades.length).toBe(0);
    const news = res.events!.filter((e) => e.reason === "news");
    expect(news.length).toBe(1);
    expect(news[0].symbol).toBe("TEST");
    expect(res.skipReasonsByDay[nyDateKey(day1[5].time)].news).toBe(1);
  });
});
