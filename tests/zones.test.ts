import { describe, expect, it } from "vitest";
import {
  clockIn,
  dateTimeIn,
  dayIn,
  dayKeyLabel,
  etTimeLabel,
  etWallIn,
  etWindowLabel,
  stampIn,
  zoneGapNote,
} from "@/lib/time/zones";

/* The ET↔IST gap is 9h30m under US daylight time and 10h30m under standard
   time, because India never changes its clocks. Every case below is pinned to
   both halves of the year — a hardcoded offset anywhere would fail one of them. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// 12:00 ET on a summer day and a winter day, used as DST reference points.
const SUMMER = sec("2026-07-21T16:00:00Z");
const WINTER = sec("2026-12-15T17:00:00Z");

describe("clockIn", () => {
  it("renders an instant on both clocks in summer (EDT, +9h30m)", () => {
    const t = sec("2026-07-21T17:20:00Z");
    expect(clockIn(t, "ET")).toBe("13:20");
    expect(clockIn(t, "IST")).toBe("22:50");
  });

  it("renders an instant on both clocks in winter (EST, +10h30m)", () => {
    const t = sec("2026-12-15T20:25:00Z");
    expect(clockIn(t, "ET")).toBe("15:25");
    expect(clockIn(t, "IST")).toBe("01:55"); // already the next IST day
  });

  it("renders midnight as 00:00, not 24:00", () => {
    expect(clockIn(sec("2026-07-22T04:00:00Z"), "ET")).toBe("00:00");
    expect(clockIn(sec("2026-07-21T18:30:00Z"), "IST")).toBe("00:00");
  });
});

describe("etWallIn — fixed session boundaries", () => {
  it("moves the flat-by time with US daylight saving", () => {
    expect(etWallIn("15:25", "IST", SUMMER)).toBe("00:55");
    expect(etWallIn("15:25", "IST", WINTER)).toBe("01:55");
  });

  it("moves the entry-window open too", () => {
    expect(etWallIn("02:00", "IST", SUMMER)).toBe("11:30");
    expect(etWallIn("02:00", "IST", WINTER)).toBe("12:30");
  });

  it("is a no-op for ET", () => {
    expect(etWallIn("09:30", "ET", SUMMER)).toBe("09:30");
    expect(etWallIn("09:30", "ET", WINTER)).toBe("09:30");
  });
});

describe("session labels", () => {
  it("prints both zones for a single boundary", () => {
    expect(etTimeLabel("15:25")).toMatch(/^15:25 ET \(\d{2}:\d{2} IST\)$/);
  });

  it("prints both zones for a window", () => {
    expect(etWindowLabel("02:00", "15:25")).toMatch(
      /^02:00–15:25 ET \(\d{2}:\d{2}–\d{2}:\d{2} IST\)$/
    );
  });
});

describe("dayKeyLabel", () => {
  it("names the New York trading day and never shifts zone", () => {
    expect(dayKeyLabel("2026-07-21")).toBe("Tue, Jul 21");
    expect(dayKeyLabel("2026-07-21", { weekday: false })).toBe("Jul 21");
  });
});

describe("stamps", () => {
  it("carries the zone abbreviation so a time is never ambiguous", () => {
    const t = sec("2026-07-21T17:20:00Z");
    expect(stampIn(t, "ET")).toBe("Tue, Jul 21, 13:20 ET");
    expect(stampIn(t, "IST")).toBe("Tue, Jul 21, 22:50 IST");
  });

  it("rolls the date when IST is already past midnight", () => {
    const t = sec("2026-07-21T19:25:00Z"); // 15:25 ET
    expect(dayIn(t, "ET")).toBe("Tue, Jul 21");
    expect(dayIn(t, "IST")).toBe("Wed, Jul 22");
    expect(dateTimeIn(t, "IST")).toBe("Jul 22, 00:55");
  });
});

describe("zoneGapNote", () => {
  it("reports the live gap on both sides of the DST change", () => {
    expect(zoneGapNote(SUMMER)).toBe("IST is 9h30m ahead of ET");
    expect(zoneGapNote(WINTER)).toBe("IST is 10h30m ahead of ET");
  });
});
