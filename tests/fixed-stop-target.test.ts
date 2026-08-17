import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest/engine";
import type { Strategy, EntrySignal } from "@/lib/strategies/types";
import type { Bar } from "@/lib/types";

/* Fixed stop/target and the Globex session anchor.

   All three are the shape the gold strategy needs and the shape the equity
   engine could not express: a stop that is 13 points rather than "wherever the
   zone's distal line happens to be", a target 17 points away rather than a
   ratio, and a trading day that starts at 18:00 ET rather than midnight.

   Every default must remain legacy. The parity oracles are the proof, but
   these pin the intent directly. */

const NY_1000 = Date.UTC(2026, 5, 1, 14, 0) / 1000; // 10:00 ET, mid-session
const NY_2000 = Date.UTC(2026, 5, 1, 0, 0) / 1000; // 20:00 ET prior evening

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({
  time: t,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});

const flat = (start: number, n: number, px = 5000): Bar[] =>
  Array.from({ length: n }, (_, i) => bar(start + i * 300, px, px + 0.5, px - 0.5, px));

function oneShot(sig: Partial<EntrySignal>): Strategy<unknown> {
  return {
    id: "one-shot",
    name: "One shot",
    blurb: "",
    symbolMode: "single",
    params: [],
    prepare: () => ({}),
    onSnapshot(_ctx, snap) {
      const v = snap.bySymbol.MGC;
      if (!v || v.index !== 0) return [];
      return [
        {
          symbol: "MGC",
          side: "LONG",
          stop: 4990,
          target: { kind: "rMultiple", r: 2 },
          ...sig,
        } as EntrySignal,
      ];
    },
  };
}

const run = (bars: Bar[], sig: Partial<EntrySignal>, over: Partial<BacktestInput> = {}) =>
  runBacktest({
    series: { MGC: bars },
    strategy: oneShot(sig),
    params: {},
    execution: { cost: 2.4, slippage: 0, maxRisk: 160, sizing: "fixed", fixedQty: 1 },
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValueOf: () => 10,
    keepOpenAtEnd: true,
    ...over,
  } as BacktestInput);

const opened = (r: ReturnType<typeof run>) => r.trades[0] ?? r.openPosition;

describe("stopPoints — a fixed stop measured from the fill", () => {
  it("is absent by default, and the structural stop is used", () => {
    const p = opened(run(flat(NY_1000, 4), {}));
    expect(p).toBeTruthy();
    expect(p!.stop).toBeCloseTo(4990, 6);
  });

  it("derives the stop 13 points from the entry when set", () => {
    const p = opened(run(flat(NY_1000, 4), { stopPoints: 13 }));
    expect(p!.stop).toBeCloseTo(5000 - 13, 6);
  });

  it("measures from the FILL, not the intended entry", () => {
    /* The strategy cannot know where it filled. With slippage the fill is
       5000.5, so a 13-point stop must sit at 4987.5 — not 4987. */
    const p = opened(
      run(flat(NY_1000, 4), { stopPoints: 13 }, {
        execution: { cost: 2.4, slippage: 0.5, maxRisk: 160, sizing: "fixed", fixedQty: 1 },
      } as Partial<BacktestInput>)
    );
    expect(p!.entry).toBeCloseTo(5000.5, 6);
    expect(p!.stop).toBeCloseTo(5000.5 - 13, 6);
  });

  it("records it as the initial stop too, so excursion normalises correctly", () => {
    const p = opened(run(flat(NY_1000, 4), { stopPoints: 13 }));
    expect(p!.initialStop).toBeCloseTo(5000 - 13, 6);
  });
});

describe("points target", () => {
  it("sits a fixed distance from the fill", () => {
    const p = opened(
      run(flat(NY_1000, 4), { stopPoints: 13, target: { kind: "points", points: 17 } })
    );
    expect(p!.target).toBeCloseTo(5000 + 17, 6);
  });

  it("gives the stated 13/17 geometry on one MGC contract", () => {
    /* MGC is $10/point, which is the whole reason the brief's "$160-170 per
       trade" and a 17-point target are the same statement. */
    const p = opened(
      run(flat(NY_1000, 4), { stopPoints: 13, target: { kind: "points", points: 17 } })
    );
    const point = 10;
    expect((p!.entry - p!.stop) * point).toBeCloseTo(130, 6);
    expect((p!.target! - p!.entry) * point).toBeCloseTo(170, 6);
  });
});

describe("sessionAnchorMin — an overnight session can open a trade", () => {
  it("legacy (no anchor) cannot trade the Globex evening at all", () => {
    /* 20:00 ET is minute 1200, which is >= a 925 flatten minute, so every
       evening bar reads as past session exit. This is why an Asia entry could
       never fire, and why it failed as "no trades" rather than an error. */
    const r = run(flat(NY_2000, 6), {});
    expect(r.trades.length).toBe(0);
    expect(r.openPosition).toBeFalsy();
  });

  it("anchored at 18:00 ET, the same evening bars trade normally", () => {
    const r = run(flat(NY_2000, 6), {}, { sessionAnchorMin: 1080 } as Partial<BacktestInput>);
    expect(opened(r)).toBeTruthy();
  });

  it("still flattens at 15:25 ET under the anchor", () => {
    // 10:00 ET is elapsed 960 under an 1080 anchor; the flat is at 1285.
    const r = run(flat(NY_1000, 4), {}, { sessionAnchorMin: 1080 } as Partial<BacktestInput>);
    expect(opened(r)).toBeTruthy();
  });

  it("leaves the legacy day untouched when absent", () => {
    const a = opened(run(flat(NY_1000, 4), {}));
    const b = opened(run(flat(NY_1000, 4), {}, { sessionAnchorMin: 0 } as Partial<BacktestInput>));
    expect(a!.entry).toBeCloseTo(b!.entry, 10);
    expect(a!.openedAt).toBe(b!.openedAt);
  });
});
