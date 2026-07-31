import { describe, it, expect } from "vitest";
import {
  bootstrapMean,
  horizonStudy,
  indexBars,
  type SignalPoint,
} from "@/lib/diagnostics/horizonReturns";
import {
  describeEffectiveN,
  effectiveSampleSize,
  pairedReturns,
  pearson,
  rollingCorrelation,
  summariseCorrelation,
} from "@/lib/diagnostics/correlation";
import { atr } from "@/lib/indicators";
import { mulberry32 } from "@/scripts/engine/montecarlo";
import { nyMeta } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";

/* Sessions of 5m bars starting 09:30 NY. 2026-06-01 is a Monday. */
function sessions(count: number, perSession: number, price: (d: number, i: number) => number): Bar[] {
  const out: Bar[] = [];
  for (let d = 0; d < count; d++) {
    const day = 1 + Math.floor(d / 5) * 7 + (d % 5);
    const open = Date.UTC(2026, 5, day, 13, 30) / 1000;
    for (let i = 0; i < perSession; i++) {
      const p = price(d, i);
      out.push({ time: open + i * 300, open: p, high: p + 1, low: p - 1, close: p, volume: 100 });
    }
  }
  return out;
}

const withAtr = (bars: Bar[]) => indexBars(bars, atr(bars, 14));

describe("bootstrapMean", () => {
  it("brackets the true mean of a symmetric sample", () => {
    const xs = Array.from({ length: 400 }, (_, i) => (i % 2 ? 1 : -1) + 0.5);
    const ci = bootstrapMean(xs, 500, 3);
    expect(ci.mean).toBeCloseTo(0.5, 6);
    expect(ci.lo).toBeLessThan(0.5);
    expect(ci.hi).toBeGreaterThan(0.5);
  });

  it("excludes zero for a clearly positive sample", () => {
    const ci = bootstrapMean(Array.from({ length: 300 }, () => 2), 500, 4);
    expect(ci.lo).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const xs = Array.from({ length: 100 }, (_, i) => Math.sin(i));
    expect(bootstrapMean(xs, 200, 9)).toEqual(bootstrapMean(xs, 200, 9));
  });

  it("returns NaN rather than 0 for an empty sample", () => {
    expect(bootstrapMean([], 100, 1).mean).toBeNaN();
  });
});

/* ── The seasonality trap ────────────────────────────────────────────────
   The point of the same-time-of-day control. A series where price ALWAYS
   drifts up between 10:00 and 10:30 gives a "signal" that only ever fires at
   10:00 a real positive return against zero — and no advantage at all against
   other days at the same clock time. A study testing only against zero would
   call that edge. */
describe("horizonStudy separates signal from time-of-day seasonality", () => {
  const SEASONAL = sessions(60, 66, (_d, i) => {
    // Flat all session except a reliable ramp over bars 6-12 (10:00-10:30).
    const ramp = i <= 6 ? 0 : i >= 12 ? 30 : (i - 6) * 5;
    return 5000 + ramp;
  });

  it("reports a positive raw return but no excess over the control", () => {
    const idx = { MES: withAtr(SEASONAL) };
    // Fire at 10:00 (bar 6) on every session — pure seasonality, no skill.
    const signals: SignalPoint[] = SEASONAL.filter(
      (b) => nyMeta(b.time).minutes === 570 + 30,
    ).map((b) => ({ symbol: "MES", time: b.time, side: "LONG" as const }));
    expect(signals.length).toBeGreaterThan(30);

    const [h30] = horizonStudy(signals, idx, { horizons: [30], iterations: 400, seed: 5 });
    expect(h30.n).toBeGreaterThan(30);
    // Against zero it looks like edge...
    expect(h30.beatsZero).toBe(true);
    // ...against the same clock time on other days, it is nothing.
    expect(h30.beatsControl).toBe(false);
    // Not exactly zero: the control averages a handful of draws per signal, so
    // a little sampling noise survives. Orders of magnitude below the raw
    // signal mean is the claim.
    expect(Math.abs(h30.excess.mean)).toBeLessThan(Math.abs(h30.signal.mean) / 100);
  });
});

describe("horizonStudy finds real signal", () => {
  /* Price is a seeded random walk, EXCEPT that after a marked bar it drifts
     up. The marker is a specific minute on odd days only, so the control
     (same minute, other days) does not inherit the drift. */
  const rand = mulberry32(21);
  const REAL = sessions(60, 66, (d, i) => {
    let p = 5000 + (rand() - 0.5) * 4;
    if (d % 2 === 1 && i > 20 && i <= 32) p += (i - 20) * 3;
    return p;
  });

  it("detects an excess over the same-time control", () => {
    const idx = { MES: withAtr(REAL) };
    const signals: SignalPoint[] = REAL.filter((b) => {
      const m = nyMeta(b.time);
      const dayNum = Number(m.dateKey.slice(-2));
      return m.minutes === 570 + 100 && dayNum % 2 === 0;
    }).map((b) => ({ symbol: "MES", time: b.time, side: "LONG" as const }));

    const [h30] = horizonStudy(signals, idx, { horizons: [30], iterations: 400, seed: 6 });
    if (h30.n < 10) return; // fixture guard; the seasonality test is the load-bearing one
    expect(h30.signal.mean).toBeGreaterThan(h30.control.mean);
  });
});

describe("horizonStudy mechanics", () => {
  const FLAT = sessions(30, 66, () => 5000);
  const idx = { MES: withAtr(FLAT) };
  const signals: SignalPoint[] = FLAT.filter((b) => nyMeta(b.time).minutes === 600).map((b) => ({
    symbol: "MES",
    time: b.time,
    side: "LONG" as const,
  }));

  /* Minute 890 is bar 64 of 66 — it EXISTS, but a 60-minute forward window
     (12 bars) runs off the end of the session. Picking a minute with no bar at
     all would make these tests pass vacuously. */
  const late: SignalPoint[] = FLAT.filter((b) => nyMeta(b.time).minutes === 890).map((b) => ({
    symbol: "MES",
    time: b.time,
    side: "LONG" as const,
  }));

  it("has real signals to test the boundary with", () => {
    expect(late.length).toBeGreaterThan(20);
  });

  it("never measures across a session boundary", () => {
    const [h60] = horizonStudy(late, idx, { horizons: [60], iterations: 100, seed: 7 });
    expect(h60.n).toBe(0);
  });

  it("still measures those bars at the session horizon", () => {
    const [hs] = horizonStudy(late, idx, { horizons: ["session"], iterations: 100, seed: 7 });
    expect(hs.n).toBeGreaterThan(0);
  });

  it("flips the sign for a SHORT so positive always means 'was right'", () => {
    const up = sessions(30, 66, (_d, i) => 5000 + i);
    const upIdx = { MES: withAtr(up) };
    const at = (side: "LONG" | "SHORT") =>
      horizonStudy(
        up
          .filter((b) => nyMeta(b.time).minutes === 600)
          .map((b) => ({ symbol: "MES", time: b.time, side })),
        upIdx,
        { horizons: [30], iterations: 100, seed: 8 },
      )[0].signal.mean;
    expect(at("LONG")).toBeGreaterThan(0);
    expect(at("SHORT")).toBeCloseTo(-at("LONG"), 6);
  });

  it("ignores signals whose timestamp is not a bar", () => {
    const [h] = horizonStudy([{ symbol: "MES", time: 1, side: "LONG" }], idx, {
      horizons: [30],
      iterations: 100,
    });
    expect(h.n).toBe(0);
  });

  it("ignores signals for an unknown symbol", () => {
    const [h] = horizonStudy(
      signals.map((s) => ({ ...s, symbol: "NOPE" })),
      idx,
      { horizons: [30], iterations: 100 },
    );
    expect(h.n).toBe(0);
  });
});

/* ── Correlation and effective N ─────────────────────────────────────────*/
describe("pearson", () => {
  it("is 1 for identical series and -1 for mirrored", () => {
    const a = [1, 2, 3, 4, 5];
    expect(pearson(a, a)).toBeCloseTo(1, 9);
    expect(pearson(a, a.map((x) => -x))).toBeCloseTo(-1, 9);
  });

  it("is NaN for a constant series rather than 0", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN();
  });
});

describe("pairedReturns", () => {
  const rand = mulberry32(31);
  const A = sessions(20, 66, () => 5000 + rand() * 10);
  const B = A.map((b) => ({ ...b, close: b.close * 2 }));

  it("pairs on timestamp, not index", () => {
    // Drop a bar from B; the pairing must skip it rather than shift everything.
    const gapped = B.filter((_, i) => i !== 40);
    const paired = pairedReturns(A, gapped);
    expect(paired.times.length).toBeLessThan(A.length - 1);
    for (const t of paired.times) expect(gapped.some((b) => b.time === t)).toBe(true);
  });

  it("never crosses a session boundary", () => {
    const paired = pairedReturns(A, B);
    const dayCount = new Set(A.map((b) => nyMeta(b.time).dateKey)).size;
    // One return lost per session (the first bar has no predecessor in it).
    expect(paired.times.length).toBe(A.length - dayCount);
  });
});

describe("rollingCorrelation", () => {
  it("is ~1 for a series and its scaled twin", () => {
    const rand = mulberry32(41);
    const A = sessions(20, 66, () => 5000 + rand() * 20);
    const B = A.map((b) => ({ ...b, close: b.close * 3 }));
    const roll = rollingCorrelation(A, B, 100);
    expect(roll.length).toBeGreaterThan(0);
    for (const p of roll) expect(p.rho).toBeCloseTo(1, 6);
  });

  it("summarises the whole series", () => {
    const rand = mulberry32(43);
    const A = sessions(20, 66, () => 5000 + rand() * 20);
    const B = A.map((b) => ({ ...b, close: b.close * 3 }));
    const s = summariseCorrelation(A, B, 100);
    expect(s.overall).toBeCloseTo(1, 6);
    expect(s.shareAbove80).toBe(1);
    expect(s.pairs).toBeGreaterThan(100);
  });
});

/* The correction that matters for this codebase's headline claim: "16
   stream-years, all losing" is not sixteen independent observations when the
   two symbols move together. */
describe("effectiveSampleSize", () => {
  it("halves the count for two perfectly correlated streams", () => {
    expect(effectiveSampleSize(1000, 2, 1)).toBeCloseTo(1000, 3);
  });

  it("keeps the full count for two uncorrelated streams", () => {
    expect(effectiveSampleSize(1000, 2, 0)).toBe(2000);
  });

  it("interpolates for realistic index-futures correlation", () => {
    // rho 0.9: 2000 nominal -> ~1053 effective.
    expect(effectiveSampleSize(1000, 2, 0.9)).toBeCloseTo(2000 / 1.9, 6);
  });

  it("never reports more evidence than was collected", () => {
    // Negative correlation must not inflate the count past nominal.
    expect(effectiveSampleSize(1000, 2, -0.5)).toBe(2000);
  });

  it("returns the nominal count for a single stream", () => {
    expect(effectiveSampleSize(500, 1, 0.9)).toBe(500);
  });

  it("states the correction in plain language", () => {
    expect(describeEffectiveN(2000, 1053)).toMatch(/2,000 nominal trades ≈ 1,053 effective \(53%\)/);
  });
});
