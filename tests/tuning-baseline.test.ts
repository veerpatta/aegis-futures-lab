import { describe, expect, it } from "vitest";
import { TUNING_BASELINE, isRefuted, tierStreams } from "../scripts/engine/tiers";
import { bandVerdict } from "../lib/stats";

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

/* The failure this whole file is a post-mortem of happened a second time, one
   level up. The band was corrected in July 2026 and its provenance recorded —
   and then seven years of real CME data measured the SAME configuration at PF
   0.55 over 1,180 trades. A provenance string cannot express that: it is prose
   beside a band that still reads as an expectation. `outOfSample` is the field
   that can, and these tests stop it becoming decorative.

   Note what is NOT relaxed here. The pfBand floor test above still applies to
   every band including a refuted one, because a refuted stream is not a stream
   with a low band — it is a stream whose band was shown to be wrong. */
describe("an out-of-sample refutation cannot be decorative", () => {
  const refuted = TUNING_BASELINE.filter(isRefuted);

  it("holds provenance to the same standard as a band's", () => {
    for (const b of TUNING_BASELINE) {
      const o = b.outOfSample;
      if (!o) continue;
      expect(o.provenance.length, `${b.key} out-of-sample provenance is too thin`).toBeGreaterThan(60);
      expect(o.provenance, `${b.key} out-of-sample provenance has no date`).toMatch(/20\d\d-\d\d-\d\d/);
      expect(o.provenance, `${b.key} out-of-sample provenance quotes no measurement`).toMatch(/PF \d/);
      // The claim must come with the command that re-runs it, like every other
      // number in this repo.
      expect(o.provenance, `${b.key} out-of-sample provenance has no reproduce command`).toMatch(
        /npx tsx scripts\//
      );
    }
  });

  it("is internally consistent — a refutation is a real, large, losing sample", () => {
    for (const b of refuted) {
      const o = b.outOfSample!;
      expect(o.pf, `${b.key} is marked refuted at PF >= 1`).toBeLessThan(1);
      expect(o.net, `${b.key} claims a losing PF but a positive net`).toBeLessThan(0);
      expect(o.avgR, `${b.key} claims a losing PF but a positive avg R`).toBeLessThan(0);
      // 100 trades is the audit's stated floor for judging an edge at all; a
      // refutation that cannot clear it would be the same small-sample error
      // running in the other direction.
      expect(o.trades, `${b.key} refutes on too small a sample to judge`).toBeGreaterThanOrEqual(100);
      expect(o.sessions, `${b.key} refutes on too few sessions`).toBeGreaterThan(o.trades / 10);
    }
  });

  it("can never print TRACKING, however the live rows come in", () => {
    /* This is the property that matters on screen. Tier A has no live closed
       trades, so without the override the panel says COLLECTING 0/20 beneath a
       promise of PF 1.05–1.30. And a lucky run of twenty live trades must not
       be allowed to overturn 1,180 measured ones. */
    for (const b of refuted)
      for (const closed of [0, 1, 19, 20, 100, 5000])
        for (const pf of [null, 0, 0.5, 1, 1.27, 3, Infinity]) {
          const v = bandVerdict(closed, pf, b.pfBand, true);
          expect(v, `${b.key} printed ${v} at n=${closed}, pf=${pf}`).toBe("refuted");
        }
  });

  it("leaves every un-refuted stream's verdict ladder exactly as it was", () => {
    for (const b of TUNING_BASELINE.filter((x) => !isRefuted(x))) {
      expect(bandVerdict(0, null, b.pfBand, false)).toBe("collecting");
      expect(bandVerdict(50, b.pfBand[0], b.pfBand, false)).toBe("tracking");
      expect(bandVerdict(50, 1.01, b.pfBand, false)).toBe("lagging");
      expect(bandVerdict(50, 0.9, b.pfBand, false)).toBe("underwater");
    }
  });

  it("marks tier A refuted — the seven-year result is the headline finding", () => {
    const a = TUNING_BASELINE.find((b) => b.key === "A")!;
    expect(isRefuted(a), "tier A is no longer marked refuted — was it re-measured?").toBe(true);
    expect(a.outOfSample!.provenance).toContain("BAR_SOURCE=databento");
  });
});
