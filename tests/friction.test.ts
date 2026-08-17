import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import { LEGACY_MODEL, REALISTIC_MODEL, frictionSpecFor } from "@/lib/costs/model";
import type { Strategy, EntrySignal } from "@/lib/strategies/types";
import type { Bar } from "@/lib/types";

/* FrictionSpec, now that it is reachable.

   lib/costs/model.ts claimed for a long time that "every consumer in engine.ts
   checks friction !== undefined". There were no consumers: engine.ts never
   imported from lib/costs and ExecutionConfig had no such field, so
   REALISTIC_MODEL could not be switched on at all. These tests pin the two
   halves that matter — absence is byte-identical legacy, and presence
   measurably changes the book. */

const OPEN = Date.UTC(2026, 5, 1, 14, 0) / 1000;

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  time: OPEN + i * 300,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});

/* Bar 2 gaps DOWN through the stop: it opens at 4980 with the stop at 4990,
   so a real order never traded at 4990. */
const gapBars: Bar[] = [
  bar(0, 5000, 5001, 4999, 5000),
  bar(1, 5000, 5002, 4999, 5001),
  bar(2, 4980, 4982, 4970, 4975),
  bar(3, 4975, 4976, 4970, 4972),
];

function oneShot(): Strategy<unknown> {
  return {
    id: "one-shot",
    name: "One shot",
    blurb: "",
    symbolMode: "single",
    params: [],
    prepare: () => ({}),
    onSnapshot(_ctx, snap) {
      const vis = snap.bySymbol.MES;
      if (!vis || vis.index !== 0) return [];
      return [
        { symbol: "MES", side: "LONG", stop: 4990, target: { kind: "rMultiple", r: 3 } } as EntrySignal,
      ];
    },
  };
}

const run = (bars: Bar[], friction?: BacktestInput["execution"]["friction"]) =>
  runBacktest({
    series: { MES: bars },
    strategy: oneShot(),
    params: {},
    execution: {
      cost: 2.4,
      slippage: 0.25,
      maxRisk: 160,
      sizing: "risk",
      ...(friction ? { friction } : {}),
    },
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValueOf: () => 5,
  });

const legacy = frictionSpecFor(LEGACY_MODEL, ["MES"]);
const realistic = frictionSpecFor(REALISTIC_MODEL, ["MES"]);

describe("FrictionSpec", () => {
  it("absent reproduces the legacy book exactly", () => {
    const a = run(gapBars);
    const b = run(gapBars, legacy);
    expect(a.trades).toHaveLength(1);
    expect(b.trades).toHaveLength(1);
    // LEGACY_MODEL is entryOnly with 1 tick, which IS the flat 0.25 scalar.
    expect(b.trades[0].pnl).toBeCloseTo(a.trades[0].pnl, 10);
    expect(b.trades[0].exitPrice).toBeCloseTo(a.trades[0].exitPrice, 10);
    expect(b.trades[0].qty).toBe(a.trades[0].qty);
  });

  it("legacy fills a gapped stop at the stop price it never traded at", () => {
    const t = run(gapBars).trades[0];
    expect(t.exitReason).toBe("stop");
    expect(t.exitPrice).toBeCloseTo(4990, 6);
  });

  it("realistic fills a gapped stop at the open instead", () => {
    /* Bar 2 opened at 4980, ten points below the stop. Charging the stop price
       hands that gap back on every one of them. */
    const t = run(gapBars, realistic).trades[0];
    expect(t.exitReason).toBe("stop");
    expect(t.exitPrice).toBeLessThan(4990);
  });

  it("realistic costs strictly more than legacy on the same bars", () => {
    const a = run(gapBars).trades[0];
    const b = run(gapBars, realistic).trades[0];
    expect(b.pnl).toBeLessThan(a.pnl);
  });

  it("realistic sizes smaller, because the exit's slippage is in the risk", () => {
    const a = run(gapBars).trades[0];
    const b = run(gapBars, realistic).trades[0];
    expect(b.qty).toBeLessThanOrEqual(a.qty);
  });

  it("frictionSpecFor reflects entryOnly on both models", () => {
    expect(legacy.slipExits).toBe(false);
    expect(legacy.gapThroughStops).toBe(false);
    expect(realistic.slipExits).toBe(true);
    expect(realistic.gapThroughStops).toBe(true);
  });
});
