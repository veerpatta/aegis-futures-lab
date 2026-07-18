/* End-to-end parity: unified engine + zone-v5 wrapper must reproduce the
   legacy outcomes.js portfolio walk (oracle extracted verbatim) — trade for
   trade — across every window and both modes, with and without news locks. */
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { runBacktest } from "@/lib/backtest/engine";
import { zoneV5 } from "@/lib/strategies/zone-v5";
import { pointValue } from "@/lib/strategies/zone-v5/engine";
import type { Strategy } from "@/lib/strategies/types";
import type { Bar } from "@/lib/types";
import mesFixture from "@/tests/fixtures/bars-mes.json";
import mnqFixture from "@/tests/fixtures/bars-mnq.json";

const require2 = createRequire(import.meta.url);
const { runLegacyOutcome, OUTCOME_CONFIG } = require2("./legacy-outcome-oracle.cjs");

let legacyV5: any;
let stacks: Record<string, any>;
let index: Record<string, Map<number, number>>;

const series: Record<string, Bar[]> = {
  MES: mesFixture.bars as Bar[],
  MNQ: mnqFixture.bars as Bar[],
};

// 2026 events overlapping the fixture window (NFP/CPI/PPI/FOMC June–July).
const EVENT_TIMES = [
  "2026-06-05T12:30:00.000Z",
  "2026-06-10T12:30:00.000Z",
  "2026-06-11T12:30:00.000Z",
  "2026-06-17T18:00:00.000Z",
  "2026-07-02T12:30:00.000Z",
  "2026-07-14T12:30:00.000Z",
  "2026-07-15T12:30:00.000Z",
].map((t) => new Date(t).getTime() / 1000);

beforeAll(() => {
  require2("../legacy/strategy.js");
  legacyV5 = (globalThis as any).AegisV5;
  stacks = {
    MES: legacyV5.buildStack(series.MES),
    MNQ: legacyV5.buildStack(series.MNQ),
  };
  index = {};
  for (const s of ["MES", "MNQ"]) {
    index[s] = new Map();
    stacks[s].exec.forEach((b: Bar, i: number) => index[s].set(b.time, i));
  }
});

const LOOSE = {
  maxRisk: 500,
  targetNet: 60,
  dailyLoss: 600,
  maxTrades: 5,
  maxLosses: 4,
  maxDrawdown: 1500,
};

function runNew(days: number, mode: string, newsTimes: number[], cfg = OUTCOME_CONFIG) {
  const maxTime = Math.min(...(["MES", "MNQ"] as const).map((s) => series[s].at(-1)!.time));
  return runBacktest({
    series,
    strategy: zoneV5 as Strategy<unknown>,
    params: {
      mode,
      targetNet: cfg.targetNet,
      stopBuffer: 0.25,
      minScore: 0,
      intermarket: true,
    },
    execution: {
      cost: cfg.cost ?? OUTCOME_CONFIG.cost,
      slippage: cfg.slippage ?? OUTCOME_CONFIG.slippage,
      maxRisk: cfg.maxRisk,
      sizing: "risk",
    },
    locks: {
      dailyLoss: cfg.dailyLoss,
      maxTrades: cfg.maxTrades,
      maxLosses: cfg.maxLosses,
      maxDrawdown: cfg.maxDrawdown,
    },
    startingCapital: cfg.startingCapital ?? OUTCOME_CONFIG.startingCapital,
    sessionExitMinute: 925,
    newsTimes,
    window: { fromTime: maxTime - days * 86400, toTime: maxTime },
    pointValueOf: pointValue,
  });
}

describe.each([
  [30, "strict"],
  [40, "strict"],
  [60, "strict"],
  [30, "directional"],
  [40, "directional"],
  [60, "directional"],
])("engine parity vs legacy outcomes walk — %dd %s", (days, mode) => {
  it.each([
    ["with news locks", EVENT_TIMES],
    ["without news locks", [] as number[]],
  ])("trade lists match %s", (_label, newsTimes) => {
    const oracle = runLegacyOutcome(legacyV5, stacks, index, newsTimes, days, mode);
    const ours = runNew(days, mode, newsTimes);
    const normOld = oracle.trades.map((t: any) => ({
      symbol: t.symbol,
      side: t.side,
      qty: t.qty,
      openedAt: t.openedAt,
      entry: t.entry,
      exitTime: t.exitTime,
      exit: t.exit,
      pnl: Number(t.pnl.toFixed(6)),
      score: t.score,
    }));
    const normNew = ours.trades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      qty: t.qty,
      openedAt: t.entryTime,
      entry: t.entryPrice,
      exitTime: t.exitTime,
      exit: t.exitPrice,
      pnl: Number(t.pnl.toFixed(6)),
      score: t.score,
    }));
    expect(normNew).toEqual(normOld);
    expect(ours.equityPoints.at(-1)!.equity).toBeCloseTo(oracle.equity, 6);
    expect(ours.sessions).toBe(oracle.sessions.size);
  });
});

describe("engine parity with loosened risk config (more fills)", () => {
  it("directional 60d trade lists match under the loose config", () => {
    const oracle = runLegacyOutcome(legacyV5, stacks, index, [], 60, "directional", LOOSE);
    const ours = runNew(60, "directional", [], { ...OUTCOME_CONFIG, ...LOOSE });
    expect(oracle.trades.length).toBeGreaterThan(0); // guard against a vacuous pass
    expect(
      ours.trades.map((t) => [t.symbol, t.entryTime, t.exitTime, Number(t.pnl.toFixed(6))])
    ).toEqual(
      oracle.trades.map((t: any) => [t.symbol, t.openedAt, t.exitTime, Number(t.pnl.toFixed(6))])
    );
  });
});
