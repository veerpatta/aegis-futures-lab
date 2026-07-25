import { describe, expect, it } from "vitest";
import manifest from "@/lib/engine/expected-streams.json";
import { streamKeyFor } from "@/lib/engine/streams";
import { tierStreams } from "../scripts/engine/tiers";
import { findSilentStreams } from "../scripts/engine/watchdog.mjs";

/* Item 2.5. Tier A produced zero signals from go-live without a single alert,
   because "the cron is healthy" and "the engine is producing anything" were
   never the same question. The silence check answers the second one. */

const closedHolidays = new Set<string>(["2026-07-03"]); // a Friday, for the exclusion test
const ms = (iso: string) => Date.parse(iso);

describe("the stream manifest cannot drift from tiers.ts", () => {
  it("lists exactly the streams the engine is configured to run", () => {
    const expected = [
      ...new Set(
        tierStreams().map((s) => streamKeyFor(s.tier, s.label, s.symbols.join("+")))
      ),
    ];
    // Tier A is one stream over both symbols ("A"); tier B is per symbol.
    const fromConfig = [
      ...new Set(
        tierStreams().flatMap((s) =>
          s.tier === "A" ? ["A"] : s.symbols.map((sym) => streamKeyFor(s.tier, s.label, sym))
        )
      ),
    ];
    expect(manifest.streams).toEqual(fromConfig);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("carries a threshold of 10 trading days", () => {
    expect(manifest.silenceTradingDays).toBe(10);
  });
});

describe("findSilentStreams", () => {
  const base = {
    expected: ["A", "B:rsi-reversion:MES"],
    engineFirstRunMs: ms("2026-07-01T12:00:00Z"),
    silenceTradingDays: 10,
    closedHolidays,
  };
  const sig = (tier: string, symbol: string, label: string, iso: string) => ({
    tier,
    symbol,
    dedupe_key: `${tier}:${label}:${symbol}:1`,
    signal_ts: iso,
  });

  it("flags a stream that has NEVER produced a signal, timed from the first run", () => {
    // 2026-07-01 → 2026-07-24 is well over 10 trading days.
    const out = findSilentStreams({
      ...base,
      rows: [sig("B", "MES", "rsi-reversion", "2026-07-24T14:00:00Z")],
      nowMs: ms("2026-07-24T22:00:00Z"),
    });
    expect(out.map((s: { stream: string }) => s.stream)).toEqual(["A"]);
    expect(out[0].everProduced).toBe(false);
    expect(out[0].lastSignal).toBeNull();
    expect(out[0].days).toBeGreaterThanOrEqual(10);
  });

  it("does NOT flag a brand-new deployment — days are counted from the first run", () => {
    const out = findSilentStreams({
      ...base,
      rows: [],
      engineFirstRunMs: ms("2026-07-22T12:00:00Z"),
      nowMs: ms("2026-07-24T22:00:00Z"), // 2 trading days old
    });
    expect(out).toEqual([]);
  });

  it("clears a stream as soon as it produces a signal", () => {
    const out = findSilentStreams({
      ...base,
      rows: [
        sig("A", "MES", "zone-v5", "2026-07-23T14:00:00Z"),
        sig("B", "MES", "rsi-reversion", "2026-07-24T14:00:00Z"),
      ],
      nowMs: ms("2026-07-24T22:00:00Z"),
    });
    expect(out).toEqual([]);
  });

  it("uses the NEWEST signal per stream, not the first row seen", () => {
    const out = findSilentStreams({
      ...base,
      rows: [
        sig("A", "MES", "zone-v5", "2026-06-01T14:00:00Z"), // ancient
        sig("A", "MNQ", "zone-v5", "2026-07-23T14:00:00Z"), // recent, same stream "A"
        sig("B", "MES", "rsi-reversion", "2026-07-24T14:00:00Z"),
      ],
      nowMs: ms("2026-07-24T22:00:00Z"),
    });
    expect(out).toEqual([]);
  });

  it("excludes weekends and full holidays from the count", () => {
    // 2026-07-03 is marked a closed holiday above. Counting from 2026-07-02
    // to 2026-07-17 spans 15 calendar days but fewer trading days, so a
    // 10-day threshold must not trip on calendar arithmetic alone.
    const withHoliday = findSilentStreams({
      ...base,
      expected: ["A"],
      rows: [sig("A", "MES", "zone-v5", "2026-07-02T14:00:00Z")],
      nowMs: ms("2026-07-16T22:00:00Z"),
      closedHolidays,
    });
    const withoutHoliday = findSilentStreams({
      ...base,
      expected: ["A"],
      rows: [sig("A", "MES", "zone-v5", "2026-07-02T14:00:00Z")],
      nowMs: ms("2026-07-16T22:00:00Z"),
      closedHolidays: new Set<string>(),
    });
    // The holiday keeps the span under the threshold; removing it tips over.
    expect(withHoliday).toEqual([]);
    expect(withoutHoliday).toHaveLength(1);
    expect(withoutHoliday[0].days).toBe(10);
  });

  it("stays quiet when the engine has never run at all (the cron check owns that)", () => {
    const out = findSilentStreams({
      ...base,
      rows: [],
      engineFirstRunMs: null,
      nowMs: ms("2026-07-24T22:00:00Z"),
    });
    expect(out).toEqual([]);
  });
});
