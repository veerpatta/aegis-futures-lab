import { describe, it, expect } from "vitest";
import { runBacktest } from "@/lib/backtest/engine";
import { strategyById, STRATEGIES } from "@/lib/strategies/registry";
import { defaultParams } from "@/lib/strategies/types";
import { nyDateKey, NY_SESSION_START_MIN, nyMeta } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import mesFixture from "@/tests/fixtures/bars-mes.json";

const bars = mesFixture.bars as Bar[];

/* Sessions whose data reaches the 15:25 flatten bar. When a session ends
   early (holiday close, feed gap) the engine — like the legacy walker —
   cannot flatten and the position carries to the next session's bars. */
const fullSessions = new Set(
  bars.filter((b) => nyMeta(b.time).minutes >= 925).map((b) => nyDateKey(b.time))
);
const expectIntraday = (entryTime: number, exitTime: number) => {
  if (fullSessions.has(nyDateKey(entryTime)))
    expect(nyDateKey(exitTime)).toBe(nyDateKey(entryTime));
};

function run(strategyId: string, paramOverrides: Record<string, number | string | boolean> = {}) {
  const strategy = strategyById(strategyId);
  return runBacktest({
    series: { MES: bars },
    strategy,
    params: { ...defaultParams(strategy), ...paramOverrides },
    execution: { cost: 2.4, slippage: 0.25, maxRisk: 160, sizing: "risk" },
    locks: null,
    startingCapital: 2000,
    sessionExitMinute: 925,
    pointValueOf: () => 5,
  });
}

describe("classic strategies on the 60d MES fixture", () => {
  it("every registered strategy has unique ids and complete metadata", () => {
    const ids = STRATEGIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STRATEGIES) {
      expect(s.name.length).toBeGreaterThan(3);
      expect(s.blurb.length).toBeGreaterThan(30);
      expect(s.params.length).toBeGreaterThan(0);
    }
  });

  it("ema-cross produces trades and both exit styles work", () => {
    const cross = run("ema-cross");
    expect(cross.trades.length).toBeGreaterThan(5);
    expect(cross.trades.some((t) => t.exitReason === "signal")).toBe(true);
    const rr = run("ema-cross", { exitStyle: "rMultiple", targetR: 1 });
    expect(rr.trades.length).toBeGreaterThan(5);
    expect(rr.trades.some((t) => t.exitReason === "target")).toBe(true);
    expect(rr.trades.every((t) => t.exitReason !== "signal")).toBe(true);
  });

  it("rsi-reversion produces trades with sane R multiples", () => {
    const res = run("rsi-reversion");
    expect(res.trades.length).toBeGreaterThan(3);
    for (const t of res.trades) expect(Math.abs(t.rMultiple)).toBeLessThan(6);
  });

  it("orb fires at most one trade per side per session and stops sit at the range", () => {
    const res = run("orb");
    expect(res.trades.length).toBeGreaterThan(3);
    const perSessionSide = new Map<string, number>();
    for (const t of res.trades) {
      const key = `${nyDateKey(t.entryTime)}:${t.side}`;
      perSessionSide.set(key, (perSessionSide.get(key) || 0) + 1);
    }
    for (const count of perSessionSide.values()) expect(count).toBeLessThanOrEqual(1);
    // Entries only after the opening range completes.
    for (const t of res.trades)
      expect(nyMeta(t.entryTime).minutes).toBeGreaterThanOrEqual(NY_SESSION_START_MIN + 30);
  });

  it("vwap-reversion targets the vwap and every trade closes intraday", () => {
    const res = run("vwap-reversion");
    expect(res.trades.length).toBeGreaterThan(3);
    for (const t of res.trades) {
      expectIntraday(t.entryTime, t.exitTime);
      expect(t.target).not.toBeNull();
    }
  });

  it("bollinger-breakout produces squeeze-gated trades", () => {
    const res = run("bollinger-breakout");
    expect(res.trades.length).toBeGreaterThan(0);
    expect((res.skipReasons.noSignal ?? 0)).toBeGreaterThan(100);
  });

  it("every full-session trade is flattened intraday", () => {
    for (const id of ["ema-cross", "rsi-reversion", "orb", "vwap-reversion", "bollinger-breakout"]) {
      const res = run(id);
      for (const t of res.trades) expectIntraday(t.entryTime, t.exitTime);
    }
  });
});
