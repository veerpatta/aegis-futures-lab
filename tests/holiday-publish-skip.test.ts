import { describe, expect, it } from "vitest";
import { holidaySkipMessage, isHolidaySkip, readSourceActivity } from "@/lib/engine/activity";

describe("market-holiday engine pass", () => {
  it("keeps the exact heartbeat wording run-live.ts has always written", () => {
    expect(holidaySkipMessage("Thanksgiving Day")).toBe("holiday: Thanksgiving Day — market closed, run skipped");
  });
  it("is recognised by publish.ts, which then rests instead of failing", () => {
    const message = holidaySkipMessage("Christmas Day");
    expect(isHolidaySkip(message)).toBe(true);
    // The reason it failed before: a holiday pass carries no source activity.
    expect(readSourceActivity(message)).toBeNull();
  });
  it("does not treat an ordinary pass or an empty message as a holiday", () => {
    expect(isHolidaySkip(null)).toBe(false);
    expect(isHolidaySkip(undefined)).toBe(false);
    expect(isHolidaySkip("ok: 2 symbols activity_v1={}")).toBe(false);
  });
});
