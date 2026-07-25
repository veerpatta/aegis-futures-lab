import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { runBacktest } from "@/lib/backtest/engine";
import { rsiReversion } from "@/lib/strategies/rsi-reversion";
import { defaultParams } from "@/lib/strategies/types";
import { nyTimeToUnix } from "@/lib/time/ny";
import {
  B_LOCKS,
  EXECUTION,
  MNQ_MES_DOLLAR_ATR_RATIO,
  SYMBOL_RISK,
  riskFor,
  tierStreams,
} from "../scripts/engine/tiers";

/* Item 2.3 — per-symbol risk profile. MES must reproduce today's behaviour
   exactly; MNQ's numbers come from its own measured dollar volatility. */

describe("SYMBOL_RISK", () => {
  it("keeps MES byte-identical to the tuned locks (parity reference)", () => {
    expect(SYMBOL_RISK.MES.locks).toEqual(B_LOCKS);
    expect(SYMBOL_RISK.MES.maxRisk).toBe(EXECUTION.maxRisk);
  });

  it("scales MNQ's daily-loss lock by its measured realised risk, not by point value", () => {
    // MES tolerates 250/142.2 = 1.76 losses; 1.76 x MNQ's $114.7 realised risk
    // is ~$202. NOT 250 x 2.68, which would loosen the lock rather than match it.
    expect(SYMBOL_RISK.MNQ.locks.dailyLoss).toBe(202);
    expect(SYMBOL_RISK.MNQ.locks.dailyLoss).toBeLessThan(B_LOCKS.dailyLoss);
    expect(SYMBOL_RISK.MNQ.locks.maxTrades).toBe(B_LOCKS.maxTrades);
    expect(SYMBOL_RISK.MNQ.locks.maxLosses).toBe(B_LOCKS.maxLosses);
  });

  it("leaves maxRisk alone — integer sizing, not the cap, binds MNQ", () => {
    expect(SYMBOL_RISK.MNQ.maxRisk).toBe(EXECUTION.maxRisk);
  });

  it("records the measured dollar-ATR ratio, which is 2.68 and not the brief's 4x", () => {
    expect(MNQ_MES_DOLLAR_ATR_RATIO).toBeCloseTo(2.68, 2);
    expect(MNQ_MES_DOLLAR_ATR_RATIO).toBeLessThan(4);
  });

  it("resolves a profile per stream, defaulting multi-symbol runs to MES", () => {
    expect(riskFor(["MES"])).toBe(SYMBOL_RISK.MES);
    expect(riskFor(["MNQ"])).toBe(SYMBOL_RISK.MNQ);
    expect(riskFor(["MES", "MNQ"])).toBe(SYMBOL_RISK.MES); // tier A, locks null anyway
  });
});

describe("tierStreams wiring", () => {
  it("gives each tier-B stream its own symbol's profile", () => {
    const b = tierStreams().filter((s) => s.tier === "B");
    expect(b.length).toBeGreaterThanOrEqual(2);
    for (const s of b) {
      const profile = SYMBOL_RISK[s.symbols[0]];
      expect(s.locks).toEqual(profile.locks);
      expect(s.maxRisk).toBe(profile.maxRisk);
    }
  });

  it("leaves tier A unlocked, as before", () => {
    const a = tierStreams().find((s) => s.tier === "A");
    expect(a?.locks).toBeNull();
  });
});

/* The finding that matters more than the change: for tier B at these sizes the
   daily-loss lock is UNREACHABLE, because maxTrades/maxLosses always fire
   first. This test pins that so a future reader does not assume 2.3 improved
   MNQ — it did not, and cannot. */
describe("the daily-loss lock is dead configuration at tier-B sizes", () => {
  /* A day that trends hard down, so RSI fires repeatedly and every entry
     loses: the most lock-provoking shape available. */
  function losingDay(): Bar[] {
    const bars: Bar[] = [];
    let price = 7000;
    for (let m = 570; m < 925; m += 5) {
      const time = nyTimeToUnix("2026-07-06", m);
      // Sawtooth down: RSI keeps crossing back up out of oversold, then falls.
      const wobble = (m / 5) % 6 < 3 ? 6 : -14;
      const open = price;
      price += wobble;
      bars.push({
        time,
        open,
        high: Math.max(open, price) + 3,
        low: Math.min(open, price) - 3,
        close: price,
        volume: 100,
      });
    }
    return bars;
  }

  const run = (dailyLoss: number) =>
    runBacktest({
      series: { MNQ: losingDay() },
      strategy: rsiReversion,
      params: { ...defaultParams(rsiReversion), session: "rth", oversold: 25, overbought: 75 },
      execution: { ...EXECUTION, fillModel: "nextOpen", maxRisk: EXECUTION.maxRisk },
      locks: { ...B_LOCKS, dailyLoss },
      startingCapital: 3000,
      sessionExitMinute: 925,
      pointValueOf: () => 2,
    });

  it("produces the same trades whether dailyLoss is 250 or 202", () => {
    const before = run(250);
    const after = run(202);
    expect(after.trades.length).toBe(before.trades.length);
    expect(after.metrics.net).toBeCloseTo(before.metrics.net, 6);
    expect(after.skipReasons.lock ?? 0).toBe(before.skipReasons.lock ?? 0);
  });

  it("never opens more than maxTrades in a day, which is why", () => {
    const res = run(202);
    expect(res.trades.length).toBeLessThanOrEqual(B_LOCKS.maxTrades);
  });
});
