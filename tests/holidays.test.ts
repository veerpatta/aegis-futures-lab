import { describe, expect, it } from "vitest";
import {
  earlyCloseMinuteNy,
  flattenMinuteNy,
  holidayFor,
  isMarketHoliday,
} from "@/lib/market/holidays";
import { inEntryWindow, marketPhase } from "@/lib/time/session";

/* CME holiday behavior: full holidays skip the run and show a calm closed
   state; early-close days flatten 5 minutes before the halt. Dates are the
   verified 2026/2027 CME/NYSE calendar. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("holiday table helpers", () => {
  it("classifies a full holiday, a half day, and a normal day", () => {
    expect(isMarketHoliday("2026-11-26")).toBe(true); // Thanksgiving
    expect(isMarketHoliday("2026-11-27")).toBe(false); // half day, not closed
    expect(isMarketHoliday("2026-07-22")).toBe(false); // ordinary Wednesday
    expect(holidayFor("2026-04-03")?.name).toBe("Good Friday");
    expect(holidayFor("2027-12-24")?.kind).toBe("closed"); // observed Christmas
    expect(holidayFor("2026-07-22")).toBeNull();
  });

  it("returns the early-close minute only on half days", () => {
    expect(earlyCloseMinuteNy("2026-11-27")).toBe(13 * 60); // 13:00 ET
    expect(earlyCloseMinuteNy("2026-11-26")).toBeNull(); // fully closed
    expect(earlyCloseMinuteNy("2026-07-22")).toBeNull();
  });

  it("flattens 5 minutes before an early close, else at the normal exit", () => {
    expect(flattenMinuteNy("2026-11-27", 925)).toBe(775); // 12:55 ET
    expect(flattenMinuteNy("2026-07-22", 925)).toBe(925);
    expect(flattenMinuteNy("2026-11-26", 925)).toBe(925); // closed day: table n/a
  });
});

describe("engine/UI holiday behavior at mocked dates", () => {
  it("a full holiday reads as market closed, never as delayed data", () => {
    const goodFriday = sec("2026-04-03T15:00:00Z"); // 11:00 ET, would be mid-session
    const phase = marketPhase(goodFriday);
    expect(phase.label).toBe("Market closed");
    expect(phase.detail).toContain("Good Friday");
    expect(phase.live).toBe(false);
    expect(inEntryWindow(goodFriday)).toBe(false); // dataDelayed stays quiet
  });

  it("an early-close day is open in the morning and calmly closed after the halt", () => {
    const morning = sec("2026-11-27T16:00:00Z"); // 11:00 ET, EST
    const afternoon = sec("2026-11-27T19:30:00Z"); // 14:30 ET, after 13:00 close
    expect(marketPhase(morning).label).toBe("Market open");
    expect(marketPhase(morning).detail).toContain("early close");
    expect(inEntryWindow(morning)).toBe(true);
    const after = marketPhase(afternoon);
    expect(after.label).toBe("Closed early");
    expect(after.detail).toContain("Day after Thanksgiving");
    expect(inEntryWindow(afternoon)).toBe(false);
  });

  it("a normal weekday is unaffected", () => {
    const wednesday = sec("2026-07-22T16:00:00Z"); // 12:00 ET
    expect(marketPhase(wednesday).label).toBe("Market open");
    expect(marketPhase(wednesday).detail).toContain("15:25");
    expect(inEntryWindow(wednesday)).toBe(true);
  });
});
