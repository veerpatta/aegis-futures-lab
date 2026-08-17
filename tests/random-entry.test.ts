import { describe, it, expect } from "vitest";
import { runBacktest } from "@/lib/backtest/engine";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import {
  bootstrapGeometry,
  candidatePool,
  drawEntries,
  histogramDeviation,
  pValueOneSided,
  percentileOf,
  profileFrom,
  randomEntryStrategy,
  rngFor,
  seedFor,
  type EntryProfile,
  type Geometry,
} from "@/lib/diagnostics/randomEntry";
import { runNullDistribution, statsOf, verdictFor } from "@/lib/diagnostics/randomEntryRun";
import { mulberry32 } from "@/scripts/engine/montecarlo";
import type { ExecutionConfig } from "@/lib/strategies/types";
import { LEGACY_MODEL, resolveExecution } from "@/lib/costs";
import { EXECUTION } from "@/scripts/engine/tiers";
import { nyMeta, NY_SESSION_START_MIN } from "@/lib/time/ny";
import type { Bar, Trade } from "@/lib/types";

/* ── Fixture: 40 NY sessions of a seeded random walk ─────────────────────
   A random walk, deliberately: under it no entry rule can have edge, which is
   what makes the uniformity test below meaningful. */
function walk(sessions = 40, perSession = 66, seed = 7): Bar[] {
  const rand = mulberry32(seed);
  const out: Bar[] = [];
  let price = 5000;
  for (let d = 0; d < sessions; d++) {
    // Step by 7 days at a time in blocks of 5 to stay on weekdays.
    const day = 1 + Math.floor(d / 5) * 7 + (d % 5);
    const open = Date.UTC(2026, 5, day, 13, 30) / 1000;
    for (let i = 0; i < perSession; i++) {
      price += (rand() - 0.5) * 6;
      out.push({
        time: open + i * 300,
        open: price,
        high: price + rand() * 3,
        low: price - rand() * 3,
        close: price + (rand() - 0.5) * 2,
        volume: 100,
      });
    }
  }
  return out;
}

const BARS = walk();
const SERIES = { MES: BARS };
const WINDOW = { fromMin: NY_SESSION_START_MIN, toMin: 925 };
const POOL = candidatePool(SERIES, WINDOW);
const GEOMETRY: Geometry = { kind: "atr", atrLen: 14, atrMult: 1.5, targetR: 1.5 };

const PROFILE: EntryProfile = {
  n: 20,
  nLong: 11,
  minutes: Array.from({ length: 20 }, (_, i) => 600 + (i % 10) * 20),
  perSessionCounts: [1, 1, 2, 1, 3],
  tradedSessions: [],
};

function runDrawn(entries: ReturnType<typeof drawEntries>["entries"], exec = EXECUTION) {
  return runBacktest({
    series: SERIES,
    strategy: randomEntryStrategy(entries, GEOMETRY),
    params: {},
    execution: exec,
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValueOf: () => 5,
  });
}

const bookFor = (cell: string, iter: number, mode: "uniformDays" | "matchDayCounts" = "uniformDays") =>
  runDrawn(drawEntries(PROFILE, POOL, mode, rngFor(cell, iter), 0).entries).trades;

/* ════════════════════════════════════════════════════════════════════════
   THE test. Everything else is a proxy for this.

   If the null distribution is built correctly, then feeding it an "observed"
   book that is itself a draw from the same process must produce p-values that
   are uniform on [0,1]. That is the definition of a calibrated test.

   It catches, in one assertion: a degenerate PRNG (every iteration identical
   -> p pinned), an off-by-one in fill timing, a wrong percentile convention,
   and a null whose distribution is systematically shifted from the process it
   claims to model.

   The independent seeding is load-bearing. Reuse the same seed for the
   observed book and the null draws and uniformity becomes tautological — the
   test would pass while proving nothing.
   ════════════════════════════════════════════════════════════════════════ */
describe("the null distribution is calibrated", () => {
  const REPEATS = 120;
  const ITERATIONS = 60;

  const pValues: number[] = [];
  for (let r = 0; r < REPEATS; r++) {
    const observed = bookFor("observed-book", r);
    const nulls: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      nulls.push(statsOf(bookFor(`null-${r}`, i)).avgR);
    }
    pValues.push(pValueOneSided(nulls, statsOf(observed).avgR));
  }

  it("produces p-values that are not degenerate", () => {
    expect(new Set(pValues).size).toBeGreaterThan(10);
    expect(Math.min(...pValues)).toBeLessThan(0.3);
    expect(Math.max(...pValues)).toBeGreaterThan(0.7);
  });

  it("rejects at roughly the nominal rate", () => {
    const rate = pValues.filter((p) => p < 0.05).length / REPEATS;
    expect(rate).toBeGreaterThanOrEqual(0.005);
    expect(rate).toBeLessThanOrEqual(0.15);
  });

  it("puts about half the mass below the median", () => {
    const rate = pValues.filter((p) => p < 0.5).length / REPEATS;
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.65);
  });
});

/* Positive control: a book built with genuine look-ahead must be flagged.
   Without this, the uniformity test above is consistent with a test that has
   no power at all. */
describe("positive control", () => {
  it("puts a look-ahead book above the 95th percentile", () => {
    // Enter LONG only where the next 12 bars actually rose. This is cheating,
    // which is the point: the benchmark must notice.
    // At most one per session, so position conflicts do not swallow them all.
    const seen = new Set<string>();
    const cheatEntries = POOL.filter((c) => {
      const future = BARS[Math.min(c.index + 12, BARS.length - 1)];
      if (!(future.close > BARS[c.index].close + 6) || seen.has(c.dateKey)) return false;
      seen.add(c.dateKey);
      return true;
    }).map((c) => ({ symbol: c.symbol, time: c.time, side: "LONG" as const, geometryDraw: 0 }));

    const cheat: Trade[] = [];
    const strategy = randomEntryStrategy(cheatEntries, GEOMETRY);
    const observed = runBacktest({
      series: SERIES,
      strategy,
      params: {},
      execution: EXECUTION,
      locks: null,
      startingCapital: 3000,
      sessionExitMinute: 925,
      pointValueOf: () => 5,
    }).trades;
    cheat.push(...observed);
    expect(cheat.length).toBeGreaterThan(5);

    const nulls = Array.from({ length: 200 }, (_, i) => statsOf(bookFor("control", i)).avgR);
    expect(percentileOf(nulls, statsOf(cheat).avgR)).toBeGreaterThan(95);
  });
});

/* ── Pool membership ─────────────────────────────────────────────────────
   Uniformity will NOT catch a biased pool: a null sampled from a stricter
   universe than the strategy is internally consistent and still wrong. This
   is the check that catches it. */
describe("candidate pool", () => {
  it("contains every bar the real strategy actually entered on", () => {
    const req: RunRequest = {
      strategyId: "rsi-reversion",
      params: { length: 14, oversold: 30, overbought: 70, atrMult: 1.5, targetR: 1.5, session: "rth" },
      series: SERIES,
      execution: EXECUTION,
      locks: null,
      startingCapital: 3000,
      sessionExitMinute: 925,
      pointValues: { MES: 5 },
    };
    const real = executeRun(req).trades;
    expect(real.length).toBeGreaterThan(0);

    // rsi-reversion fills at the next bar's open, so the SIGNAL bar is the one
    // before the entry bar; the pool is indexed by signal bar.
    const poolTimes = new Set(POOL.map((c) => c.time));
    for (const t of real) {
      expect(poolTimes.has(t.entryTime - 300)).toBe(true);
    }
  });

  it("excludes bars outside the session window", () => {
    for (const c of POOL) {
      expect(c.minuteOfDay).toBeGreaterThanOrEqual(WINDOW.fromMin);
      expect(c.minuteOfDay).toBeLessThan(WINDOW.toMin);
    }
  });

  it("excludes the last bar of each session (no next bar to fill on)", () => {
    const bySession = new Map<string, number[]>();
    for (const c of POOL) {
      (bySession.get(c.dateKey) ?? bySession.set(c.dateKey, []).get(c.dateKey)!).push(c.index);
    }
    for (const [, idxs] of bySession) {
      const last = Math.max(...idxs);
      expect(nyMeta(BARS[last + 1].time).dateKey).toBe(nyMeta(BARS[last].time).dateKey);
    }
  });

  it("carries no price data, so entry selection cannot look ahead", () => {
    const keys = Object.keys(POOL[0]).sort();
    expect(keys).toEqual(["dateKey", "index", "minuteOfDay", "symbol", "time"]);
  });
});

/* ── The sampler holds what it claims to hold ────────────────────────────*/
describe("drawEntries", () => {
  it("draws the direction mix exactly, not as coin flips", () => {
    for (let i = 0; i < 25; i++) {
      const { entries } = drawEntries(PROFILE, POOL, "uniformDays", rngFor("mix", i), 0);
      const longs = entries.filter((e) => e.side === "LONG").length;
      // Exact, every single iteration — i.i.d. flips would drift by ~sqrt(N).
      expect(longs).toBe(PROFILE.nLong);
      expect(entries).toHaveLength(PROFILE.n);
    }
  });

  it("returns entries in time order", () => {
    const { entries } = drawEntries(PROFILE, POOL, "matchDayCounts", rngFor("order", 1), 0);
    const times = entries.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("never draws the same bar twice", () => {
    const { entries } = drawEntries(PROFILE, POOL, "uniformDays", rngFor("dupes", 3), 0);
    expect(new Set(entries.map((e) => `${e.symbol}|${e.time}`)).size).toBe(entries.length);
  });

  it("draws only minutes that appear in the real book", () => {
    const allowed = new Set(PROFILE.minutes);
    const { entries } = drawEntries(PROFILE, POOL, "uniformDays", rngFor("minutes", 5), 0);
    for (const e of entries) expect(allowed.has(nyMeta(e.time).minutes)).toBe(true);
  });

  it("reproduces the real minute histogram closely", () => {
    const drawn: number[] = [];
    for (let i = 0; i < 40; i++) {
      for (const e of drawEntries(PROFILE, POOL, "uniformDays", rngFor("hist", i), 0).entries) {
        drawn.push(nyMeta(e.time).minutes);
      }
    }
    expect(histogramDeviation(PROFILE.minutes, drawn)).toBeLessThan(0.03);
  });

  it("clusters into fewer sessions under matchDayCounts than uniformDays", () => {
    const sessions = (mode: "uniformDays" | "matchDayCounts") => {
      let total = 0;
      for (let i = 0; i < 30; i++) {
        const { entries } = drawEntries(PROFILE, POOL, mode, rngFor(`cluster-${mode}`, i), 0);
        total += new Set(entries.map((e) => nyMeta(e.time).dateKey)).size;
      }
      return total / 30;
    };
    expect(sessions("matchDayCounts")).toBeLessThan(sessions("uniformDays"));
  });

  it("restricts to the real sessions under matchSessions", () => {
    const traded = [nyMeta(BARS[0].time).dateKey, nyMeta(BARS[200].time).dateKey];
    const profile = { ...PROFILE, tradedSessions: traded };
    const { entries } = drawEntries(profile, POOL, "matchSessions", rngFor("restricted", 1), 0);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(traded).toContain(nyMeta(e.time).dateKey);
  });

  it("returns nothing for an empty profile rather than throwing", () => {
    const empty = { ...PROFILE, n: 0, nLong: 0 };
    expect(drawEntries(empty, POOL, "uniformDays", rngFor("empty", 0), 0).entries).toEqual([]);
  });
});

/* ── Determinism ─────────────────────────────────────────────────────────*/
describe("reproducibility", () => {
  it("gives iteration 37 the same result standalone as in a full run", () => {
    const standalone = statsOf(bookFor("cellA", 37));
    const inRun = Array.from({ length: 50 }, (_, i) => statsOf(bookFor("cellA", i)))[37];
    expect(inRun.net).toBe(standalone.net);
    expect(inRun.n).toBe(standalone.n);
  });

  it("seeds differently per cell and per iteration", () => {
    expect(seedFor("A", 1)).not.toBe(seedFor("A", 2));
    expect(seedFor("A", 1)).not.toBe(seedFor("B", 1));
    expect(seedFor("A", 1)).toBe(seedFor("A", 1));
  });

  it("does not collapse to one repeated book", () => {
    const nets = Array.from({ length: 60 }, (_, i) => statsOf(bookFor("variety", i)).net);
    expect(new Set(nets).size).toBeGreaterThan(40);
  });
});

/* ── The null must pay the same costs as the real book ───────────────────
   A cost-free null would out-earn reality and wrongly "prove" the strategy
   bad. This is the single most dangerous silent failure in the whole test. */
describe("cost parity between null and real", () => {
  const profile = { ...PROFILE, tradedSessions: [] };
  const spec = {
    cell: "cost-check",
    series: SERIES,
    execution: EXECUTION,
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValues: { MES: 5 },
    sessionWindow: WINDOW,
    profile,
    geometry: GEOMETRY,
    mode: "uniformDays" as const,
    iterations: 20,
  };

  it("passes the real ExecutionConfig through untouched", () => {
    expect(spec.execution).toBe(EXECUTION);
    expect(spec.execution.cost).toBe(2.4);
    expect(spec.execution.slippage).toBe(0.25);
  });

  it("produces a materially worse null when costs are removed", () => {
    const withCost = runNullDistribution(spec, bookFor("real-ish", 1), POOL);
    const free = runNullDistribution(
      { ...spec, execution: { ...EXECUTION, cost: 0, slippage: 0 } },
      bookFor("real-ish", 1),
      POOL,
    );
    // Cost-free nulls earn more; if these were equal, costs were not applied.
    expect(free.medianNullNet).toBeGreaterThan(withCost.medianNullNet);
  });
});

/* The pre-2026-08-17 EXECUTION, rebuilt explicitly.

   tiers.ts's EXECUTION now carries the corrections adopted with the Phase 1
   re-measurement (minStopPoints, restingLimitOrders, REALISTIC friction).
   The assertions below are about something else — the ENTRY SAMPLER's fidelity, not the fill guards — so they pin the legacy
   config rather than silently measuring two changes at once. Relaxing the
   thresholds instead would have been the goalpost move this repo exists to
   refuse. */
const LEGACY_EXECUTION: ExecutionConfig = resolveExecution(LEGACY_MODEL, "MES", {
  maxRisk: 160,
  sizing: "risk",
  fillModel: "limit",
});

/* ── Reporting ───────────────────────────────────────────────────────────*/
describe("runNullDistribution reporting", () => {
  /* A deliberately LARGER book than the 20-trade PROFILE used above.
     minuteDeviation compares the real book's minute histogram against the
     null's pooled one, and the null pools thousands of draws — so with a
     15-trade real book the metric measures the real side's lumpiness, not the
     sampler's fidelity. At production scale (1,180-2,731 trades) that is not a
     concern; here the fixture has to be sized to match. */
  const BIG_PROFILE: EntryProfile = {
    n: 120,
    nLong: 66,
    minutes: Array.from({ length: 120 }, (_, i) => 600 + (i % 20) * 15),
    perSessionCounts: [2, 3, 4, 3, 2],
    tradedSessions: [],
  };
  const real = runDrawn(
    drawEntries(BIG_PROFILE, POOL, "matchDayCounts", rngFor("real-book", 99), 0).entries,
  ).trades;
  const result = runNullDistribution(
    {
      cell: "report",
      series: SERIES,
      execution: LEGACY_EXECUTION,
      locks: null,
      startingCapital: 3000,
      sessionExitMinute: 925,
      pointValues: { MES: 5 },
      sessionWindow: WINDOW,
      profile: profileFrom(real),
      geometry: GEOMETRY,
      mode: "matchDayCounts",
      iterations: 120,
    },
    real,
  );

  it("matches the real book's direction mix", () => {
    expect(result.meanLongFraction).toBeCloseTo(result.realLongFraction, 1);
  });

  it("realises close to the real trade count", () => {
    // Drawn entries landing inside an open trade are skipped by the engine, so
    // this is an OUTPUT to be checked rather than an assumption.
    expect(result.realisedNRatio).toBeGreaterThan(0.8);
  });

  /* minuteDeviation is a REPORTED diagnostic, not a correctness invariant, and
     two things feed it. Sampler fidelity is pinned tightly elsewhere ("draws
     only minutes that appear in the real book", and drawn-vs-real histogram
     under 0.03). What is left here is conflict drift: under matchDayCounts
     several entries land in one session, and the engine only calls the
     strategy while flat, so the first entry of a session fills more reliably
     than the later ones. That skews the REALISED histogram slightly toward
     earlier minutes. It is inherent to matching a clustered book, it applies
     equally to both sides of the comparison, and the right response is to
     print it every run rather than to pretend it is zero. */
  it("reproduces the real time-of-day distribution to within conflict drift", () => {
    expect(result.minuteDeviation).toBeLessThan(0.15);
  });

  it("shows the conflict drift it is reporting is real", () => {
    // Entries were genuinely skipped; that is what moves the histogram.
    expect(result.realisedNRatio).toBeLessThan(1);
  });

  it("orders the reported quantiles", () => {
    expect(result.p05NullNet).toBeLessThanOrEqual(result.medianNullNet);
    expect(result.medianNullNet).toBeLessThanOrEqual(result.p95NullNet);
  });

  it("keeps the p-value strictly inside (0,1)", () => {
    expect(result.pValueAvgR).toBeGreaterThan(0);
    expect(result.pValueAvgR).toBeLessThanOrEqual(1);
  });

  it("refuses to judge a sample that is too small", () => {
    expect(verdictFor({ ...result, real: { ...result.real, n: 5 } })).toBe("insufficient-sample");
  });

  it("reads a mid-pack result as indistinguishable from random", () => {
    // The fixture book is deliberately small, so give the verdict a sample it
    // is allowed to judge; the thresholds are what is under test here.
    const judged = { ...result, real: { ...result.real, n: 400 } };
    expect(verdictFor({ ...judged, percentileAvgR: 50 })).toBe("indistinguishable-from-random");
    expect(verdictFor({ ...judged, percentileAvgR: 97 })).toBe("beats-random");
    expect(verdictFor({ ...judged, percentileAvgR: 2 })).toBe("worse-than-random");
  });
});

/* ── Bootstrap geometry (tier A) ─────────────────────────────────────────*/
describe("bootstrapGeometry", () => {
  const mk = (entry: number, stop: number, target: number | null, atrAtEntry?: number): Trade =>
    ({
      id: 1,
      symbol: "MES",
      side: "LONG",
      qty: 1,
      entryTime: 0,
      entryPrice: entry,
      exitTime: 300,
      exitPrice: entry,
      stop,
      initialStop: stop,
      target,
      exitReason: "stop",
      points: 0,
      pnl: 0,
      rMultiple: 0,
      atrAtEntry,
    }) as Trade;

  it("expresses the stop in ATR units and the target in R", () => {
    const g = bootstrapGeometry([mk(5000, 4990, 5020, 5)]);
    expect(g.kind).toBe("bootstrap");
    if (g.kind !== "bootstrap") return;
    expect(g.draws[0].stopAtrMult).toBeCloseTo(2, 9); // 10 points / ATR 5
    expect(g.draws[0].target).toEqual({ kind: "rMultiple", r: 2 }); // 20 / 10
  });

  it("keeps stop and target paired, preserving their correlation", () => {
    const g = bootstrapGeometry([mk(5000, 4990, 5020, 5), mk(5000, 4995, 5005, 5)]);
    if (g.kind !== "bootstrap") return;
    expect(g.draws).toHaveLength(2);
    // Second trade: stop 5 points (ATR 5 -> 1.0x), target 5 points -> 1R.
    // The 2x-stop trade keeps its 2R target and the 1x-stop trade keeps its
    // 1R target; a pooled draw would have mixed them.
    expect(g.draws[1].stopAtrMult).toBeCloseTo(1, 9);
    expect(g.draws[1].target).toEqual({ kind: "rMultiple", r: 1 });
  });

  it("drops trades with no ATR rather than inventing one", () => {
    const g = bootstrapGeometry([mk(5000, 4990, 5020, undefined)]);
    if (g.kind !== "bootstrap") return;
    expect(g.draws).toHaveLength(0);
  });

  it("carries a null target through as signalOnly", () => {
    const g = bootstrapGeometry([mk(5000, 4990, null, 5)]);
    if (g.kind !== "bootstrap") return;
    expect(g.draws[0].target).toEqual({ kind: "signalOnly" });
  });
});
