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
