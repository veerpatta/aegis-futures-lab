import { describe, expect, it } from "vitest";
import { fullSessions, nySessionWindows, seeded, slotAtOrAfter, timeMachine, TM_BARS_PER_DAY, TM_DAYS_PER_QUERY, TM_FIRST_MIN, TM_SLOTS, verdictOf, type TmBar } from "@/lib/timemachine";
import { inEntryWindow } from "@/lib/time/session";
import { tmCostLine, tmHistoryLine, tmRefusalWords } from "@/lib/plain/timemachine";
import { nyTimeToUnix } from "@/lib/time/ny";

/* Weekday NY dates from `from`, `n` of them (holidays included on purpose: the pool must skip them). */
function weekdays(from: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T12:00:00Z`);
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

/* One day of bars from 01:55 to 15:20 NY. `step(i)` gives each bar's close-to-close move as a fraction. */
function day(dateKey: string, start: number, step: (i: number) => number, wick = 0.0005): TmBar[] {
  const bars: TmBar[] = [];
  let prev = start;
  for (let m = 115; m < 925; m += 5) {
    const i = (m - 120) / 5;
    const close = prev * (1 + step(i));
    bars.push({ time: nyTimeToUnix(dateKey, m), open: prev, high: Math.max(prev, close) * (1 + wick), low: Math.min(prev, close) * (1 - wick), close });
    prev = close;
  }
  return bars;
}

const noisy = (seed: number) => {
  const r = seeded(seed);
  return () => (r() - 0.5) * 0.004;
};

const TRADE_DAY = "2026-10-21";
const POOL_DAYS = weekdays("2026-08-10", 50).filter((d) => d < TRADE_DAY);
const history = (step: (dk: string) => (i: number) => number) => POOL_DAYS.flatMap((dk) => day(dk, 6800, step(dk)));
const plan = { side: "LONG" as const, entry: 6800, stop: 6790, target: 6820, startSec: nyTimeToUnix(TRADE_DAY, 600) };

describe("time machine pool", () => {
  it("uses only full sessions before the trade day and skips early-close days", () => {
    const pool = fullSessions(history(() => noisy(1)), TRADE_DAY);
    expect(pool.every((s) => s.dateKey < TRADE_DAY && s.bars.length === TM_SLOTS)).toBe(true);
    expect(pool.map((s) => s.dateKey)).not.toContain("2026-09-07"); // Labor Day, early close
    // A session missing one bar is not full.
    const holed = history(() => noisy(1)).filter((b) => b.time !== nyTimeToUnix(POOL_DAYS[3], 700));
    expect(fullSessions(holed, TRADE_DAY).map((s) => s.dateKey)).not.toContain(POOL_DAYS[3]);
  });

  it("keeps at most the latest 59 sessions", () => {
    const many = weekdays("2026-04-06", 120).filter((d) => d < TRADE_DAY).flatMap((dk) => day(dk, 6800, noisy(2)));
    const pool = fullSessions(many, TRADE_DAY);
    expect(pool.length).toBe(59);
    expect(pool[pool.length - 1].dateKey < TRADE_DAY).toBe(true);
  });

  it("finds the first bar at or after the decision", () => {
    expect(slotAtOrAfter(nyTimeToUnix(TRADE_DAY, 120))).toBe(0);
    expect(slotAtOrAfter(nyTimeToUnix(TRADE_DAY, 601))).toBe(97);
    expect(slotAtOrAfter(nyTimeToUnix(TRADE_DAY, 920))).toBe(TM_SLOTS - 1);
    expect(slotAtOrAfter(nyTimeToUnix(TRADE_DAY, 925))).toBe(-1);
    expect(slotAtOrAfter(nyTimeToUnix(TRADE_DAY, 115))).toBe(-1);
  });

  it("replays exactly the bot's entry window, 02:00 to the 15:25 flatten", () => {
    expect(TM_SLOTS).toBe(161);
    expect(inEntryWindow(nyTimeToUnix(TRADE_DAY, TM_FIRST_MIN))).toBe(true);
    expect(inEntryWindow(nyTimeToUnix(TRADE_DAY, TM_FIRST_MIN - 5))).toBe(false);
  });

  it("asks a late trade's pool only for the bars it needs, so an overnight gap does not drop the day", () => {
    const gappy = history(() => noisy(3)).filter((b) => b.time !== nyTimeToUnix(POOL_DAYS[5], 200));
    expect(fullSessions(gappy, TRADE_DAY, 59, 0).map((s) => s.dateKey)).not.toContain(POOL_DAYS[5]);
    expect(fullSessions(gappy, TRADE_DAY, 59, 90).map((s) => s.dateKey)).toContain(POOL_DAYS[5]);
  });
});

describe("time machine replays", () => {
  const bars = history((dk) => noisy(dk.length + Number(dk.slice(-2))));

  it("gives the same numbers every time for the same seed", () => {
    const a = timeMachine(bars, plan, { replays: 2000 });
    const b = timeMachine(bars, plan, { replays: 2000 });
    expect(a).toEqual(b);
    if (!a.ok) throw new Error("expected odds");
    expect(a.odds.targetFirst + a.odds.stopFirst + a.odds.neither).toBeCloseTo(1, 10);
    expect(a.odds.seed).toBe(19);
  });

  it("never looks at the trade day or later", () => {
    const base = timeMachine(bars, plan, { replays: 2000 });
    const later = [...bars, ...day(TRADE_DAY, 6800, () => 0.01), ...day("2026-10-22", 7000, () => -0.01)];
    expect(timeMachine(later, plan, { replays: 2000 })).toEqual(base);
  });

  it("follows the trend it was built from, long and short", () => {
    const up = history(() => () => 0.0015);
    const long = timeMachine(up, plan, { replays: 500 });
    const short = timeMachine(up, { ...plan, side: "SHORT", stop: 6810, target: 6780 }, { replays: 500 });
    if (!long.ok || !short.ok) throw new Error("expected odds");
    expect(long.odds.targetFirst).toBe(1);
    expect(short.odds.stopFirst).toBe(1);
    expect(long.history.target).toBe(long.sessions);
    expect(short.history.stop).toBe(short.sessions);
  });

  it("counts a bar that touches both the stop and the target as the stop, like the bot", () => {
    const wild = history(() => () => 0);
    // Flat closes with ±0.5% wicks: every bar reaches both sides.
    const r = timeMachine(POOL_DAYS.flatMap((dk) => day(dk, 6800, () => 0, 0.005)), plan, { replays: 300 });
    if (!r.ok) throw new Error("expected odds");
    expect(r.odds.stopFirst).toBe(1);
    expect(r.history.stop).toBe(r.sessions);
    expect(fullSessions(wild, TRADE_DAY).length).toBeGreaterThan(20);
  });

  it("with no target, reports stop first or still open at 15:25", () => {
    const r = timeMachine(bars, { ...plan, target: null }, { replays: 1000 });
    if (!r.ok) throw new Error("expected odds");
    expect(r.odds.targetFirst).toBe(0);
    expect(r.verdict.lean).toBe("no-target");
  });

  it("refuses instead of guessing", () => {
    expect(timeMachine(bars.slice(0, 15 * TM_BARS_PER_DAY), plan)).toMatchObject({ ok: false, kind: "few-sessions", need: 20 });
    expect(timeMachine(bars, { ...plan, stop: 6810 })).toMatchObject({ ok: false, kind: "bad-plan", why: "stop-side" });
    expect(timeMachine(bars, { ...plan, target: 6795 })).toMatchObject({ ok: false, kind: "bad-plan", why: "target-side" });
    expect(timeMachine(bars, { ...plan, startSec: nyTimeToUnix(TRADE_DAY, 940) })).toMatchObject({ ok: false, kind: "outside-session" });
    expect(timeMachine(bars, { ...plan, startSec: nyTimeToUnix(TRADE_DAY, 60) })).toMatchObject({ ok: false, kind: "outside-session" });
    expect(timeMachine(bars, { ...plan, startSec: nyTimeToUnix("2026-11-27", 600) })).toMatchObject({ ok: false, kind: "early-close" });
  });
});

describe("time machine verdict", () => {
  it("matches the skill's own worked example: a 2R plan at 24.1% / 50.5% is close to break-even", () => {
    const v = verdictOf({ targetFirst: 0.241, stopFirst: 0.505, neither: 0.254, avgR: -0.1 }, 2);
    expect(v.lean).toBe("even");
    expect(v.need).toBeCloseTo(1 / 3, 6);
    expect(v.got).toBeCloseTo(0.241 / 0.746, 6);
  });

  it("leans and leans strongly at 5 and 15 points from break-even", () => {
    expect(verdictOf({ targetFirst: 0.58, stopFirst: 0.42, neither: 0, avgR: 0.1 }, 1).lean).toBe("leans-target");
    expect(verdictOf({ targetFirst: 0.7, stopFirst: 0.3, neither: 0, avgR: 0.3 }, 1).lean).toBe("strong-target");
    expect(verdictOf({ targetFirst: 0.3, stopFirst: 0.7, neither: 0, avgR: -0.3 }, 1).lean).toBe("strong-stop");
  });

  it("matches the skill's TSLA reel: 29.4% / 25.5% at 1R is close to a coin flip, with many replays still open", () => {
    expect(verdictOf({ targetFirst: 0.294, stopFirst: 0.255, neither: 0.451, avgR: 0.02 }, 1)).toMatchObject({ lean: "even", manyNeither: true });
  });

  it("flags an average that points against the lean", () => {
    expect(verdictOf({ targetFirst: 0.3, stopFirst: 0.2, neither: 0.5, avgR: -0.05 }, 1).avgAgainstLean).toBe(true);
  });
});

describe("time machine session windows", () => {
  it("covers each open weekday's 01:55–15:25 window inside the range, oldest first, skipping holidays", () => {
    const w = nySessionWindows(nyTimeToUnix("2026-11-20", 0), nyTimeToUnix("2026-12-01", 600));
    expect(w.map((x) => x.dateKey)).toEqual(["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30"]);
    expect(w[0].from).toBe(nyTimeToUnix("2026-11-20", 115));
    expect(w[0].to).toBe(nyTimeToUnix("2026-11-20", 925));
    // 2026-12-01's window is not over at 10:00, so it is left out; 2026-11-26 is Thanksgiving.
  });

  it("keeps each request under one 1,000-row page", () => {
    expect(TM_DAYS_PER_QUERY * TM_BARS_PER_DAY).toBeLessThan(1000);
    expect(TM_DAYS_PER_QUERY).toBeGreaterThan(0);
  });
});

describe("time machine words", () => {
  it("says one time, not one times, and about zero for a flat average", () => {
    expect(tmHistoryLine({ sessions: 59, target: 9, stop: 49, neither: 1, avgR: -0.1 })).toContain("neither 1 time (average −0.10 times the risk)");
    expect(tmCostLine(4.9, 0.05, 0.051)).toContain("the average replay is about zero");
  });

  it("names the replayed window in both clocks", () => {
    expect(tmRefusalWords({ kind: "outside-session" })).toMatch(/02:00–15:25 ET \(.* IST\)/);
  });
});
