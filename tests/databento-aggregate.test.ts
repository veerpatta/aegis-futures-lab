import { describe, expect, it } from "vitest";
import {
  CHUNK_TAIL_SEC,
  DATABENTO_SUNDAY_GAP,
  DBN_PX_SCALE,
  aggregate1mTo5m,
  assertAligned,
  assertPlausible,
  bars5mFromOhlcv1mCsv,
  isUtcSunday,
  monthBoundaries,
  parseOhlcv1mCsv,
  parseTsEvent,
} from "../lib/data/databento";
import { shapeCompleted5mBars } from "../lib/data/yahoo";
import type { Bar } from "../lib/types";

/* The Databento adapter, validated end to end with no network and no credit
   spent. If the aggregation is wrong, paying for the backfill produces a
   corrupt archive — so everything checkable for free is checked first. */

/** A 1-minute bar at a given epoch second. */
const m = (time: number, o: number, h: number, l: number, c: number, v = 10): Bar => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

/* 2026-06-01T14:00:00Z = 1780322400, which is 5m-aligned. */
const T0 = 1780322400;
expect(T0 % 300).toBe(0);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

describe("parseTsEvent", () => {
  it("converts nanoseconds to unix seconds", () => {
    expect(parseTsEvent("1780322400000000000")).toBe(T0);
  });

  it("accepts an ISO timestamp (pretty_ts=true)", () => {
    expect(parseTsEvent("2026-06-01T14:00:00.000Z")).toBe(T0);
  });

  it("throws rather than silently yielding NaN", () => {
    // A NaN here would be filtered out later as "not finite" and the bar
    // would vanish without anything reporting a parse failure.
    expect(() => parseTsEvent("not-a-time")).toThrow(/Unparseable/);
  });
});

describe("parseOhlcv1mCsv", () => {
  const csv = [
    "ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol",
    `${T0}000000000,34,1,42,7369750000000,7371000000000,7369000000000,7370250000000,180,MES.c.0`,
    `${T0 + 60}000000000,34,1,42,7370250000000,7372500000000,7370000000000,7372000000000,205,MES.c.0`,
  ].join("\n");

  it("finds columns by name, not by position", () => {
    const bars = parseOhlcv1mCsv(csv, { rawPrices: true });
    expect(bars).toHaveLength(2);
    expect(bars[0].time).toBe(T0);
    expect(bars[0].open).toBeCloseTo(7369.75, 6);
    expect(bars[0].close).toBeCloseTo(7370.25, 6);
    expect(bars[0].volume).toBe(180);
  });

  it("leaves prices alone when the request already prettified them", () => {
    const pretty = [
      "ts_event,open,high,low,close,volume",
      `${T0}000000000,7369.75,7371.00,7369.00,7370.25,180`,
    ].join("\n");
    expect(parseOhlcv1mCsv(pretty, { rawPrices: false })[0].open).toBeCloseTo(7369.75, 6);
  });

  it("names the missing column when the schema is not what we expect", () => {
    expect(() => parseOhlcv1mCsv("ts_event,open,high\n1,2,3", { rawPrices: false })).toThrow(
      /missing the "low" column/
    );
  });

  /* Number("") is 0, not NaN. A blank price cell therefore parses as a price
     of ZERO, passes every Number.isFinite check, and reaches the aggregate
     where Math.min sets the bucket's low to 0 — a corrupted range with nothing
     reporting a problem. This test caught exactly that. */
  it("drops a row with a BLANK price rather than reading it as zero", () => {
    const withBad = [
      "ts_event,open,high,low,close,volume",
      `${T0}000000000,7369.75,7371.00,7369.00,7370.25,180`,
      `${T0 + 60}000000000,7370.25,,7370.00,7372.00,205`,
    ].join("\n");
    const bars = parseOhlcv1mCsv(withBad, { rawPrices: false });
    expect(bars).toHaveLength(1);
    expect(bars.some((b) => b.high === 0 || b.low === 0)).toBe(false);
  });

  it("a blank price can never reach the aggregate and drag a low to zero", () => {
    const csv = [
      "ts_event,open,high,low,close,volume",
      `${T0}000000000,7369.75,7371.00,7369.00,7370.25,180`,
      `${T0 + 60}000000000,7370.25,,7370.00,7372.00,205`,
      `${T0 + 300}000000000,7372.00,7373.00,7371.00,7372.50,150`,
    ].join("\n");
    const agg = aggregate1mTo5m(parseOhlcv1mCsv(csv, { rawPrices: false }));
    expect(agg).toHaveLength(1);
    expect(agg[0].low).toBeCloseTo(7369.0, 6);
  });

  it("drops a row whose range is inverted", () => {
    const inverted = [
      "ts_event,open,high,low,close,volume",
      `${T0}000000000,7369.75,7360.00,7371.00,7370.25,180`,
    ].join("\n");
    expect(parseOhlcv1mCsv(inverted, { rawPrices: false })).toEqual([]);
  });

  it("still treats a missing volume as zero, which is legitimate", () => {
    const noVol = [
      "ts_event,open,high,low,close,volume",
      `${T0}000000000,7369.75,7371.00,7369.00,7370.25,`,
    ].join("\n");
    expect(parseOhlcv1mCsv(noVol, { rawPrices: false })[0].volume).toBe(0);
  });

  it("returns nothing for a header-only response", () => {
    expect(parseOhlcv1mCsv("ts_event,open,high,low,close,volume", { rawPrices: false })).toEqual([]);
  });
});

describe("assertPlausible — the scaling guard", () => {
  it("rejects prices that came through unscaled", () => {
    const raw = [m(T0, 7369.75e9, 7371e9, 7369e9, 7370.25e9)];
    expect(() => assertPlausible(raw, "MES")).toThrow(/fixed-point scaling/);
  });

  it("rejects prices that were scaled twice", () => {
    const twice = [m(T0, 7369.75 / DBN_PX_SCALE, 7371 / DBN_PX_SCALE, 7369 / DBN_PX_SCALE, 7370 / DBN_PX_SCALE)];
    expect(() => assertPlausible(twice, "MES")).toThrow(/fixed-point scaling/);
  });

  it("accepts both contracts at realistic levels", () => {
    expect(() => assertPlausible([m(T0, 7369.75, 7371, 7369, 7370.25)], "MES")).not.toThrow();
    expect(() => assertPlausible([m(T0, 27460.75, 27500, 27440, 27480)], "MNQ")).not.toThrow();
  });

  it("says nothing about an empty series", () => {
    expect(() => assertPlausible([], "MES")).not.toThrow();
  });
});

describe("aggregate1mTo5m", () => {
  /* Two full 5m buckets plus one minute of a third. The third proves the
     second closed, and is itself dropped as still-forming. */
  const oneMin: Bar[] = [
    m(T0 + 0, 100, 105, 99, 104),
    m(T0 + 60, 104, 110, 103, 108),
    m(T0 + 120, 108, 109, 101, 102),
    m(T0 + 180, 102, 106, 100, 105),
    m(T0 + 240, 105, 107, 104, 106),
    m(T0 + 300, 106, 112, 106, 111),
    m(T0 + 360, 111, 115, 95, 96),
    m(T0 + 420, 96, 98, 94, 97),
    m(T0 + 480, 97, 101, 97, 100),
    m(T0 + 540, 100, 103, 99, 102),
    m(T0 + 600, 102, 104, 101, 103), // opens the third bucket
  ];

  const out = aggregate1mTo5m(oneMin);

  it("emits only the buckets the pull proves are closed", () => {
    expect(out.map((b) => b.time)).toEqual([T0, T0 + 300]);
  });

  it("folds OHLCV correctly", () => {
    expect(out[0]).toMatchObject({
      time: T0,
      open: 100, // first minute's open
      high: 110, // max across the five
      low: 99, // min across the five
      close: 106, // last minute's close
      volume: 50, // 5 × 10
    });
    expect(out[1]).toMatchObject({ time: T0 + 300, open: 106, high: 115, low: 94, close: 102 });
  });

  it("is immune to input order", () => {
    const shuffled = [...oneMin].reverse();
    expect(aggregate1mTo5m(shuffled)).toEqual(out);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(oneMin);
    aggregate1mTo5m(oneMin);
    expect(JSON.stringify(oneMin)).toBe(before);
  });

  it("keeps a thin bucket that holds fewer than five minutes", () => {
    /* CME OHLCV omits minutes with no trades, so a quiet overnight window
       legitimately has one or two. Dropping those would delete exactly the
       overnight structure zone-v5 builds its Daily/4H frames from. */
    const thin = [m(T0 + 60, 100, 101, 99, 100), m(T0 + 300, 100, 100, 100, 100)];
    const agg = aggregate1mTo5m(thin);
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ time: T0, open: 100, high: 101, low: 99, close: 100 });
  });

  it("treats the bar after a long gap as proof the pre-gap bucket closed", () => {
    const acrossGap = [
      m(T0, 100, 101, 99, 100),
      m(T0 + 86_400, 200, 201, 199, 200), // next session
      m(T0 + 86_700, 200, 200, 200, 200),
    ];
    expect(aggregate1mTo5m(acrossGap).map((b) => b.time)).toEqual([T0, T0 + 86_400]);
  });

  it("emits nothing when no bucket can be proven closed", () => {
    expect(aggregate1mTo5m([m(T0, 100, 101, 99, 100)])).toEqual([]);
    expect(aggregate1mTo5m([])).toEqual([]);
  });
});

/* ── The contract parity depends on ───────────────────────────────────────
   Rule: bar shaping is frozen, and new feeds adapt to it. shapeCompleted5mBars
   keeps three rules — 5m-aligned, completed only, finite OHLC. The first and
   third are asserted directly here; "completed" is data-relative for a
   backfill (see the module header), so it is asserted as "the trailing
   forming bucket is absent" above.

   The direct check that this output would survive the frozen shaper: feed the
   aggregate through shapeCompleted5mBars itself and require it to pass every
   bar. Timestamps are far enough in the past that its Date.now() cutoff is
   not what does the work — the alignment and finiteness rules are. */
describe("output satisfies the frozen bar-shaping contract", () => {
  const agg = aggregate1mTo5m([
    m(T0, 100, 105, 99, 104),
    m(T0 + 60, 104, 110, 103, 108),
    m(T0 + 300, 108, 112, 107, 111),
    m(T0 + 600, 111, 113, 110, 112),
  ]);

  it("every bar is 5-minute aligned", () => {
    expect(agg.length).toBeGreaterThan(0);
    for (const b of agg) expect(b.time % 300).toBe(0);
  });

  it("every OHLC value is finite", () => {
    for (const b of agg)
      for (const px of [b.open, b.high, b.low, b.close]) expect(Number.isFinite(px)).toBe(true);
  });

  it("high and low actually bound open and close", () => {
    for (const b of agg) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
  });

  it("survives shapeCompleted5mBars unchanged", () => {
    const shaped = shapeCompleted5mBars(
      {
        meta: {},
        timestamp: agg.map((b) => b.time),
        indicators: {
          quote: [
            {
              open: agg.map((b) => b.open),
              high: agg.map((b) => b.high),
              low: agg.map((b) => b.low),
              close: agg.map((b) => b.close),
              volume: agg.map((b) => b.volume ?? 0),
            },
          ],
        },
      },
      "MES"
    );
    expect(shaped.map((b) => b.time)).toEqual(agg.map((b) => b.time));
  });
});

describe("bars5mFromOhlcv1mCsv", () => {
  it("parses, aggregates and guards in one call", () => {
    const rows = [0, 60, 120, 180, 240, 300].map(
      (off) =>
        `${T0 + off}000000000,7369750000000,7371000000000,7369000000000,7370250000000,180`
    );
    const csv = ["ts_event,open,high,low,close,volume", ...rows].join("\n");
    const bars = bars5mFromOhlcv1mCsv(csv, { rawPrices: true }, "MES.c.0");
    expect(bars).toHaveLength(1);
    expect(bars[0].time).toBe(T0);
    expect(bars[0].open).toBeCloseTo(7369.75, 6);
    expect(bars[0].volume).toBe(5 * 180);
  });

  it("refuses a response whose prices were not prettified as assumed", () => {
    const csv = [
      "ts_event,open,high,low,close,volume",
      `${T0}000000000,7369.75,7371.00,7369.00,7370.25,180`,
      `${T0 + 300}000000000,7370.25,7372.50,7370.00,7372.00,205`,
    ].join("\n");
    // Claiming rawPrices on already-decimal data divides by 1e9.
    expect(() => bars5mFromOhlcv1mCsv(csv, { rawPrices: true }, "MES.c.0")).toThrow(
      /implausible price/
    );
  });
});

/* ── Chunk seams ──────────────────────────────────────────────────────────
   The failure this guards against is quiet: cut a request at a month boundary
   and the month's last 5m bucket has no later minute in the response, so it is
   dropped. Over the seven-year backfill that is ~87 missing bars, one per
   seam, with nothing reporting them. */
describe("monthBoundaries", () => {
  const chunks = monthBoundaries("2026-05-06", "2026-08-01");

  it("splits on first-of-month and covers the range contiguously", () => {
    expect(chunks.map((c) => isoDay(c.from))).toEqual([
      "2026-05-06",
      "2026-06-01",
      "2026-07-01",
    ]);
    // Every chunk's end is the next chunk's start — no gap, no overlap.
    for (let i = 1; i < chunks.length; i++)
      expect(chunks[i].from.getTime()).toBe(chunks[i - 1].to.getTime());
    expect(chunks[chunks.length - 1].to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("produces 5m-aligned boundaries, which assertAligned proves", () => {
    expect(() => assertAligned(chunks)).not.toThrow();
    for (const c of chunks) {
      expect((c.from.getTime() / 1000) % 300).toBe(0);
      expect((c.to.getTime() / 1000) % 300).toBe(0);
    }
  });

  it("assertAligned actually rejects an unaligned boundary", () => {
    const bad = [{ from: new Date("2026-05-06T00:02:00Z"), to: new Date("2026-06-01T00:00:00Z") }];
    expect(() => assertAligned(bad)).toThrow(/not 5m-aligned/);
  });

  it("spans the whole max window without losing a month", () => {
    const all = monthBoundaries("2019-05-06", "2026-07-30");
    expect(all.length).toBe(87); // 2019-05 .. 2026-07 inclusive
    expect(isoDay(all[0].from)).toBe("2019-05-06");
    expect(all[all.length - 1].to.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });
});

describe("chunked aggregation loses nothing at a seam", () => {
  /* One minute bar every minute across a boundary, so every 5m bucket is
     fully populated and any dropped bucket is unmistakable. */
  const BOUNDARY = Date.UTC(2026, 5, 1, 0, 0, 0) / 1000; // 2026-06-01T00:00:00Z
  const oneMin: Bar[] = [];
  for (let t = BOUNDARY - 3600; t < BOUNDARY + 3600; t += 60)
    oneMin.push(m(t, 100, 101, 99, 100));

  /** Exactly what run() does: request past `to`, then discard the overlap. */
  const chunkOf = (from: number, to: number): Bar[] =>
    aggregate1mTo5m(
      oneMin.filter((b) => b.time >= from && b.time < to + CHUNK_TAIL_SEC)
    ).filter((b) => b.time < to);

  it("reassembles into exactly the whole-range aggregate", () => {
    const whole = aggregate1mTo5m(oneMin);
    const pieced = [
      ...chunkOf(BOUNDARY - 3600, BOUNDARY),
      ...chunkOf(BOUNDARY, BOUNDARY + 3600),
    ];
    // The final bucket has no later minute in either view, so neither emits
    // it — that is the completeness rule doing its job, not a seam defect.
    expect(pieced).toEqual(whole);
  });

  it("keeps the bucket immediately before the seam", () => {
    const pre = chunkOf(BOUNDARY - 3600, BOUNDARY);
    expect(pre.map((b) => b.time)).toContain(BOUNDARY - 300);
  });

  it("would lose that bucket without the tail — the bug this prevents", () => {
    const noTail = aggregate1mTo5m(
      oneMin.filter((b) => b.time >= BOUNDARY - 3600 && b.time < BOUNDARY)
    );
    expect(noTail.map((b) => b.time)).not.toContain(BOUNDARY - 300);
  });

  it("emits the seam bucket exactly once across the two chunks", () => {
    const times = [
      ...chunkOf(BOUNDARY - 3600, BOUNDARY),
      ...chunkOf(BOUNDARY, BOUNDARY + 3600),
    ].map((b) => b.time);
    expect(new Set(times).size).toBe(times.length);
  });
});

describe("the known Sunday continuous-contract gap", () => {
  it("is identified by a shared constant, never a retyped string", () => {
    expect(DATABENTO_SUNDAY_GAP).toBe("databento-sunday-continuous-gap");
  });

  it("recognises Sunday in UTC and nothing else", () => {
    // 2026-05-17 was a Sunday — the date the upstream issue starts.
    expect(isUtcSunday(Date.parse("2026-05-17T12:00:00Z") / 1000)).toBe(true);
    expect(isUtcSunday(Date.parse("2026-05-18T12:00:00Z") / 1000)).toBe(false);
    expect(isUtcSunday(Date.parse("2026-05-16T23:59:59Z") / 1000)).toBe(false);
  });

  it("is narrow enough that a Monday outage cannot hide behind it", () => {
    // The Globex reopen the engine covers is Sunday 22:00/23:00 UTC.
    expect(isUtcSunday(Date.parse("2026-05-17T22:15:00Z") / 1000)).toBe(true);
    // Ten minutes later it is Monday, and a gap there is a real problem.
    expect(isUtcSunday(Date.parse("2026-05-18T00:10:00Z") / 1000)).toBe(false);
  });
});
