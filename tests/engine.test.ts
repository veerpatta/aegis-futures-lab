import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import type { Strategy, EntrySignal } from "@/lib/strategies/types";
import type { Bar } from "@/lib/types";

/* Synthetic NY-session bars: 2026-06-01 was a Monday. 09:30 NY = 13:30 UTC
   (EDT). Build 5m bars for one or more sessions. */
const SESSION_OPEN_UTC = Date.UTC(2026, 5, 1, 13, 30) / 1000;

function mkBars(
  count: number,
  opts: { start?: number; price?: number; drift?: number; range?: number } = {}
): Bar[] {
  const { start = SESSION_OPEN_UTC, price = 5000, drift = 0, range = 2 } = opts;
  const bars: Bar[] = [];
  let p = price;
  for (let i = 0; i < count; i++) {
    bars.push({
      time: start + i * 300,
      open: p,
      high: p + range,
      low: p - range,
      close: p + drift,
      volume: 100,
    });
    p += drift;
  }
  return bars;
}

/* A strategy that emits one LONG signal at a fixed bar index. */
function oneShot(signalIndex: number, signal: Partial<EntrySignal> = {}): Strategy<unknown> {
  return {
    id: "one-shot",
    name: "One shot",
    blurb: "",
    symbolMode: "single",
    params: [],
    prepare: () => ({}),
    onSnapshot(_ctx, snap) {
      const vis = snap.bySymbol.TEST;
      if (!vis || vis.index !== signalIndex) return [];
      const bar = vis.bars[vis.index];
      return [
        {
          symbol: "TEST",
          side: "LONG",
          stop: bar.close - 10,
          target: { kind: "rMultiple", r: 1 },
          ...signal,
        } as EntrySignal,
      ];
    },
  };
}

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

describe("unified backtest engine", () => {
  it("fills at the NEXT bar's open plus slippage", () => {
    const bars = mkBars(20);
    const res = runBacktest(baseInput(bars, oneShot(5)));
    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    expect(t.entryTime).toBe(bars[6].time);
    expect(t.entryPrice).toBe(bars[6].open + 0.25);
  });

  it("resolves stop before target when both are hit on the same bar", () => {
    const bars = mkBars(20);
    // Wide bar at index 8 pierces both a tight stop and a tight target.
    bars[8] = { ...bars[8], high: bars[8].open + 50, low: bars[8].open - 50 };
    const res = runBacktest(
      baseInput(
        bars,
        oneShot(6, { stop: bars[7].open - 1, target: { kind: "price", price: bars[7].open + 1 } })
      )
    );
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].exitReason).toBe("stop");
    expect(res.trades[0].exitPrice).toBe(bars[7].open - 1);
  });

  it("exits at the exact target price with netDollar target math", () => {
    const bars = mkBars(30, { drift: 1 });
    const res = runBacktest(
      baseInput(bars, oneShot(4, { stop: bars[5].open - 100, target: { kind: "netDollar", amount: 50 } }))
    );
    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    expect(t.exitReason).toBe("target");
    // qty 1, point 5: targetPoints = (50 + 2*1)/(5*1) = 10.4
    expect(t.target).toBeCloseTo(t.entryPrice + 10.4, 10);
    expect(t.pnl).toBeCloseTo(50, 10);
  });

  it("force-flattens at the session exit minute", () => {
    const bars = mkBars(72); // full session 09:30..15:25
    const res = runBacktest(
      baseInput(bars, oneShot(3, { stop: bars[4].open - 1000, target: { kind: "signalOnly" } }))
    );
    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    expect(t.exitReason).toBe("session");
    expect(t.exitTime).toBe(bars[71].time); // 15:25 bar
  });

  it("closes at window end when the session never reaches the exit minute", () => {
    const bars = mkBars(20);
    const res = runBacktest(
      baseInput(bars, oneShot(3, { stop: bars[4].open - 1000, target: { kind: "signalOnly" } }))
    );
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].exitReason).toBe("windowEnd");
  });

  it("supports shouldExit discretionary exits on bar close", () => {
    const strat = oneShot(3, { stop: bars0[4].open - 1000, target: { kind: "signalOnly" } });
    strat.shouldExit = (_c, snap, pos) => {
      const vis = snap.bySymbol[pos.symbol];
      return !!vis && vis.bars[vis.index].time >= bars0[10].time;
    };
    const res = runBacktest(baseInput(bars0, strat));
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].exitReason).toBe("signal");
    expect(res.trades[0].exitTime).toBe(bars0[10].time);
  });

  it("sizes off risk: floor(maxRisk / (stopDist × point + cost))", () => {
    const bars = mkBars(20);
    const input = baseInput(bars, oneShot(5, { stop: 0, target: { kind: "signalOnly" } }));
    input.execution = { cost: 2.4, slippage: 0.25, maxRisk: 160, sizing: "risk" };
    // stop distance is huge → qty 0 → riskUnfit
    const res = runBacktest(input);
    expect(res.trades.length).toBe(0);
    expect(res.skipReasons.riskUnfit).toBe(1);
  });

  it("enforces max trades per day via discipline locks", () => {
    const bars = mkBars(72);
    const everyBar: Strategy<unknown> = {
      ...oneShot(0),
      onSnapshot(_ctx, snap) {
        const vis = snap.bySymbol.TEST;
        if (!vis) return [];
        const bar = vis.bars[vis.index];
        return [
          {
            symbol: "TEST",
            side: "LONG",
            stop: bar.close - 1, // stops out immediately next bar
            target: { kind: "rMultiple", r: 100 },
          },
        ];
      },
    };
    const input = baseInput(bars, everyBar);
    input.locks = { dailyLoss: 1e9, maxTrades: 3, maxLosses: 1e9, maxDrawdown: 1e9 };
    const res = runBacktest(input);
    expect(res.trades.length).toBe(3);
    expect(res.skipReasons.lock).toBeGreaterThan(0);
  });

  it("blocks entries within ±30 minutes of a news event", () => {
    const bars = mkBars(20);
    const input = baseInput(bars, oneShot(5));
    input.newsTimes = [bars[5].time + 600];
    const res = runBacktest(input);
    expect(res.trades.length).toBe(0);
    expect(res.skipReasons.news).toBe(1);
  });

  it("does not carry fills across the NY date boundary", () => {
    const day1 = mkBars(72);
    const day2 = mkBars(72, { start: SESSION_OPEN_UTC + 86400 });
    const bars = [...day1, ...day2];
    // Signal on the LAST bar of day 1 — next bar is day 2, fill must be dropped.
    const res = runBacktest(baseInput(bars, oneShot(71)));
    expect(res.trades.length).toBe(0);
  });
});


describe("limit fill model", () => {
  it("fills at the resting limit on the signal bar itself", () => {
    const bars = mkBars(20); // open 5000, low 4998 each bar
    const input = baseInput(bars, oneShot(5, { limit: 4998.5 }));
    input.execution.fillModel = "limit";
    const res = runBacktest(input);
    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    expect(t.entryTime).toBe(bars[5].time); // touch bar, not the next bar
    expect(t.entryPrice).toBe(4998.5 + 0.25); // limit + slippage
  });

  it("fills at the open when the bar opens through the limit", () => {
    const bars = mkBars(20);
    bars[5] = { ...bars[5], open: 4997, low: 4995 };
    const input = baseInput(bars, oneShot(5, { limit: 4998.5, stop: 4900 }));
    input.execution.fillModel = "limit";
    const res = runBacktest(input);
    expect(res.trades[0].entryPrice).toBe(4997 + 0.25);
  });

  it("counts a same-bar stop sweep as a stop-out (stop-first convention)", () => {
    const bars = mkBars(20);
    const input = baseInput(
      bars,
      oneShot(5, { limit: 4999, stop: 4998.5, target: { kind: "price", price: 5100 } })
    );
    input.execution.fillModel = "limit"; // bar low 4998 sweeps the 4998.5 stop
    const res = runBacktest(input);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].exitReason).toBe("stop");
    expect(res.trades[0].entryTime).toBe(bars[5].time);
    expect(res.trades[0].exitTime).toBe(bars[5].time);
  });

  it("keeps legacy next-open fills when fillModel is unset", () => {
    const bars = mkBars(20);
    const res = runBacktest(baseInput(bars, oneShot(5, { limit: 4998.5 })));
    const t = res.trades[0];
    expect(t.entryTime).toBe(bars[6].time);
    expect(t.entryPrice).toBe(bars[6].open + 0.25);
  });
});


describe("adjustStop hook", () => {
  it("tightens the stop via adjustStop (breakeven) and never widens it", () => {
    const bars = mkBars(30, { drift: 1 });
    const strat = oneShot(4, { stop: bars[5].open - 20, target: { kind: "signalOnly" } });
    let calls = 0;
    strat.adjustStop = (_c, _s, pos) => {
      calls++;
      // first ask for a WIDER stop (must be ignored), then breakeven
      return calls < 3 ? pos.entry - 100 : pos.entry;
    };
    const res = runBacktest(baseInput(bars, strat));
    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    expect(t.exitReason).toBe("windowEnd");
    expect(t.stop).toBe(t.entryPrice); // breakeven applied, widening ignored
  });
});

const bars0 = mkBars(72);
