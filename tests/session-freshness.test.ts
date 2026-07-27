import { describe, expect, it } from "vitest";
import { STALE_MARKER, dataDelayed, inEntryWindow } from "@/lib/time/session";

/* The amber "data delayed more than usual" state.

   "Delayed" means the feed is lagging WHILE WE ARE TRADING, so the whole
   predicate is gated on the 02:00–15:25 ET Mon–Fri entry window before
   anything else is considered. Inside the window the engine's own marker wins;
   otherwise a last-successful-run older than 40 minutes counts.

   The regression this file exists to prevent: the window guard used to sit
   BELOW a `message.includes("stale")` short-circuit, and the engine's heartbeat
   carries the bar-age gate's verdict note, which opens "stale data: ...". A
   Saturday run legitimately reports bars 660 minutes old, so the banner was on
   from Friday's close to Sunday's open, every single week. This file used to
   assert the opposite ("marker wins outside the window too") against a
   hand-authored fixture the engine never emits — which is exactly how the bug
   got through. The weekend fixture below is a verbatim engine_runs row. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// Wed 2026-07-22 12:00 ET (EDT, UTC-4) — deep inside the entry window.
const midSession = sec("2026-07-22T16:00:00Z");
// Wed 2026-07-22 20:00 ET — after the entry window.
const evening = sec("2026-07-23T00:00:00Z");
// Mon 2026-07-27 01:37 UTC = Sun 21:37 ET — the weekend gap the user reported.
const weekendGap = sec("2026-07-27T01:37:00Z");

/* Verbatim from engine_runs, ran_at 2026-07-25 07:55:24Z. Note the "stale
   data: ..." tail: that is the un-gated verdict note, and it is normal. */
const REAL_WEEKEND_MESSAGE =
  "bars MES 13743 / MNQ 13744, last 2026-07-24T20:55:00.000Z; " +
  "age MES 660m / MNQ 660m; " +
  "stale data: freshest bar 660m old (limit 30m) — rows recorded but flagged " +
  "and excluded from stats, alerts and training";

const run = (minsAgo: number, over: Partial<{ status: string; message: string | null }> = {}) => ({
  ran_at: new Date((midSession - minsAgo * 60) * 1000).toISOString(),
  status: "ok",
  message: "bars MES 16000 / MNQ 16000; age MES 12m / MNQ 12m",
  ...over,
});

describe("inEntryWindow", () => {
  it("is true mid-session and false in the evening and on weekends", () => {
    expect(inEntryWindow(midSession)).toBe(true);
    expect(inEntryWindow(evening)).toBe(false);
    expect(inEntryWindow(sec("2026-07-25T16:00:00Z"))).toBe(false); // Saturday
  });
});

describe("dataDelayed", () => {
  it("is false with a fresh ok run and no stale marker", () => {
    expect(dataDelayed([run(10)], midSession)).toBe(false);
  });

  it("is true when the engine flagged stale bars inside the window", () => {
    const stale = run(5, { message: `bars …; age MES 45m / MNQ 45m ${STALE_MARKER}` });
    expect(dataDelayed([stale], midSession)).toBe(true);
  });

  it("is false outside the window even with the marker — nothing to be late for", () => {
    const stale = run(5, { message: `bars …; age MES 45m / MNQ 45m ${STALE_MARKER}` });
    expect(dataDelayed([stale], evening)).toBe(false);
  });

  it("does NOT fire on the weekend heartbeat the engine really writes", () => {
    const saturdayRun = {
      ran_at: "2026-07-25T07:55:24.515Z",
      status: "ok",
      message: REAL_WEEKEND_MESSAGE,
    };
    // The reported symptom: Home read "Data delayed more than usual" all
    // weekend because this message contains the bare word "stale".
    expect(saturdayRun.message).toContain("stale");
    expect(saturdayRun.message).not.toContain(STALE_MARKER);
    expect(dataDelayed([saturdayRun], weekendGap)).toBe(false);
    expect(dataDelayed([saturdayRun], sec("2026-07-25T16:00:00Z"))).toBe(false); // Saturday
  });

  it("is true when the last ok run is older than 40 min inside the window", () => {
    expect(dataDelayed([run(45)], midSession)).toBe(true);
    expect(dataDelayed([run(45)], evening)).toBe(false); // overnight gaps are normal
  });

  it("is true inside the window when every loaded run failed", () => {
    expect(dataDelayed([run(5, { status: "error", message: "boom" })], midSession)).toBe(true);
  });

  it("is false while nothing has loaded yet", () => {
    expect(dataDelayed([], midSession)).toBe(false);
  });
});
