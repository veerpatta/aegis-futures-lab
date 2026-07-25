import { describe, expect, it } from "vitest";
import { TUNING_BASELINE, tierStreams } from "../scripts/engine/tiers";

/* The tier-A band survived for weeks after the measurement behind it stopped
   reproducing, and nothing in the code recorded where it came from. These tests
   pin the properties that make that failure mode visible next time. */

describe("TUNING_BASELINE honesty properties", () => {
  it("covers every live stream, and nothing that is not live", () => {
    const liveKeys = new Set(
      tierStreams().flatMap((s) =>
        s.tier === "A" ? ["A"] : s.symbols.map((sym) => `B:${sym}`)
      )
    );
    expect(new Set(TUNING_BASELINE.map((b) => b.key))).toEqual(liveKeys);
  });

  it("records provenance for every band, with something reproducible in it", () => {
    for (const b of TUNING_BASELINE) {
      expect(b.provenance, `${b.key} has no provenance`).toBeTruthy();
      expect(b.provenance.length, `${b.key} provenance is too thin to be useful`).toBeGreaterThan(60);
      // A date so staleness is checkable, and a number so the claim is testable.
      expect(b.provenance, `${b.key} provenance has no date`).toMatch(/20\d\d-\d\d-\d\d/);
      expect(b.provenance, `${b.key} provenance quotes no measurement`).toMatch(/PF \d/);
    }
  });

  it("never sets a PF floor at or below break-even", () => {
    // A floor at 1.0 would let a stream that makes no money print TRACKING.
    for (const b of TUNING_BASELINE)
      expect(b.pfBand[0], `${b.key} floor would call break-even 'tracking'`).toBeGreaterThan(1.0);
  });

  it("keeps every band a real interval", () => {
    for (const b of TUNING_BASELINE) {
      expect(b.pfBand[1]).toBeGreaterThan(b.pfBand[0]);
      expect(b.tradesPerDay[1]).toBeGreaterThan(b.tradesPerDay[0]);
      expect(b.tradesPerDay[0]).toBeGreaterThan(0);
    }
  });
});

describe("tier A is marked clustered", () => {
  const a = TUNING_BASELINE.find((b) => b.key === "A")!;

  it("says its trades cluster, so a quiet week is not read as a shortfall", () => {
    // Measured 2026-07-25: 16 trades on 3 of 51 sessions, 14 of them on one day.
    expect(a.clustered).toBe(true);
  });

  it("carries the re-measured band, not the original promise", () => {
    // The original was PF 1.30–1.40 at 0.3–0.4/day, from the unaligned path.
    expect(a.pfBand).not.toEqual([1.3, 1.4]);
    expect(a.provenance).toContain("day-aligned");
  });

  it("keeps the band wider than the point estimate it came from", () => {
    // Measured PF was 1.27 on 16 trades; a band pinned to that would be a fit.
    expect(a.pfBand[0]).toBeLessThan(1.27);
    expect(a.pfBand[1]).toBeGreaterThan(1.27);
  });

  it("does not mark the tier-B streams clustered — they genuinely have a pace", () => {
    for (const b of TUNING_BASELINE.filter((x) => x.tier === "B"))
      expect(b.clustered ?? false).toBe(false);
  });
});
