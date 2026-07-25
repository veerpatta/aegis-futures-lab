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
   at the source level because there is no type that can enforce it. */
describe("every bars_5m reader applies the whole-session trim", () => {
  /* Readers that aggregate bars into a MULTI-DAY frame — Daily/4H candles, and
     therefore candleMeta's rolling normalizer. A truncated leading day
     mis-scales these across the whole window, so they must trim. */
  const MUST_ALIGN = [
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
    "scripts/engine/digest.ts":
      "integrity scan only — compares consecutive bars for gaps/dupes/zero-range; no aggregation, " +
      "and a trimmed leading day would hide real data rather than fix anything",
    "scripts/engine/backfill-fill-audit.ts":
      "walks the bars after one entry to re-judge a single fill; no multi-day frame",
  };

  it.each(MUST_ALIGN)("%s reads the archive and trims it", (path) => {
    const src = readFileSync(join(process.cwd(), path), "utf8");
    expect(src, `${path} no longer reads bars_5m — update this guard`).toContain('from("bars_5m")');
    expect(src, `${path} reads bars_5m without alignArchiveSlice`).toContain("alignArchiveSlice");
  });

  it("forces a NEW bars_5m reader to be classified, not silently omitted", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|mjs)$/.test(entry.name)) {
          const src = readFileSync(join(process.cwd(), rel), "utf8");
          if (src.includes('from("bars_5m")') || src.includes("rest/v1/bars_5m")) found.push(rel);
        }
      }
    };
    ["scripts/engine", "lib"].forEach(walk);
    expect(
      found.sort(),
      "a module reads bars_5m without appearing in MUST_ALIGN or EXEMPT — decide which, with a reason"
    ).toEqual([...MUST_ALIGN, ...Object.keys(EXEMPT)].sort());
  });

  it("keeps a stated reason for every exemption", () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(readFileSync(join(process.cwd(), path), "utf8")).toContain('from("bars_5m")');
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});
