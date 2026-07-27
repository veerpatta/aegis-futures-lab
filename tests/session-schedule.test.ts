import { describe, expect, it } from "vitest";
import { ago, engineScheduled, nextRunSec } from "@/lib/time/session";
// Plain-node script (no build step) — allowJs resolves it, types are inferred.
import { inCronWindow } from "../scripts/engine/watchdog.mjs";

/* The engine's own schedule, and the two places that model it.

   `engineScheduled` answers "should a run have happened?" — distinct from
   `inEntryWindow`, which answers "are we trading?". Conflating them is what
   made a normal Friday-to-Monday silence read as "the bot has not checked in
   recently" on Home, the Signals hero and the header bell. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("engineScheduled", () => {
  it("is true across the Mon-Fri 06:00-21:59 UTC cron window", () => {
    expect(engineScheduled(sec("2026-07-27T06:00:00Z"))).toBe(true); // Mon, first slot
    expect(engineScheduled(sec("2026-07-27T21:45:00Z"))).toBe(true); // Mon, last slot
    expect(engineScheduled(sec("2026-07-24T13:00:00Z"))).toBe(true); // Fri, mid-window
  });

  it("is false before and after the window on a weekday", () => {
    expect(engineScheduled(sec("2026-07-27T05:59:00Z"))).toBe(false);
    expect(engineScheduled(sec("2026-07-27T22:00:00Z"))).toBe(false);
  });

  it("is false all weekend — the gap the dashboard used to call an outage", () => {
    expect(engineScheduled(sec("2026-07-25T12:00:00Z"))).toBe(false); // Saturday
    expect(engineScheduled(sec("2026-07-26T12:00:00Z"))).toBe(false); // Sunday
    // Mon 01:37 UTC: the exact moment the user reported "last ok 41h 38m ago".
    expect(engineScheduled(sec("2026-07-27T01:37:00Z"))).toBe(false);
  });

  it("stays true on a CME holiday — GitHub cron does not know the CME calendar", () => {
    // 2026-07-03, observed Independence Day (a CME closure), 14:00 UTC.
    // The engine still fires and writes a heartbeat, so the UI must not say
    // "asleep". watchdog.mjs applies its own holiday carve-out for ALERTING.
    expect(engineScheduled(sec("2026-07-03T14:00:00Z"))).toBe(true);
  });
});

describe("watchdog.mjs keeps the same window", () => {
  it("agrees with engineScheduled at every hour of a full week", () => {
    const start = sec("2026-07-26T00:00:00Z"); // Sunday 00:00 UTC
    const disagreements: string[] = [];
    for (let h = 0; h < 24 * 7; h++) {
      const t = start + h * 3600;
      const mine = engineScheduled(t);
      const theirs = inCronWindow(new Date(t * 1000)) as boolean;
      if (mine !== theirs) disagreements.push(new Date(t * 1000).toISOString());
    }
    expect(disagreements).toEqual([]);
  });
});

describe("nextRunSec", () => {
  it("skips the weekend to Monday's first slot", () => {
    // Sunday 21:37 ET / Monday 01:37 UTC → Monday 06:00 UTC.
    expect(nextRunSec(sec("2026-07-27T01:37:00Z"))).toBe(sec("2026-07-27T06:00:00Z"));
  });

  it("lands on the next quarter hour inside the window", () => {
    expect(nextRunSec(sec("2026-07-27T13:02:00Z"))).toBe(sec("2026-07-27T13:15:00Z"));
  });
});

describe("ago", () => {
  it("rolls over to days so a weekend gap does not read as an outage", () => {
    const mins = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
    expect(ago(mins(0))).toBe("just now");
    expect(ago(mins(12))).toBe("12 min ago");
    expect(ago(mins(184))).toBe("3h 4m ago");
    expect(ago(mins(1439))).toBe("23h 59m ago");
    expect(ago(mins(1440))).toBe("1d 0h ago");
    // The reported readout: 41h 38m is 1d 17h.
    expect(ago(mins(2498))).toBe("1d 17h ago");
  });
});
