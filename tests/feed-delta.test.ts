import { describe, expect, it } from "vitest";
import {
  byDay,
  dropSeamSessions,
  pairOnTime,
  rollWindows,
  seamSessions,
  summarise,
  SEAM_GAP_RATIO,
} from "@/lib/data/feed-delta";
import type { Bar } from "@/lib/types";

/* The proxy-error measurement. The shape it has to capture is specific: two
   feeds that agree to under a tick almost always, and disagree by tens of
   points for a few consecutive sessions around a contract roll. A summary
   that reports only a mean hides exactly that. */

const bar = (time: number, close: number, high = close + 1, low = close - 1): Bar => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 10,
});

const dateKeyOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const DAY = 86_400;

describe("pairOnTime", () => {
  it("pairs only on identical timestamps", () => {
    const a = [bar(300, 100), bar(600, 101), bar(900, 102)];
    const b = [bar(300, 100), bar(900, 105)];
    const rows = pairOnTime(a, b);
    expect(rows.map((r) => r.time)).toEqual([300, 900]);
    expect(rows[1].closeDelta).toBe(3);
  });

  it("treats a bar one feed lacks as coverage, not price disagreement", () => {
    /* Counting an unmatched bar as a delta would report a difference that is
       really "one feed had no data", which is a different problem with a
       different fix. */
    const rows = pairOnTime([bar(300, 100), bar(600, 100)], [bar(300, 100)]);
    expect(rows).toHaveLength(1);
  });

  it("returns absolute deltas, so direction never cancels out", () => {
    const rows = pairOnTime([bar(300, 100)], [bar(300, 110)]);
    expect(rows[0].closeDelta).toBe(10);
    const flipped = pairOnTime([bar(300, 110)], [bar(300, 100)]);
    expect(flipped[0].closeDelta).toBe(10);
  });
});

describe("summarise", () => {
  it("reports coverage on both sides separately", () => {
    const s = summarise([bar(300, 100), bar(600, 100)], [bar(300, 100), bar(900, 100)]);
    expect(s.matched).toBe(1);
    expect(s.onlyInA).toBe(1);
    expect(s.onlyInB).toBe(1);
  });

  it("counts bars whose range matches exactly", () => {
    const a = [bar(300, 100, 101, 99), bar(600, 100, 105, 95)];
    const b = [bar(300, 100, 101, 99), bar(600, 100, 106, 95)];
    expect(summarise(a, b).identicalRange).toBe(1);
  });

  it("separates the median from the mean, which a roll skews", () => {
    /* Nine identical bars and one 60-point roll bar: the mean says 6, the
       median says 0. Reporting only the mean would condemn a feed that is
       exact 90% of the time. */
    const a = Array.from({ length: 10 }, (_, i) => bar(300 * (i + 1), 100));
    const b = a.map((x, i) => bar(x.time, i === 9 ? 160 : 100));
    const s = summarise(a, b);
    expect(s.meanClose).toBeCloseTo(6, 6);
    expect(s.p50Close).toBe(0);
    expect(s.maxClose).toBe(60);
  });

  it("survives an empty overlap without dividing by zero", () => {
    const s = summarise([bar(300, 100)], [bar(600, 100)]);
    expect(s.matched).toBe(0);
    expect(s.meanClose).toBeNull();
    expect(s.p95Close).toBeNull();
  });
});

describe("byDay and rollWindows", () => {
  /* Five sessions: two clean, two roll-affected, one clean. This is the real
     shape — 2026-06-15..18 on MES sat at 43–69 points while every neighbour
     was under a tick. */
  const rows = pairOnTime(
    [0, 1, 2, 3, 4].flatMap((d) => [bar(d * DAY + 300, 100), bar(d * DAY + 600, 100)]),
    [0, 1, 2, 3, 4].flatMap((d) => {
      const off = d === 2 || d === 3 ? 55 : 0.25;
      return [bar(d * DAY + 300, 100 + off), bar(d * DAY + 600, 100 + off)];
    })
  );

  const days = byDay(rows, dateKeyOf, 10);

  it("flags only the sessions where the feeds quote different contracts", () => {
    expect(days.map((d) => d.rollAffected)).toEqual([false, false, true, true, false]);
  });

  it("leaves sub-tick disagreement unflagged", () => {
    expect(days[0].meanClose).toBeCloseTo(0.25, 6);
    expect(days[0].rollAffected).toBe(false);
  });

  it("collapses consecutive flagged sessions into one seam", () => {
    const seams = rollWindows(days);
    expect(seams).toHaveLength(1);
    expect(seams[0].from).toBe(dateKeyOf(2 * DAY + 300));
    expect(seams[0].to).toBe(dateKeyOf(3 * DAY + 300));
    expect(seams[0].peak).toBeCloseTo(55, 6);
  });

  it("keeps two separate seams separate", () => {
    const split = byDay(rows, dateKeyOf, 10).map((d, i) => ({ ...d, rollAffected: i === 0 || i === 4 }));
    expect(rollWindows(split)).toHaveLength(2);
  });

  it("finds no seam when the feeds never diverge", () => {
    const clean = byDay(rows, dateKeyOf, 1000);
    expect(rollWindows(clean)).toEqual([]);
  });

  it("comes back in date order", () => {
    expect(days.map((d) => d.dateKey)).toEqual([...days.map((d) => d.dateKey)].sort());
  });
});

/* ── Intrinsic seam detection ──────────────────────────────────────────────
   The two-feed comparison above can only see the 68 sessions where Yahoo and
   Databento overlap. The seven-year Databento archive has ~29 quarterly rolls
   in it and no second feed, and each roll is a price discontinuity that a zone
   engine reads as exactly the wide-range departure candle it hunts for. These
   tests pin the one-series detector that makes those sessions excludable. */

/** A session of 5-minute bars trading in a band around `base`. */
function session(dayIndex: number, base: number, range = 10): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < 12; i++) {
    const t = dayIndex * DAY + 14 * 3600 + i * 300;
    // Walk the band so the session's high-low really is `range`.
    const mid = base + (i % 2 === 0 ? 0 : range / 2);
    out.push({ time: t, open: mid, high: base + range, low: base, close: mid, volume: 10 });
  }
  return out;
}

describe("seamSessions", () => {
  it("flags a session that opens far from the previous close", () => {
    /* Twenty quiet sessions around 100 with a 10-point range, then one that
       opens at 200 — the shape a contract roll makes in a continuous series. */
    const bars = [
      ...Array.from({ length: 20 }, (_, d) => session(d, 100)).flat(),
      ...session(20, 200),
    ];
    const gaps = seamSessions(bars, dateKeyOf);
    const flagged = gaps.filter((g) => g.seam);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].dateKey).toBe(dateKeyOf(20 * DAY + 14 * 3600));
    expect(flagged[0].ratio).toBeGreaterThan(SEAM_GAP_RATIO);
  });

  it("does not flag ordinary session-to-session drift", () => {
    // Each session opens a couple of points from the last close — normal.
    const bars = Array.from({ length: 20 }, (_, d) => session(d, 100 + d * 2)).flat();
    expect(seamSessions(bars, dateKeyOf).filter((g) => g.seam)).toEqual([]);
  });

  it("scales with the market, so one threshold serves MES and MNQ", () => {
    /* The same 100-point gap is a seam in a 10-point-range market and noise in
       a 400-point one. A fixed points threshold could not express that, which
       is the whole reason the detector is a ratio. */
    const quiet = [...Array.from({ length: 20 }, (_, d) => session(d, 100, 10)).flat(), ...session(20, 200, 10)];
    const wild = [...Array.from({ length: 20 }, (_, d) => session(d, 100, 400)).flat(), ...session(20, 200, 400)];
    expect(seamSessions(quiet, dateKeyOf).some((g) => g.seam)).toBe(true);
    expect(seamSessions(wild, dateKeyOf).some((g) => g.seam)).toBe(false);
  });

  it("never flags the first session, which has no predecessor to gap from", () => {
    const bars = Array.from({ length: 5 }, (_, d) => session(d, 100)).flat();
    const gaps = seamSessions(bars, dateKeyOf);
    expect(gaps.map((g) => g.dateKey)).not.toContain(dateKeyOf(14 * 3600));
  });

  it("does not divide by zero on a flat reference window", () => {
    /* A zero-range window would make every ratio Infinity and flag the
       quietest stretch in the series as the noisiest. */
    const flat: Bar[] = Array.from({ length: 5 }, (_, d) =>
      Array.from({ length: 3 }, (_, i) => ({
        time: d * DAY + 14 * 3600 + i * 300,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      }))
    ).flat();
    const gaps = seamSessions(flat, dateKeyOf);
    expect(gaps.every((g) => Number.isFinite(g.ratio))).toBe(true);
    expect(gaps.some((g) => g.seam)).toBe(false);
  });
});

describe("dropSeamSessions", () => {
  const bars = [
    ...Array.from({ length: 20 }, (_, d) => session(d, 100)).flat(),
    ...session(20, 200),
    ...session(21, 200),
    ...session(22, 200),
  ];

  it("drops the seam session and the one after it", () => {
    /* The pad exists because a stitched price does not stop mattering at
       midnight — zones formed across the seam stay live for days. */
    const { bars: kept, dropped } = dropSeamSessions(bars, dateKeyOf);
    expect(dropped).toEqual([
      dateKeyOf(20 * DAY + 14 * 3600),
      dateKeyOf(21 * DAY + 14 * 3600),
    ]);
    expect(kept.length).toBe(bars.length - 24);
  });

  it("keeps everything when pad is 0 except the seam day itself", () => {
    expect(dropSeamSessions(bars, dateKeyOf, SEAM_GAP_RATIO, 0).dropped).toHaveLength(1);
  });

  it("is a no-op on a series with no seam", () => {
    const clean = Array.from({ length: 20 }, (_, d) => session(d, 100)).flat();
    const { bars: kept, dropped } = dropSeamSessions(clean, dateKeyOf);
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(clean.length);
  });
});
