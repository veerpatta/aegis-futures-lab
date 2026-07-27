import { describe, expect, it } from "vitest";
import { ago, engineScheduled, nextRunSec } from "@/lib/time/session";
import { tradingDayKey } from "@/lib/time/ny";
// Plain-node script (no build step) — allowJs resolves it, types are inferred.
import { inCronWindow } from "../scripts/engine/watchdog.mjs";

/* The engine's own schedule, and the three places that model it.

   `engineScheduled` answers "should a run have happened?" — distinct from
   `inEntryWindow`, which answers "are we trading?". Conflating them is what
   made a normal Friday-to-Monday silence read as "the bot has not checked in
   recently" on Home, the Signals hero and the header bell.

   The window is now the whole Globex week: every hour Mon-Fri UTC, plus hours
   22-23 on Sunday. The Sunday block spans both DST regimes because Globex
   reopens 18:00 ET = 22:00 UTC in EDT and 23:00 UTC in EST. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("engineScheduled", () => {
  it("is true at every hour Monday to Friday", () => {
    expect(engineScheduled(sec("2026-07-27T00:00:00Z"))).toBe(true); // Mon, midnight
    expect(engineScheduled(sec("2026-07-27T01:37:00Z"))).toBe(true); // Mon, the reported moment
    expect(engineScheduled(sec("2026-07-27T13:00:00Z"))).toBe(true);
    expect(engineScheduled(sec("2026-07-24T23:45:00Z"))).toBe(true); // Fri, last slot
  });

  it("covers the Sunday Globex reopen in both DST regimes", () => {
    expect(engineScheduled(sec("2026-07-26T21:59:00Z"))).toBe(false); // still shut
    expect(engineScheduled(sec("2026-07-26T22:00:00Z"))).toBe(true); // EDT open
    expect(engineScheduled(sec("2026-01-04T23:00:00Z"))).toBe(true); // EST open (January)
  });

  it("is false all Saturday and through Sunday daytime", () => {
    expect(engineScheduled(sec("2026-07-25T12:00:00Z"))).toBe(false); // Saturday
    expect(engineScheduled(sec("2026-07-25T23:00:00Z"))).toBe(false); // Saturday night
    expect(engineScheduled(sec("2026-07-26T12:00:00Z"))).toBe(false); // Sunday daytime
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
  it("is the next quarter hour once the week is open", () => {
    // The moment the user reported "last ok 41h 38m ago": under the old
    // 06:00-21:45 window the next run was 4h23m away. It is now 8 minutes.
    expect(nextRunSec(sec("2026-07-27T01:37:00Z"))).toBe(sec("2026-07-27T01:45:00Z"));
    expect(nextRunSec(sec("2026-07-27T13:02:00Z"))).toBe(sec("2026-07-27T13:15:00Z"));
  });

  it("skips the weekend to the Sunday reopen", () => {
    expect(nextRunSec(sec("2026-07-25T12:00:00Z"))).toBe(sec("2026-07-26T22:00:00Z")); // Sat
    expect(nextRunSec(sec("2026-07-26T12:00:00Z"))).toBe(sec("2026-07-26T22:00:00Z")); // Sun
    expect(nextRunSec(sec("2026-07-24T23:50:00Z"))).toBe(sec("2026-07-26T22:00:00Z")); // Fri night
  });
});

describe("tradingDayKey", () => {
  /* Futures roll at 18:00 ET. Once the engine runs through the Globex evening,
     keying "now" to the calendar NY date would file a zeroed daily funnel under
     a Sunday that never traded — and Home reads the newest date_key, so that
     empty row would hide Friday's real one. */

  it("is the same day for every moment an entry can be taken", () => {
    // Entries are gated to 02:00-15:25 ET, so this is a no-op on signal rows.
    expect(tradingDayKey(sec("2026-07-27T06:00:00Z"))).toBe("2026-07-27"); // 02:00 ET Mon
    expect(tradingDayKey(sec("2026-07-27T19:25:00Z"))).toBe("2026-07-27"); // 15:25 ET Mon
    expect(tradingDayKey(sec("2026-07-27T21:59:00Z"))).toBe("2026-07-27"); // 17:59 ET Mon
  });

  it("rolls forward at 18:00 ET", () => {
    expect(tradingDayKey(sec("2026-07-27T22:00:00Z"))).toBe("2026-07-28"); // 18:00 ET Mon
    expect(tradingDayKey(sec("2026-07-28T01:00:00Z"))).toBe("2026-07-28"); // 21:00 ET Mon
  });

  it("skips the weekend", () => {
    expect(tradingDayKey(sec("2026-07-24T22:00:00Z"))).toBe("2026-07-27"); // 18:00 ET Fri
    expect(tradingDayKey(sec("2026-07-25T12:00:00Z"))).toBe("2026-07-27"); // Saturday
    expect(tradingDayKey(sec("2026-07-26T23:00:00Z"))).toBe("2026-07-27"); // 19:00 ET Sun
    // The moment the user reported: Sunday 21:37 ET belongs to Monday.
    expect(tradingDayKey(sec("2026-07-27T01:37:00Z"))).toBe("2026-07-27");
  });

  it("is DST-safe across a spring-forward weekend", () => {
    // US DST began 2026-03-08. Friday 2026-03-06 evening rolls to Monday 03-09.
    expect(tradingDayKey(sec("2026-03-06T23:00:00Z"))).toBe("2026-03-09");
    expect(tradingDayKey(sec("2026-03-08T23:00:00Z"))).toBe("2026-03-09");
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
