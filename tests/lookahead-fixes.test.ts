import { describe, expect, it } from "vitest";
import { aggregateMinutes, aggregateDaily } from "@/lib/strategies/zone-v5/engine";
import { zoneV5 } from "@/lib/strategies/zone-v5";
import { defaultParams } from "@/lib/strategies/types";
import { nyMeta } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";

/* The three structural look-ahead / DST defects, and the flags that correct
   them. Every default must stay legacy: these change which zones exist, which
   changes which trades exist, which changes every published figure. */

const mk = (t: number, p = 5000): Bar => ({
  time: t,
  open: p,
  high: p + 1,
  low: p - 1,
  close: p,
  volume: 1,
});

/* One bar every 5 minutes across a full NY day, in both halves of the year. */
function dayBars(y: number, m: number, d: number): Bar[] {
  const start = Date.UTC(y, m, d, 0, 0) / 1000;
  return Array.from({ length: 288 }, (_, i) => mk(start + i * 300));
}

describe("4H frames anchored to the session", () => {
  it("legacy bins on the UTC epoch", () => {
    const bars = dayBars(2026, 0, 14); // January — EST
    const f = aggregateMinutes(bars, 240);
    for (const b of f) expect(b.time % (240 * 60)).toBe(0); // epoch-aligned
  });

  it("anchored bins start on a New York 4H boundary in BOTH halves of the year", () => {
    for (const bars of [dayBars(2026, 0, 14), dayBars(2026, 6, 15)]) {
      for (const b of aggregateMinutes(bars, 240, true)) {
        expect(nyMeta(b.time).minutes % 240).toBe(0);
      }
    }
  });

  it("legacy's NY boundary MOVES with DST — which is the bug", () => {
    /* The epoch boundary is not a fixed point in the trading day. UTC 00:00 is
       NY 19:00 in EST (1140 min, 1140 % 240 = 180) and NY 20:00 in EDT
       (1200 min, 1200 % 240 = 0). So the 4H grid sits 3 hours off the session
       in winter and flush with it in summer, and one of the two HTF anchors
       that decides whether a tier-A setup exists silently reshapes twice a
       year. */
    const off = (bars: Bar[]) =>
      [...new Set(aggregateMinutes(bars, 240).map((b) => nyMeta(b.time).minutes % 240))];
    const winter = off(dayBars(2026, 0, 14));
    const summer = off(dayBars(2026, 6, 15));
    expect(winter).toEqual([180]);
    expect(summer).toEqual([0]);
    expect(winter).not.toEqual(summer);
  });

  it("leaves 15m and 60m alone, which divide the hour evenly", () => {
    const bars = dayBars(2026, 0, 14);
    for (const span of [15, 60]) {
      const a = aggregateMinutes(bars, span).map((b) => b.time);
      const b = aggregateMinutes(bars, span, true).map((x) => x.time);
      expect(b).toEqual(a);
    }
  });
});

describe("daily bars and the Globex roll", () => {
  it("legacy groups on the NY calendar day", () => {
    // 22:00 ET Monday is Tuesday's SESSION but Monday's calendar date.
    const evening = Date.UTC(2026, 5, 1, 23, 0) / 1000; // 19:00 ET
    const nextMorning = Date.UTC(2026, 5, 2, 14, 0) / 1000; // 10:00 ET next day
    const d = aggregateDaily([mk(evening), mk(nextMorning)]);
    expect(d).toHaveLength(2);
  });

  it("with the roll on, an evening bar joins the NEXT session", () => {
    const evening = Date.UTC(2026, 5, 1, 23, 0) / 1000;
    const nextMorning = Date.UTC(2026, 5, 2, 14, 0) / 1000;
    const d = aggregateDaily([mk(evening), mk(nextMorning)], true);
    expect(d).toHaveLength(1);
  });
});

describe("the flags default to legacy", () => {
  const p = defaultParams(zoneV5);
  it("causalBlocked80 is off", () => expect(p.causalBlocked80).toBe(false));
  it("sessionAnchoredFrames is off", () => expect(p.sessionAnchoredFrames).toBe(false));
  it("globexDailyRoll is off", () => expect(p.globexDailyRoll).toBe(false));
});

/* ── Resting limit orders ───────────────────────────────────────────────── */

import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import type { Strategy, EntrySignal } from "@/lib/strategies/types";

const OPEN = Date.UTC(2026, 5, 1, 14, 0) / 1000;
const b5 = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  time: OPEN + i * 300,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});

/* Bar 0 dips to the limit (4990) and closes back up — the shape the legacy
   path fills on, because the signal is only emitted once the touch is visible.
   Bar 1 dips there too, so a genuinely resting order still gets filled, just
   one bar later. */
const touchBars: Bar[] = [
  b5(0, 5000, 5001, 4989, 4998),
  b5(1, 4998, 4999, 4988, 4996),
  b5(2, 4996, 4997, 4994, 4995),
  b5(3, 4995, 4996, 4993, 4994),
];

function limitShot(): Strategy<unknown> {
  return {
    id: "limit-shot",
    name: "Limit shot",
    blurb: "",
    symbolMode: "single",
    params: [],
    prepare: () => ({}),
    onSnapshot(_ctx, snap) {
      const vis = snap.bySymbol.MES;
      if (!vis || vis.index !== 0) return [];
      return [
        {
          symbol: "MES",
          side: "LONG",
          stop: 4980,
          limit: 4990,
          target: { kind: "rMultiple", r: 2 },
        } as EntrySignal,
      ];
    },
  };
}

const limitRun = (restingLimitOrders: boolean) =>
  runBacktest({
    series: { MES: touchBars },
    strategy: limitShot(),
    params: {},
    execution: {
      cost: 2.4,
      slippage: 0,
      maxRisk: 160,
      sizing: "risk",
      fillModel: "limit",
      restingLimitOrders,
    },
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValueOf: () => 5,
    keepOpenAtEnd: true,
  } as BacktestInput);

/* trades[0] and openPosition carry the same facts under different names. */
const entryOf = (r: ReturnType<typeof limitRun>) => {
  const t = r.trades[0];
  if (t) return { at: t.entryTime, price: t.entryPrice };
  const p = r.openPosition!;
  return { at: p.openedAt, price: p.entry };
};

describe("restingLimitOrders", () => {
  it("legacy fills on the SAME bar that revealed the touch", () => {
    expect(entryOf(limitRun(false)).at).toBe(touchBars[0].time);
  });

  it("a resting order cannot fill on the bar that placed it", () => {
    /* The decision is taken at bar 0's close — zone-v5 evaluates with
       price: bar.close — so filling inside bar 0 uses information from the end
       of the bar to justify an order that was supposedly there at the start. */
    expect(entryOf(limitRun(true)).at).toBeGreaterThan(touchBars[0].time);
  });

  it("still fills, on the next bar that reaches the limit", () => {
    const e = entryOf(limitRun(true));
    expect(e.at).toBe(touchBars[1].time);
    expect(e.price).toBeCloseTo(4990, 6);
  });

  it("defaults to the legacy same-bar fill", () => {
    const r = runBacktest({
      series: { MES: touchBars },
      strategy: limitShot(),
      params: {},
      execution: { cost: 2.4, slippage: 0, maxRisk: 160, sizing: "risk", fillModel: "limit" },
      locks: null,
      startingCapital: 3000,
      sessionExitMinute: 925,
      pointValueOf: () => 5,
      keepOpenAtEnd: true,
    } as BacktestInput);
    const t = r.trades[0];
    expect(t ? t.entryTime : r.openPosition!.openedAt).toBe(touchBars[0].time);
  });
});
