/* Behavior tests for the strategy-spec features added on top of the legacy
   parity surface: trend detection, opposing-zone lookup, and the default
   parameter set (RTH structure, limit entry, 2R target) end to end. */
import { describe, it, expect } from "vitest";
import { runBacktest } from "@/lib/backtest/engine";
import { zoneV5 } from "@/lib/strategies/zone-v5";
import { defaultParams } from "@/lib/strategies/types";
import { trendAt, nearestOpposing, type Stack, type Zone } from "@/lib/strategies/zone-v5/engine";
import type { Bar, FrameBar } from "@/lib/types";
import mesFixture from "./fixtures/bars-mes.json";
import mnqFixture from "./fixtures/bars-mnq.json";

const HOUR = 3600;

function hourBars(closes: number[]): FrameBar[] {
  return closes.map((c, i) => ({
    time: i * HOUR,
    open: c - 1,
    high: c + 2,
    low: c - 3,
    close: c,
    volume: 1,
  }));
}

describe("trendAt", () => {
  it("labels higher highs + higher lows as an uptrend", () => {
    const closes = [100, 105, 110, 107, 104, 112, 117, 114, 111, 119, 124, 121, 118, 126];
    expect(trendAt(hourBars(closes), closes.length * HOUR + HOUR, HOUR)).toBe("up");
  });
  it("labels lower highs + lower lows as a downtrend", () => {
    const closes = [126, 121, 116, 119, 122, 114, 109, 112, 115, 107, 102, 105, 108, 100];
    expect(trendAt(hourBars(closes), closes.length * HOUR + HOUR, HOUR)).toBe("down");
  });
  it("returns side when there is too little completed history", () => {
    expect(trendAt(hourBars([100, 101, 102]), 10 * HOUR, HOUR)).toBe("side");
  });
  it("ignores bars that have not completed by the evaluation time", () => {
    const closes = [100, 104, 102, 107, 105, 110, 108, 113, 111, 116, 114, 119, 117, 122];
    // Evaluating at t=0 must not see any of the future bars.
    expect(trendAt(hourBars(closes), 0, HOUR)).toBe("side");
  });
});

function zone(partial: Partial<Zone>): Zone {
  return {
    tf: "60",
    tfRank: 2,
    type: "supply",
    pattern: "RBD",
    proximal: 110,
    distal: 115,
    low: 110,
    high: 115,
    height: 5,
    baseCount: 1,
    wickTolerance: false,
    wide: false,
    gapConverted: false,
    arrivalTime: 0,
    arrivalExtreme: 115,
    formedAt: 100,
    firstReturnAt: null,
    brokenAt: null,
    achievedAt: null,
    reaction: false,
    blocked80: null,
    ...partial,
  };
}

function stackWith(zones60: Zone[]): Stack {
  return {
    exec: [],
    frames: { D: [], "240": [], "60": [], "15": [] },
    zones: { D: [], "240": [], "60": zones60, "15": [] },
    rejects: { D: 0, "240": 0, "60": 0, "15": 0 },
    all: zones60,
  };
}

describe("nearestOpposing", () => {
  it("finds the nearest live supply above a long entry", () => {
    const near = zone({ proximal: 108 });
    const far = zone({ proximal: 120 });
    const found = nearestOpposing(stackWith([far, near]), "LONG", 100, 1000);
    expect(found?.proximal).toBe(108);
  });
  it("skips broken zones and zones on the wrong side", () => {
    const broken = zone({ proximal: 105, brokenAt: 500 });
    const below = zone({ proximal: 90 });
    const valid = zone({ proximal: 112 });
    const found = nearestOpposing(stackWith([broken, below, valid]), "LONG", 100, 1000);
    expect(found?.proximal).toBe(112);
  });
  it("returns null when nothing opposes the trade", () => {
    expect(nearestOpposing(stackWith([]), "SHORT", 100, 1000)).toBeNull();
  });
});

describe("zone-v5 default parameter run", () => {
  const series: Record<string, Bar[]> = {
    MES: mesFixture.bars as Bar[],
    MNQ: mnqFixture.bars as Bar[],
  };
  it("produces trades with the shipped defaults and honors the 2R target", () => {
    const result = runBacktest({
      series,
      strategy: zoneV5,
      params: defaultParams(zoneV5),
      execution: { cost: 2.4, slippage: 0.25, maxRisk: 160, sizing: "risk", fillModel: "limit" },
      locks: { dailyLoss: 320, maxTrades: 3, maxLosses: 2, maxDrawdown: 400 },
      startingCapital: 2000,
      sessionExitMinute: 925,
      newsTimes: [],
      pointValueOf: (s) => (s === "MES" ? 5 : 2),
    });
    expect(result.trades.length).toBeGreaterThan(0);
    for (const t of result.trades.filter((x) => x.exitReason === "target"))
      expect(t.rMultiple).toBeGreaterThan(1.5); // 2R target minus costs
    expect(result.skipReasons.evaluated).toBeGreaterThan(0);
  });
});
