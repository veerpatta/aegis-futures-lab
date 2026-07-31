import { describe, expect, it } from "vitest";
import { byDay, pairOnTime, rollWindows, summarise } from "@/lib/data/feed-delta";
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
