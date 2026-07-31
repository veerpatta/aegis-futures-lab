import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import {
  R_BUCKETS,
  excursionSummary,
  exitEfficiency,
  maeR,
  mfeR,
  rDistribution,
  sliceBy,
  sliceByTag,
} from "@/lib/backtest/metrics";
import type { Strategy, EntrySignal } from "@/lib/strategies/types";
import type { Bar, Trade } from "@/lib/types";

/* MAE/MFE, the R-distribution and the generic slicer.

   The engine records excursion as pure bookkeeping — the parity suite proves
   it moves no trade. What these tests prove is the harder half: that the
   numbers are RIGHT, including on the paths that are easy to miss (the fill
   bar itself, and a limit fill that opens and stops out on one bar). */

const SESSION_OPEN_UTC = Date.UTC(2026, 5, 1, 13, 30) / 1000;

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  time: SESSION_OPEN_UTC + i * 300,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});

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
      const b = vis.bars[vis.index];
      return [
        {
          symbol: "TEST",
          side: "LONG",
          stop: b.close - 10,
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

describe("engine records intra-trade excursion", () => {
  /* Signal on bar 0 (close 5000, stop 4990). Fill at bar 1's open + 0.25
     slippage = 5000.25. Bar 2 dips to 4996 and spikes to 5012; bar 3 closes
     it out at the 1R target (5010.25). */
  const bars: Bar[] = [
    bar(0, 5000, 5001, 4999, 5000),
    bar(1, 5000, 5002, 4999, 5001),
    bar(2, 5001, 5012, 4996, 5005),
    bar(3, 5005, 5015, 5004, 5014),
  ];
  const res = runBacktest(baseInput(bars, oneShot(0)));
  const t = res.trades[0];

  it("produces one trade to measure", () => {
    expect(res.trades).toHaveLength(1);
    expect(t.entryPrice).toBeCloseTo(5000.25, 6);
  });

  it("MAE is the worst adverse move from entry, in points", () => {
    // Lowest low while open is 4996 on bar 2 → 5000.25 − 4996 = 4.25.
    expect(t.maePoints).toBeCloseTo(4.25, 6);
  });

  it("MFE is the best favourable move from entry, in points", () => {
    /* The 1R target sits at 5010.25 and bar 2 highs 5012, so the trade closes
       there — bar 3 never belongs to it. Highest high while open is therefore
       5012, not 5015: 5012 − 5000.25 = 11.75. Excursion is bounded by the
       trade's life, which is the whole point of measuring it per trade. */
    expect(t.exitReason).toBe("target");
    expect(t.exitTime).toBe(bars[2].time);
    expect(t.mfePoints).toBeCloseTo(11.75, 6);
  });

  it("both are non-negative even when the trade only ever went one way", () => {
    const up: Bar[] = [
      bar(0, 5000, 5001, 4999, 5000),
      bar(1, 5000, 5002, 5000, 5001), // fill here, never trades below entry
      bar(2, 5001, 5030, 5001, 5029),
    ];
    const only = runBacktest(baseInput(up, oneShot(0))).trades[0];
    expect(only.maePoints).toBeGreaterThanOrEqual(0);
    expect(only.mfePoints).toBeGreaterThan(0);
  });

  it("counts the FILL bar, not just the bars after it", () => {
    /* The manage block runs before the pending fill executes, so on the fill
       bar the position is still null when management happens. Without an
       explicit fold at fill time every next-open trade under-reports by one
       bar — and here the fill bar holds the whole excursion. */
    const spikeOnFill: Bar[] = [
      bar(0, 5000, 5001, 4999, 5000),
      bar(1, 5000, 5040, 4970, 5001), // fill bar: huge range
      bar(2, 5001, 5002, 5000, 5001),
      bar(3, 5001, 5012, 5000, 5011),
    ];
    const f = runBacktest(baseInput(spikeOnFill, oneShot(0))).trades[0];
    expect(f.maePoints).toBeCloseTo(30.25, 6); // 5000.25 − 4970
    expect(f.mfePoints).toBeCloseTo(39.75, 6); // 5040 − 5000.25
  });

  it("counts the EXIT bar, so a spike before the stop is not lost", () => {
    const spikeThenStop: Bar[] = [
      bar(0, 5000, 5001, 4999, 5000),
      bar(1, 5000, 5002, 4999, 5001),
      bar(2, 5001, 5030, 4985, 4986), // ran +30 then swept the 4990 stop
    ];
    const s = runBacktest(baseInput(spikeThenStop, oneShot(0))).trades[0];
    expect(s.exitReason).toBe("stop");
    expect(s.mfePoints).toBeCloseTo(29.75, 6);
  });
});

describe("same-bar limit fill still gets an excursion", () => {
  /* The nastiest path: a resting limit that fills and stops out on ONE bar.
     Without folding at fill time this trade reports 0/0 — provably wrong,
     because the bar's own range is the entire life of the trade.

     Note the shape: a limit order is modelled as already resting when price
     arrives, so it fills on the SIGNAL bar itself, not the next one. That bar
     therefore has to carry the range. */
  const bars: Bar[] = [
    bar(0, 5000, 5020, 4980, 4985), // touches the 4995 limit, then sweeps the stop
    bar(1, 4985, 4990, 4980, 4985),
    bar(2, 4985, 4990, 4980, 4985),
  ];
  const strat = oneShot(0, { limit: 4995, stop: 4990, target: { kind: "rMultiple", r: 2 } });
  const res = runBacktest({
    ...baseInput(bars, strat),
    execution: {
      cost: 2,
      slippage: 0.25,
      maxRisk: 160,
      sizing: "fixed",
      fixedQty: 1,
      fillModel: "limit",
    },
  });

  it("opens and closes on the same bar", () => {
    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].entryTime).toBe(res.trades[0].exitTime);
    expect(res.trades[0].exitReason).toBe("stop");
  });

  it("reports the fill bar's range rather than zero", () => {
    const t = res.trades[0];
    expect(t.maePoints).toBeGreaterThan(0);
    expect(t.mfePoints).toBeGreaterThan(0);
    // Entry is min(open, limit) + slippage = 4995.25.
    expect(t.maePoints).toBeCloseTo(15.25, 6); // 4995.25 − 4980
    expect(t.mfePoints).toBeCloseTo(24.75, 6); // 5020 − 4995.25
  });
});

/* ── Derived metrics ──────────────────────────────────────────────────── */

const mkTrade = (over: Partial<Trade>): Trade => ({
  id: 1,
  symbol: "MES",
  side: "LONG",
  qty: 1,
  entryTime: 1000,
  entryPrice: 5000,
  exitTime: 2000,
  exitPrice: 5010,
  stop: 4990,
  target: 5020,
  exitReason: "target",
  points: 10,
  pnl: 48,
  rMultiple: 1,
  maePoints: 5,
  mfePoints: 15,
  ...over,
});

describe("R-normalised excursion", () => {
  it("divides by the stop distance, not by dollar risk", () => {
    const t = mkTrade({}); // stop 10 points away
    expect(maeR(t)).toBeCloseTo(0.5, 6); // 5 / 10
    expect(mfeR(t)).toBeCloseTo(1.5, 6); // 15 / 10
  });

  it("is null when the trade has no usable stop distance", () => {
    const t = mkTrade({ stop: 5000 });
    expect(maeR(t)).toBeNull();
    expect(mfeR(t)).toBeNull();
  });

  it("is null on a trade that predates the fields", () => {
    const t = mkTrade({ maePoints: undefined, mfePoints: undefined });
    expect(maeR(t)).toBeNull();
    expect(mfeR(t)).toBeNull();
  });

  it("makes two symbols comparable where points do not", () => {
    // 10 MES points and 40 MNQ points are both exactly 1R here.
    const mes = mkTrade({ symbol: "MES", entryPrice: 5000, stop: 4990, maePoints: 10 });
    const mnq = mkTrade({ symbol: "MNQ", entryPrice: 20000, stop: 19960, maePoints: 40 });
    expect(maeR(mes)).toBeCloseTo(maeR(mnq)!, 6);
  });
});

describe("exitEfficiency", () => {
  it("is 1 when the trade exits at its high-water mark", () => {
    const t = mkTrade({ points: 15, mfePoints: 15 });
    expect(exitEfficiency(t)).toBeCloseTo(1, 6);
  });

  it("falls as the trade gives profit back", () => {
    const t = mkTrade({ points: 3, mfePoints: 15 });
    expect(exitEfficiency(t)).toBeCloseTo(0.2, 6);
  });

  it("is null when the trade was never green", () => {
    expect(exitEfficiency(mkTrade({ mfePoints: 0, points: -10 }))).toBeNull();
  });
});

describe("excursionSummary", () => {
  const trades = [
    mkTrade({ id: 1, pnl: 100, points: 12, maePoints: 4, mfePoints: 14 }),
    mkTrade({ id: 2, pnl: -52, points: -10, maePoints: 10, mfePoints: 6 }),
    mkTrade({ id: 3, pnl: 60, points: 8, maePoints: 2, mfePoints: 9 }),
  ];

  it("counts only trades carrying excursion data", () => {
    const mixed = [...trades, mkTrade({ id: 4, maePoints: undefined, mfePoints: undefined })];
    expect(excursionSummary(mixed).n).toBe(3);
  });

  it("separates the heat on winners from the tease on losers", () => {
    const s = excursionSummary(trades);
    // Winners' MAE: (4 + 2) / 2 / 10 = 0.3R — a stop tighter than that cuts them.
    expect(s.avgWinnerMaeR).toBeCloseTo(0.3, 6);
    // Losers' MFE: 6 / 10 = 0.6R — they were green before they died.
    expect(s.avgLoserMfeR).toBeCloseTo(0.6, 6);
  });

  it("reports nulls rather than zeros on an empty book", () => {
    const s = excursionSummary([]);
    expect(s.n).toBe(0);
    expect(s.avgMaeR).toBeNull();
    expect(s.avgExitEfficiency).toBeNull();
  });
});

describe("rDistribution", () => {
  it("puts every trade in exactly one bucket", () => {
    const rs = [-3, -1.5, -1, -0.75, -0.2, 0.3, 0.8, 1.5, 2.5, 5];
    const trades = rs.map((r, i) => mkTrade({ id: i, rMultiple: r }));
    const dist = rDistribution(trades);
    expect(dist.reduce((s, b) => s + b.count, 0)).toBe(trades.length);
    expect(dist).toHaveLength(R_BUCKETS.length);
  });

  it("uses half-open buckets so a boundary value cannot double-count", () => {
    const exactlyMinusOne = [mkTrade({ rMultiple: -1 })];
    const dist = rDistribution(exactlyMinusOne);
    const hits = dist.filter((b) => b.count > 0);
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("−1R…−0.5R");
  });

  it("catches the tails rather than dropping them", () => {
    const dist = rDistribution([mkTrade({ rMultiple: -50 }), mkTrade({ rMultiple: 50 })]);
    expect(dist[0].count).toBe(1); // ≤ −2R
    expect(dist[dist.length - 1].count).toBe(1); // ≥ +3R
  });

  it("shows the shape two books with equal avgR can hide", () => {
    // Same mean R, completely different survival characteristics.
    const grind = Array.from({ length: 10 }, (_, i) => mkTrade({ id: i, rMultiple: 0.5 }));
    const lottery = [
      ...Array.from({ length: 9 }, (_, i) => mkTrade({ id: i, rMultiple: -1 })),
      mkTrade({ id: 9, rMultiple: 14 }),
    ];
    const meanR = (ts: Trade[]) => ts.reduce((s, t) => s + t.rMultiple, 0) / ts.length;
    expect(meanR(grind)).toBeCloseTo(meanR(lottery), 6);
    expect(rDistribution(grind).find((b) => b.label === "+0.5R…+1R")!.count).toBe(10);
    expect(rDistribution(lottery).find((b) => b.label === "≥ +3R")!.count).toBe(1);
  });
});

describe("sliceBy", () => {
  const trades = [
    mkTrade({ id: 1, pnl: 100, tags: { pattern: "DBR" } }),
    mkTrade({ id: 2, pnl: -50, tags: { pattern: "DBR" } }),
    mkTrade({ id: 3, pnl: 200, tags: { pattern: "RBR" } }),
    mkTrade({ id: 4, pnl: 10 }), // no tags
  ];

  it("groups by an arbitrary key and reuses metricsFromTrades", () => {
    const bySide = sliceBy(trades, (t) => t.side, 2000);
    expect(Object.keys(bySide)).toEqual(["LONG"]);
    expect(bySide.LONG.trades).toBe(4);
    expect(bySide.LONG.net).toBe(260);
  });

  it("drops trades whose key is null rather than inventing a bucket", () => {
    const byPattern = sliceByTag(trades, "pattern", 2000);
    expect(Object.keys(byPattern).sort()).toEqual(["DBR", "RBR"]);
    expect(byPattern.DBR.trades).toBe(2);
    expect(byPattern.RBR.trades).toBe(1);
  });

  it("computes expectancy per slice the same way the headline does", () => {
    const byPattern = sliceByTag(trades, "pattern", 2000);
    expect(byPattern.DBR.expectancy).toBeCloseTo(25, 6); // (100 − 50) / 2
    expect(byPattern.RBR.expectancy).toBeCloseTo(200, 6);
  });

  it("returns an empty object for an empty book", () => {
    expect(sliceByTag([], "pattern", 2000)).toEqual({});
  });
});
