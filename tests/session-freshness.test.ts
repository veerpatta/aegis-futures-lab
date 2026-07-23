import { describe, expect, it } from "vitest";
import { dataDelayed, inEntryWindow } from "@/lib/time/session";

/* The amber "data delayed more than usual" state: engine-reported staleness
   always wins; the 40-minute run-age rule only applies inside the
   02:00–15:25 ET Mon–Fri entry window. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// Wed 2026-07-22 12:00 ET (EDT, UTC-4) — deep inside the entry window.
const midSession = sec("2026-07-22T16:00:00Z");
// Wed 2026-07-22 20:00 ET — after the entry window.
const evening = sec("2026-07-23T00:00:00Z");

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

  it("is true whenever the engine flagged stale bars", () => {
    const stale = run(5, { message: "bars …; age MES 45m / MNQ 45m (stale)" });
    expect(dataDelayed([stale], midSession)).toBe(true);
    expect(dataDelayed([stale], evening)).toBe(true); // marker wins outside the window too
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
