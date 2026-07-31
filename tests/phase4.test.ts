import { describe, it, expect } from "vitest";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import { strategyById, isHypothesis, PHASE4_HYPOTHESES } from "@/lib/strategies/registry";
import { turnOfMonthPositions } from "@/lib/strategies/turn-of-month";
import {
  DEFAULT_SEAM_THRESHOLD,
  overnightSplit,
  sessionEnds,
  describeOvernight,
} from "@/lib/diagnostics/overnight";
import { EXECUTION } from "@/scripts/engine/tiers";
import { nyMeta } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";

/* Sessions of 5m RTH bars from 09:30 NY. `volume` is settable per session so
   the relative-volume filter can be exercised. */
function sessionBars(
  year: number,
  month: number,
  day: number,
  count: number,
  price: (i: number) => number,
  volume = 100,
): Bar[] {
  const open = Date.UTC(year, month - 1, day, 13, 30) / 1000;
  return Array.from({ length: count }, (_, i) => {
    const p = price(i);
    return { time: open + i * 300, open: p, high: p + 2, low: p - 2, close: p, volume };
  });
}

/* ── Turn of the month ───────────────────────────────────────────────────*/
const monthOf = (month: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);

describe("turnOfMonthPositions", () => {
  it("counts trading sessions from each end", () => {
    const p = turnOfMonthPositions(monthOf("2026-04", 20));
    expect(p.get("2026-04-20")).toBe(-1); // last session
    expect(p.get("2026-04-19")).toBe(-2);
    expect(p.get("2026-04-01")).toBe(1); // first session
    expect(p.get("2026-04-02")).toBe(2);
    // Mid-month is outside the window entirely.
    expect(p.get("2026-04-10")).toBeUndefined();
  });

  it("windows are four sessions deep at each end, and no deeper", () => {
    const p = turnOfMonthPositions(monthOf("2026-04", 20));
    expect(p.get("2026-04-17")).toBe(-4);
    expect(p.get("2026-04-16")).toBeUndefined();
    expect(p.get("2026-04-04")).toBe(4);
    expect(p.get("2026-04-05")).toBeUndefined();
  });

  /* The guard that matters: month boundaries are INFERRED from the sessions
     present, so a truncated slice would otherwise label its last available
     session "month end" and manufacture signals on ordinary mid-month days.
     Every window in this app is truncated at both ends. */
  it("ignores a month the data only partly contains", () => {
    expect(turnOfMonthPositions(monthOf("2026-03", 5)).size).toBe(0);
    expect(turnOfMonthPositions(["2026-06-01"]).size).toBe(0);
  });

  it("still marks complete months either side of a fragment", () => {
    const p = turnOfMonthPositions([
      ...monthOf("2026-03", 4), // fragment: ignored
      ...monthOf("2026-04", 20), // complete
    ]);
    expect(p.get("2026-03-04")).toBeUndefined();
    expect(p.get("2026-04-20")).toBe(-1);
  });

  it("treats a short holiday month as real once it clears the floor", () => {
    const p = turnOfMonthPositions(monthOf("2026-12", 16));
    expect(p.get("2026-12-16")).toBe(-1);
  });
});

describe("turn-of-month strategy", () => {
  /* TWO COMPLETE months. A fixture with a handful of sessions per month would
     be discarded by the fragment guard, and one that squeaked past it would
     label its last available day "month end" — which is exactly the bug the
     guard exists to prevent, so the fixture must not depend on it. */
  const bars: Bar[] = [];
  for (const month of [3, 4] as const) {
    for (let day = 1; day <= 20; day++) {
      bars.push(...sessionBars(2026, month, day, 60, (i) => 5000 + i * 0.5));
    }
  }

  const req: RunRequest = {
    strategyId: "turn-of-month",
    params: { lastDays: 1, firstDays: 3, atrMult: 2, targetR: 2, direction: "long" },
    series: { MES: bars },
    execution: { ...EXECUTION, fillModel: "nextOpen" },
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValues: { MES: 5 },
  };

  it("trades only inside the turn-of-month window", () => {
    const trades = executeRun(req).trades;
    expect(trades.length).toBeGreaterThan(0);
    const days = new Set(trades.map((t) => nyMeta(t.entryTime).dateKey));
    // Mid-month sessions must never appear: with lastDays 1 and firstDays 3,
    // only 03-20, 04-01..03 and 04-20 are eligible.
    for (const mid of ["2026-03-10", "2026-04-08", "2026-04-12", "2026-04-15"]) {
      expect(days.has(mid), `${mid} is mid-month`).toBe(false);
    }
    expect(days.has("2026-04-01")).toBe(true);
  });

  it("is long only, as the published effect describes", () => {
    for (const t of executeRun(req).trades) expect(t.side).toBe("LONG");
  });

  it("takes at most one entry per session", () => {
    const trades = executeRun(req).trades;
    const days = trades.map((t) => nyMeta(t.entryTime).dateKey);
    expect(new Set(days).size).toBe(days.length);
  });

  it("takes fewer trades with a narrower window", () => {
    const wide = executeRun(req).trades.length;
    const narrow = executeRun({
      ...req,
      params: { ...req.params, lastDays: 0, firstDays: 1 },
    }).trades.length;
    expect(narrow).toBeLessThanOrEqual(wide);
  });
});

/* ── ORB + relative volume ───────────────────────────────────────────────*/
describe("orb-relvol", () => {
  /* Twenty quiet sessions to build the volume baseline, then one session that
     breaks out. The breakout session's VOLUME is what varies between cases —
     the price path is identical, so any difference in behaviour is the filter. */
  function build(breakoutVolume: number): Bar[] {
    const out: Bar[] = [];
    for (let d = 0; d < 20; d++) {
      const day = 2 + d; // 2026-06-02 onwards; weekends are harmless here
      out.push(...sessionBars(2026, 6, day, 60, () => 5000, 100));
    }
    // Breakout day: flat for the 30-minute range, then a strong move up.
    out.push(
      ...sessionBars(2026, 6, 24, 60, (i) => (i < 6 ? 5000 : 5000 + (i - 5) * 4), breakoutVolume),
    );
    return out;
  }

  const req = (bars: Bar[], relVolMin: number): RunRequest => ({
    strategyId: "orb-relvol",
    params: {
      rangeMinutes: 30,
      relVolMin,
      relVolLookback: 14,
      bufferPts: 1,
      stopMode: "range",
      atrMult: 1.5,
      targetR: 2,
      bothSides: true,
    },
    series: { MES: bars },
    execution: { ...EXECUTION, fillModel: "nextOpen" },
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValues: { MES: 5 },
  });

  it("takes the breakout when volume is running high", () => {
    const res = executeRun(req(build(300), 1.5));
    expect(res.trades.length).toBeGreaterThan(0);
    expect(res.trades[0].side).toBe("LONG");
  });

  /* The filter IS the hypothesis, so this is the load-bearing test: identical
     price, lower volume, no trade. */
  it("skips the identical breakout when volume is normal", () => {
    expect(executeRun(req(build(100), 1.5)).trades).toHaveLength(0);
  });

  it("records the rejection in the funnel rather than silently dropping it", () => {
    const res = executeRun(req(build(100), 1.5));
    expect(res.skipReasons.belowRelVol ?? 0).toBeGreaterThan(0);
  });

  it("is monotone in the threshold — a higher bar never takes more trades", () => {
    const bars = build(200);
    const counts = [0.5, 1.5, 2.5, 4].map((t) => executeRun(req(bars, t)).trades.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  });

  it("refuses to trade before it has enough sessions to compare against", () => {
    // Only three sessions of history: relative volume is not yet defined.
    const short = [
      ...sessionBars(2026, 6, 2, 60, () => 5000, 100),
      ...sessionBars(2026, 6, 3, 60, (i) => (i < 6 ? 5000 : 5000 + (i - 5) * 4), 900),
    ];
    const res = executeRun(req(short, 1.5));
    expect(res.trades).toHaveLength(0);
    expect(res.skipReasons.noRelVolHistory ?? 0).toBeGreaterThan(0);
  });

  it("is registered as a hypothesis, not as a tradeable stream", () => {
    expect(isHypothesis("orb-relvol")).toBe(true);
    expect(isHypothesis("turn-of-month")).toBe(true);
    expect(isHypothesis("zone-v5")).toBe(false);
    expect(PHASE4_HYPOTHESES.size).toBe(2);
  });

  it("says in its own blurb that it is untested", () => {
    for (const id of PHASE4_HYPOTHESES) {
      expect(strategyById(id).blurb.toLowerCase()).toContain("untested");
    }
  });
});

/* ── Overnight vs intraday ───────────────────────────────────────────────*/
describe("overnight decomposition", () => {
  /* Three sessions where the split is known exactly by construction:
     each session opens 10 points above the previous close (overnight +10)
     and closes 4 points below its own open (intraday −4). */
  const bars: Bar[] = [];
  let base = 5000;
  for (const day of [1, 2, 3, 4]) {
    const open = base;
    bars.push(
      ...sessionBars(2026, 6, day, 12, (i) => (i === 0 ? open : open - (4 * i) / 11)),
    );
    base = open - 4 + 10; // close, then gap up 10
  }

  it("finds the session ends", () => {
    const ends = sessionEnds(bars);
    expect(ends).toHaveLength(4);
    expect(ends[0].open).toBeCloseTo(5000, 6);
    expect(ends[0].close).toBeCloseTo(4996, 6);
  });

  it("splits the drift into the two legs", () => {
    const s = overnightSplit(bars, { iterations: 200 });
    expect(s.sessions).toBe(3);
    expect(s.overnightBps.mean).toBeGreaterThan(0); // gaps up
    expect(s.intradayBps.mean).toBeLessThan(0); // drifts down
  });

  /* The invariant that catches a session-boundary error: the two legs must
     sum to the close-to-close return. If they do not, the split is wrong. */
  it("overnight plus intraday equals close-to-close", () => {
    const s = overnightSplit(bars, { iterations: 200 });
    expect(s.overnightBps.mean + s.intradayBps.mean).toBeCloseTo(s.closeToCloseBps.mean, 6);
  });

  it("excludes contract-roll gaps rather than counting them as drift", () => {
    const withSeam = [
      ...bars,
      // A 400-point gap: a roll, not a market move.
      ...sessionBars(2026, 6, 5, 12, () => 5400, 100),
    ];
    const s = overnightSplit(withSeam, { iterations: 200 });
    expect(s.excludedSeams).toBeGreaterThan(0);
  });

  it("keeps ordinary large moves, which a tighter threshold would discard", () => {
    expect(DEFAULT_SEAM_THRESHOLD).toBe(0.04);
    const bigButReal = [
      ...bars,
      ...sessionBars(2026, 6, 5, 12, () => 5100, 100), // ~2%: a real gap
    ];
    const before = overnightSplit(bars, { iterations: 200 }).sessions;
    expect(overnightSplit(bigButReal, { iterations: 200 }).sessions).toBe(before + 1);
  });

  it("names the structural-headwind case explicitly", () => {
    const s = overnightSplit(bars, { iterations: 200 });
    expect(describeOvernight(s, "MES")).toMatch(/headwind|overnight/i);
  });

  it("returns a zero-session result rather than throwing on empty input", () => {
    expect(overnightSplit([], { iterations: 10 }).sessions).toBe(0);
  });
});
