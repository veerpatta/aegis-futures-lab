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

  /* Every per-stream override must name a stream that actually exists, or the
     override is dead config that silently does nothing — the exact failure
     shape a threshold override is most likely to hide behind. */
  it("only overrides thresholds for streams that are configured", () => {
    for (const stream of Object.keys(manifest.silenceTradingDaysByStream))
      expect(manifest.streams).toContain(stream);
  });

  /* Tier A fires on one session in fifty (scripts/diag/PHASE1-FINDINGS.md §1),
     so the 10-day default can never clear for it. */
  it("raises tier A above its measured one-in-fifty cadence", () => {
    expect(manifest.silenceTradingDaysByStream.A).toBeGreaterThan(50);
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

  /* Item: a stream whose real cadence is rarer than the global threshold used
     to alert forever — tier A tripped at 10 trading days when it fires on one
     session in fifty, and the permanently-open issue is what teaches everyone
     to ignore the label. A per-stream override raises only that stream. */
  describe("per-stream thresholds", () => {
    const rows = [sig("B", "MES", "rsi-reversion", "2026-07-24T14:00:00Z")];
    const nowMs = ms("2026-07-24T22:00:00Z"); // >10 trading days after the first run

    it("does not flag a stream that is inside its own raised threshold", () => {
      const out = findSilentStreams({
        ...base,
        rows,
        nowMs,
        silenceTradingDaysByStream: { A: 60 },
      });
      expect(out).toEqual([]);
    });

    it("still flags that stream once the raised threshold is itself passed", () => {
      const out = findSilentStreams({
        ...base,
        rows,
        nowMs,
        silenceTradingDaysByStream: { A: 3 },
      });
      expect(out.map((s: { stream: string }) => s.stream)).toEqual(["A"]);
      expect(out[0].threshold).toBe(3);
    });

    it("leaves streams with no override on the global threshold", () => {
      const out = findSilentStreams({
        ...base,
        rows: [], // B silent too, and it has no override
        nowMs,
        silenceTradingDaysByStream: { A: 60 },
      });
      expect(out.map((s: { stream: string }) => s.stream)).toEqual(["B:rsi-reversion:MES"]);
      expect(out[0].threshold).toBe(10);
    });

    it("behaves exactly as before when no override map is passed", () => {
      const out = findSilentStreams({ ...base, rows, nowMs });
      expect(out.map((s: { stream: string }) => s.stream)).toEqual(["A"]);
      expect(out[0].threshold).toBe(10);
    });
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
