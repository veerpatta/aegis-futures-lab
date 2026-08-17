import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import { MIN_STOP_POINTS } from "@/scripts/engine/tiers";
import type { Strategy, EntrySignal } from "@/lib/strategies/types";
import type { Bar } from "@/lib/types";

/* The fill-realism guard.

   Risk sizing is maxRisk / (stopDistance × pointValue + cost), so a stop
   approaching zero runs the contract count to the cap. Phase 1 measured tier A
   at 55 contracts on a ~0.1-point stop — "not a trade anyone gets" — and the
   live table shows the same shape on tier-B MES: a 0.25-point stop sized to 43
   contracts, which is floor(160 / (0.25 × 5 + 2.40)) exactly.

   The property that matters most here is the DEFAULT. minStopPoints must be
   off unless asked for, or the golden parity oracle moves and every published
   figure silently changes meaning. */

const OPEN = Date.UTC(2026, 5, 1, 14, 0) / 1000;

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  time: OPEN + i * 300,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});

/* Deliberately flat: the trade opens and never resolves, so what is measured
   is the sizing decision at entry rather than an exit path. */
const bars: Bar[] = [
  bar(0, 5000, 5000.5, 4999.5, 5000),
  bar(1, 5000, 5000.5, 4999.5, 5000),
  bar(2, 5000, 5000.5, 4999.5, 5000),
  bar(3, 5000, 5000.5, 4999.5, 5000),
];

/* Signals on bar 0 with an absolute stop, filled at bar 1's open. */
function oneShot(stop: number): Strategy<unknown> {
  return {
    id: "one-shot",
    name: "One shot",
    blurb: "",
    symbolMode: "single",
    params: [],
    prepare: () => ({}),
    onSnapshot(_ctx, snap) {
      const vis = snap.bySymbol.TEST;
      if (!vis || vis.index !== 0) return [];
      return [
        {
          symbol: "TEST",
          side: "LONG",
          stop,
          target: { kind: "rMultiple", r: 2 },
        } as EntrySignal,
      ];
    },
  };
}

const run = (stop: number, minStopPoints?: number) => {
  const input: BacktestInput = {
    series: { TEST: bars },
    strategy: oneShot(stop),
    params: {},
    execution: {
      cost: 2.4,
      slippage: 0,
      maxRisk: 160,
      sizing: "risk",
      ...(minStopPoints === undefined ? {} : { minStopPoints }),
    },
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValueOf: () => 5,
    keepOpenAtEnd: true,
  };
  return runBacktest(input);
};

const opened = (r: ReturnType<typeof run>) => r.trades[0] ?? r.openPosition;

describe("minStopPoints", () => {
  it("is OFF by default — the parity oracle must not move", () => {
    /* A one-tick stop, the exact case seen live. Unguarded it sizes to 43:
       floor(160 / (0.25 × 5 + 2.40)) = floor(43.83) = 43. */
    const pos = opened(run(4999.75));
    expect(pos).toBeTruthy();
    expect(pos!.qty).toBe(43);
  });

  it("refuses a stop tighter than the threshold", () => {
    const r = run(4999.75, 2.0);
    expect(r.trades.length).toBe(0);
    expect(r.openPosition).toBeFalsy();
  });

  it("reports the refusal as its own skip reason, not as riskUnfit", () => {
    /* riskUnfit means "the risk cap could not buy one contract" — the opposite
       problem. Folding this into it would hide a fill-realism refusal inside a
       sizing bucket and make the funnel lie about why nothing traded. */
    const r = run(4999.75, 2.0);
    expect(r.skipReasons?.stopTooTight ?? 0).toBeGreaterThan(0);
    expect(r.skipReasons?.riskUnfit ?? 0).toBe(0);
  });

  it("lets a normal stop through untouched", () => {
    // 7 points, close to the live MES median of 6.99.
    const guarded = opened(run(4993, 2.0));
    const unguarded = opened(run(4993));
    expect(guarded).toBeTruthy();
    expect(guarded!.qty).toBe(unguarded!.qty);
  });

  it("caps size where the threshold binds", () => {
    // Exactly at the threshold: floor(160 / (2 × 5 + 2.40)) = 12.
    const pos = opened(run(4998, 2.0));
    expect(pos).toBeTruthy();
    expect(pos!.qty).toBe(12);
  });

  it("the live config opts in above the measured MES 5th percentile", () => {
    /* p05 of the 32 live MES stops is 1.825 points and the median is 6.99. The
       guard has to sit above the former to trim the tail that produces 43-lot
       fills, and below the latter so a normal trade is untouched. */
    expect(MIN_STOP_POINTS).toBeGreaterThan(1.825);
    expect(MIN_STOP_POINTS).toBeLessThan(6.99);
  });
});
