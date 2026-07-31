import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { nyTimeToUnix } from "@/lib/time/ny";
import {
  ARCHIVE_DAY_ALIGN,
  alignArchiveSlice,
  dropPartialLeadingSession,
} from "@/lib/data/window";

/* Five-minute bars across a NY date, from `fromMin` (inclusive) to `toMin`
   (exclusive), minutes since NY midnight. Range is fixed so a truncated day is
   identifiable by bar COUNT, which is what the trim is protecting. */
function day(dateKey: string, fromMin: number, toMin: number): Bar[] {
  const out: Bar[] = [];
  for (let m = fromMin; m < toMin; m += 5) {
    const time = nyTimeToUnix(dateKey, m);
    out.push({ time, open: 100, high: 101, low: 99, close: 100, volume: 1 });
  }
  return out;
}

const RTH_OPEN = 570; // 09:30
const RTH_CLOSE = 930; // 15:30
const uniqueTimes = (bars: Bar[]) => new Set(bars.map((b) => b.time)).size;

describe("dropPartialLeadingSession", () => {
  it("drops a leading date whose session was cut into", () => {
    // 2026-06-24 sliced from 13:10 ET — a truncated 27-bar session.
    const bars = [
      ...day("2026-06-24", 790, RTH_CLOSE),
      ...day("2026-06-25", RTH_OPEN, RTH_CLOSE),
    ];
    const out = dropPartialLeadingSession(bars);
    expect(out.length).toBe(72); // exactly one whole session left
    expect(out.every((b) => b.time >= bars[bars.length - 72].time)).toBe(true);
  });

  it("keeps a leading date whose session is whole", () => {
    // Slice starts 02:20 ET — pre-open, so 06-25's session is intact.
    const bars = [
      ...day("2026-06-25", 140, RTH_CLOSE),
      ...day("2026-06-26", RTH_OPEN, RTH_CLOSE),
    ];
    expect(dropPartialLeadingSession(bars)).toEqual(bars);
  });

  it("keeps a leading date that has no session bars at all", () => {
    // Overnight-only leading date: the first RTH bar belongs to the NEXT date,
    // which is whole, so there is nothing to protect.
    const bars = [
      ...day("2026-06-24", 1200, 1440), // 20:00–24:00 ET, outside the session
      ...day("2026-06-25", RTH_OPEN, RTH_CLOSE),
    ];
    expect(dropPartialLeadingSession(bars)).toEqual(bars);
  });

  it("is a no-op on an empty series and on a single whole session", () => {
    expect(dropPartialLeadingSession([])).toEqual([]);
    const whole = day("2026-06-25", RTH_OPEN, RTH_CLOSE);
    expect(dropPartialLeadingSession(whole)).toEqual(whole);
  });

  it("never drops more than the leading date", () => {
    const bars = [
      ...day("2026-06-24", 790, RTH_CLOSE),
      ...day("2026-06-25", RTH_OPEN, RTH_CLOSE),
      ...day("2026-06-26", RTH_OPEN, RTH_CLOSE),
    ];
    const out = dropPartialLeadingSession(bars);
    expect(out.length).toBe(144);
    expect(uniqueTimes(out)).toBe(144);
  });

  /* The property the widened Globex cron leans on. The engine now runs at every
     hour, so `nowSec - Nd` lands in the overnight as often as it lands
     mid-session, and the funnel/tuning numbers must not depend on which. What
     matters is only that every RTH session left in the slice is WHOLE — that is
     what zone-v5's rolling range mean is seeded from (structureHours defaults to
     "rth", so overnight bars never form a daily bar).

     Note the precondition is not new: overnight bars are already in the archive
     regardless of run time, because Yahoo returns the full Globex session
     whenever it is asked. */
  it("leaves only whole RTH sessions, wherever the slice starts", () => {
    const overnightAndSessions = (leadFromMin: number) => [
      ...day("2026-06-24", leadFromMin, 1440), // lead-in, then into the evening
      ...day("2026-06-25", 0, 1440), // a full 24h Globex day
      ...day("2026-06-26", 0, RTH_CLOSE),
    ];
    for (const startMin of [180, 600, 790, 1140, 1320]) {
      const out = dropPartialLeadingSession(overnightAndSessions(startMin));
      const rthPerDay = new Map<string, number>();
      for (const dateKey of ["2026-06-24", "2026-06-25", "2026-06-26"]) {
        const open = nyTimeToUnix(dateKey, RTH_OPEN);
        const close = nyTimeToUnix(dateKey, RTH_CLOSE);
        const n = out.filter((b) => b.time >= open && b.time < close).length;
        if (n > 0) rthPerDay.set(dateKey, n);
      }
      for (const [dateKey, n] of rthPerDay)
        expect(n, `${dateKey} is a partial session for a slice starting ${startMin}m`).toBe(72);
    }
  });
});

describe("alignArchiveSlice", () => {
  it("follows the ARCHIVE_DAY_ALIGN switch", () => {
    const bars = [
      ...day("2026-06-24", 790, RTH_CLOSE),
      ...day("2026-06-25", RTH_OPEN, RTH_CLOSE),
    ];
    const out = alignArchiveSlice(bars);
    // One assertion that holds for whichever way the default is set, so this
    // test does not have to be edited when the default is flipped.
    expect(out).toEqual(ARCHIVE_DAY_ALIGN ? dropPartialLeadingSession(bars) : bars);
    // 28 truncated-day bars (13:10–15:30) + one whole 72-bar session.
    expect(out.length).toBe(ARCHIVE_DAY_ALIGN ? 72 : 100);
  });
});

/* Structural guard for the gap this round actually left: the P1 fix wired
   alignArchiveSlice into gate-costs.ts, report.ts and run-live.ts but MISSED
   tune-core.ts, which has its own archive read feeding the monthly tune and the
   weekly challenger. It happened to be harmless — the archive starts 00:05 ET,
   so the leading RTH session is whole (72 of 72 bars) — i.e. that path was
   lucky, not correct. A backfill or a retention change that starts the archive
   mid-session would have silently corrupted both jobs.

   Any module that reads bars_5m must run the result through the trim. Asserted
   at the source level because there is no type that can enforce it.

   A reader now counts as a reader two ways: it may query bars_5m itself, or it
   may delegate the paging to lib/data/archive.ts's fetchArchiveBars. Both are
   discovered, because a module that gets archive bars has the same obligation
   however it got them — and a guard that only knew about the direct form would
   have quietly stopped covering the readers that moved to the helper. */
describe("every bars_5m reader applies the whole-session trim", () => {
  /* Readers that aggregate bars into a MULTI-DAY frame — Daily/4H candles, and
     therefore candleMeta's rolling normalizer. A truncated leading day
     mis-scales these across the whole window, so they must trim. */
  const MUST_ALIGN = [
    "scripts/diag/archive-lib.ts", // the weekly-research trio's shared read
    "scripts/diag/tier-a-baseline.ts", // the tier-A band's own measurement
    "scripts/diag/tier-b-baseline.ts", // the tier-B out-of-sample measurement
    "scripts/diag/random-entry.ts", // Phase 1: gross/net, excursion, random-entry null
    "scripts/diag/phase4.ts", // Phase 4: hypothesis trials + overnight decomposition
    "scripts/engine/gate-costs.ts", // the stored skip funnel
    "scripts/engine/report.ts", // the tuning report
    "scripts/engine/run-live.ts", // the Yahoo-down fallback (reaches live signals)
    "scripts/engine/tune-core.ts", // monthly tune + weekly challenger
  ];

  /* Readers that only ever look at bars individually or pairwise. They build no
     multi-day frame, so there is no normalizer to poison and the trim would only
     throw away data they legitimately want. Exempt WITH the reason, so a future
     reader has to justify itself rather than default into either list. */
  const EXEMPT: Record<string, string> = {
    "app/api/archive/route.ts":
      "serves a caller-bounded time range straight to the chart; the browser draws the bars it " +
      "asked for and builds no Daily/4H frame, and trimming here would drop a leading session " +
      "the user explicitly requested",
    "components/data/DataClient.tsx":
      "counts rows and reads the oldest timestamp for the archive card; it never loads a bar " +
      "series at all, so there is no frame to align",
    "lib/data/archive.ts":
      "the shared paging transport, not an analysis reader — it returns exactly the rows the " +
      "query names and deliberately does NOT trim, because whether the trim applies depends on " +
      "what the caller builds (tune-core.ts aligns the UNION of archive and live bars, not the " +
      "archive read alone). Folding it in here would take that decision away from the callers " +
      "this guard exists to hold accountable",
    "scripts/diag/atr-ratio.ts":
      "measures ATR bar by bar to compare MES and MNQ volatility; no multi-day frame",
    "scripts/diag/feed-delta.ts":
      "pairs the two feeds' bars on identical timestamps to measure the roll seam; pairwise " +
      "only, and trimming one feed's leading day would break the pairing it exists to do",
    "scripts/diag/tier-a.ts":
      "the funnel/edge-isolation harness — it deliberately varies the window to measure how " +
      "sensitive the funnel is to it, which is the one thing the trim would hide",
    "scripts/engine/digest.ts":
      "integrity scan only — compares consecutive bars for gaps/dupes/zero-range; no aggregation, " +
      "and a trimmed leading day would hide real data rather than fix anything",
    "scripts/engine/backfill-fill-audit.ts":
      "walks the bars after one entry to re-judge a single fill; no multi-day frame",
    "scripts/engine/databento-backfill.ts":
      "a WRITER, not an analysis reader — its only two reads are a one-row probe for the source " +
      "column and a max(time) probe to resume, neither of which builds a bar series. It supplies " +
      "the rows the MUST_ALIGN readers later slice; the trim is their job at read time, not its " +
      "job at write time, and trimming here would silently refuse to store real history",
  };

  /** A module obtains archive bars if it queries bars_5m directly OR delegates
      the paging to lib/data/archive.ts. Both incur the same obligation. */
  const readsArchive = (src: string): boolean =>
    src.includes('from("bars_5m")') ||
    src.includes("rest/v1/bars_5m") ||
    src.includes("fetchArchiveBars");

  it.each(MUST_ALIGN)("%s reads the archive and trims it", (path) => {
    const src = readFileSync(join(process.cwd(), path), "utf8");
    expect(readsArchive(src), `${path} no longer reads the archive — update this guard`).toBe(true);
    expect(src, `${path} reads the archive without alignArchiveSlice`).toContain("alignArchiveSlice");
  });

  it("forces a NEW archive reader to be classified, not silently omitted", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
          const src = readFileSync(join(process.cwd(), rel), "utf8");
          if (readsArchive(src)) found.push(rel);
        }
      }
    };
    /* Walks the whole app now, not just scripts/engine and lib. The reader that
       escaped every version of this guard was components/data/DataClient.tsx —
       a `.tsx` file, in a directory neither walk covered. */
    ["app", "components", "lib", "scripts"].forEach(walk);
    expect(
      found.sort(),
      "a module reads the archive without appearing in MUST_ALIGN or EXEMPT — decide which, with a reason"
    ).toEqual([...MUST_ALIGN, ...Object.keys(EXEMPT)].sort());
  });

  it("keeps a stated reason for every exemption", () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(readsArchive(readFileSync(join(process.cwd(), path), "utf8")), path).toBe(true);
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});

/* Same shape of guard, one layer down. bars_5m is keyed (symbol, source, time)
   since the Databento backfill, so it holds TWO histories over the same
   timestamps. A read that forgets the source filter gets both feeds
   interleaved — two bars per timestamp, in arbitrary order. Nothing downstream
   can catch that: every bar is finite, every timestamp is 5m-aligned, and the
   series is simply doubled and self-contradictory.

   There is no type that can enforce this for a hand-written query, so it is
   enforced structurally, the same way alignArchiveSlice is above. Readers that
   go through lib/data/archive.ts get it for free instead: `source` is a
   required field on ArchiveQuery, so omitting it does not compile. That is the
   better mechanism, and the direction to move new readers in. */
describe("every direct bars_5m query pins a source", () => {
  /* Files that write the query themselves and therefore need the grep. Anything
     using fetchArchiveBars is covered by the type instead and is deliberately
     NOT here — listing it would assert a `.eq("source"` it does not contain. */
  const DIRECT_READERS = [
    "app/api/archive/route.ts",
    "components/data/DataClient.tsx",
    "lib/data/archive.ts",
    "scripts/diag/atr-ratio.ts",
    // Found by the discovery test below the first time it ran — it pins a
    // source correctly, but nothing had ever checked that it did.
    "scripts/diag/feed-delta.ts",
    "scripts/engine/backfill-fill-audit.ts",
    "scripts/engine/databento-backfill.ts",
    "scripts/engine/digest.ts",
    "scripts/engine/gate-costs.ts",
    "scripts/engine/run-live.ts",
  ];

  /* This list was hand-maintained and therefore incomplete: DataClient.tsx read
     bars_5m twice with no source filter and printed the Databento archive's
     523,327 rows on a card describing the 60-day Yahoo series. The align guard
     above already discovers its readers; this one did not, and the gap is
     exactly what it cost. Discovery now covers the UI and route trees too —
     `.tsx` included, since the reader that escaped was a component. */
  it("finds every direct bars_5m query in the repo, not just the ones listed", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
          const src = readFileSync(join(process.cwd(), rel), "utf8");
          if (src.includes('from("bars_5m")') || src.includes("rest/v1/bars_5m")) found.push(rel);
        }
      }
    };
    ["app", "components", "lib", "scripts"].forEach(walk);
    expect(
      found.sort(),
      "a module queries bars_5m directly but is not in DIRECT_READERS — add it, and make sure " +
        "it pins a source (or better, move it to fetchArchiveBars, where the type requires one)"
    ).toEqual([...DIRECT_READERS].sort());
  });

  it.each(DIRECT_READERS)("%s filters bars_5m by source", (path) => {
    const src = readFileSync(join(process.cwd(), path), "utf8");
    expect(src, `${path} no longer reads bars_5m — update this guard`).toContain('from("bars_5m")');
    expect(src, `${path} queries bars_5m without pinning a source`).toContain('.eq("source"');
  });

  it("has a filter for every bars_5m query, not just one per file", () => {
    for (const path of DIRECT_READERS) {
      const src = readFileSync(join(process.cwd(), path), "utf8");
      const queries = (src.match(/\.from\("bars_5m"\)/g) ?? []).length;
      const filters = (src.match(/\.eq\("source"/g) ?? []).length;
      // run-live's upsert names source in its row payload rather than a filter,
      // so filters may legitimately be fewer than queries — never more, and
      // never zero while queries exist.
      expect(filters, `${path}: ${queries} bars_5m queries but ${filters} source filters`)
        .toBeGreaterThan(0);
      expect(filters).toBeLessThanOrEqual(queries);
    }
  });

  it("routes the default through the shared constant, not a literal", () => {
    /* A retyped "yahoo" in a query is the drift this repo keeps getting bitten
       by. The constant is the single definition.

       ONE legitimate literal: databento-backfill.ts is the writer that CREATES
       the databento namespace, so `.eq("source", "databento")` in its resume
       probes is not a reference to somebody else's constant — it is the
       definition of what this job writes. A constant there would be indirection
       pointing back at itself. */
    const LITERAL_OK = new Set(["scripts/engine/databento-backfill.ts"]);
    for (const path of DIRECT_READERS) {
      if (LITERAL_OK.has(path)) continue;
      const src = readFileSync(join(process.cwd(), path), "utf8");
      expect(src, `${path} hardcodes a source string`).not.toMatch(/\.eq\("source",\s*"/);
    }
  });
});
