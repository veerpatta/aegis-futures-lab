import { describe, expect, it } from "vitest";
import { isLiveSignal, liveOnly } from "@/lib/signals/live";
import { GO_LIVE_DATE } from "@/scripts/engine/tiers";

/* The engine's first run mirrored a trailing seven days, so it wrote rows for
   sessions that had already finished. Those rows are correct — the backtest
   acts on completed bars and never looks ahead — but they were never traded,
   and on 2026-07-31 they held +$1,441.78 against −$215.68 for everything
   genuinely live. Home's headline summed both and printed +$1,226.10.

   That is the failure these tests exist to stop coming back: a performance
   figure that includes rows the engine wrote about the past. */

const row = (signal_ts: string, pnl_usd: number | null = null) => ({ signal_ts, pnl_usd });

describe("isLiveSignal", () => {
  it("accepts go-live day itself", () => {
    // The boundary is inclusive: the first run's own signals ARE live.
    expect(isLiveSignal(`${GO_LIVE_DATE}T14:00:00Z`)).toBe(true);
  });

  it("rejects the trailing-mirror rows that predate go-live", () => {
    expect(isLiveSignal("2026-07-13T14:00:00Z")).toBe(false);
    expect(isLiveSignal("2026-07-18T14:00:00Z")).toBe(false);
  });

  it("compares on the NY trading day, not on UTC", () => {
    /* 2026-07-19T02:00Z is 2026-07-18 22:00 ET — the previous NY day, and so
       NOT live, even though its UTC date is go-live day. Getting this wrong
       would let a backfilled row through on exactly the boundary the whole
       filter is about. */
    expect(isLiveSignal("2026-07-19T02:00:00Z")).toBe(false);
  });
});

describe("liveOnly", () => {
  const signals = [
    row("2026-07-13T14:00:00Z", 700),
    row("2026-07-16T14:00:00Z", 741.78),
    row("2026-07-19T14:00:00Z", -100),
    row("2026-07-30T14:00:00Z", -115.68),
  ];

  it("drops the backfilled rows and keeps the live ones", () => {
    expect(liveOnly(signals).map((s) => s.signal_ts)).toEqual([
      "2026-07-19T14:00:00Z",
      "2026-07-30T14:00:00Z",
    ]);
  });

  it("flips the sign of the headline — which is the entire point", () => {
    const sum = (rows: typeof signals) => rows.reduce((a, s) => a + (s.pnl_usd ?? 0), 0);
    expect(sum(signals)).toBeGreaterThan(0); // what Home used to print
    expect(sum(liveOnly(signals))).toBeLessThan(0); // what is actually true
  });

  it("is a no-op when every row is live", () => {
    const live = signals.slice(2);
    expect(liveOnly(live)).toHaveLength(live.length);
  });

  it("returns an empty list rather than throwing on no input", () => {
    expect(liveOnly([])).toEqual([]);
  });
});
