import { describe, expect, it } from "vitest";
import { promotionReport, type ShadowLike } from "../scripts/engine/promotion";

/* Promotion must be mechanical, and it is now two gates rather than one.

   The AUDITION is ≥60 closed AND PF ≥ 1.2 AND positive net in ≥2 regimes with
   data (≥5 closed each). Clearing it means the stream is worth benchmarking.

   `promotable` additionally requires lib/validation/promotionGate.ts, which is
   what the audition cannot see: does the entry beat matched random entries, is
   the deflated Sharpe significant after the trial correction, what is the PBO,
   does it survive purged CV, and are there 150 trades behind it. An unmeasured
   check is a gap, never a pass — so an unbenchmarked stream is not promotable
   however good its audition numbers are. That is the property these tests
   exist to pin, because losing it is how a 60-trade result reaches production. */

const row = (pnl: number | null, regime: string, fc = "clean"): ShadowLike => ({
  status: pnl === null ? "triggered" : pnl >= 0 ? "hit_target" : "hit_stop",
  pnl_usd: pnl,
  regime,
  fill_confidence: fc,
});

/* n closed rows in a regime, alternating +100/−50 → PF 2.0, positive. */
const winners = (n: number, regime: string) =>
  Array.from({ length: n }, (_, i) => row(i % 2 ? -50 : 100, regime));

describe("promotionReport", () => {
  it("passes the audition on volume, PF and regime diversity", () => {
    const rows = [...winners(40, "trend-low-vol"), ...winners(40, "range-low-vol")];
    const r = promotionReport(rows);
    expect(r.closed).toBe(80);
    expect(r.pf).toBeCloseTo(2.0);
    expect(r.regimesPositive).toBe(2);
    expect(r.auditionPassed).toBe(true);
  });

  it("is NOT promotable on the audition alone — the benchmark was never run", () => {
    /* The regression that matters. Before the gate was wired this returned
       true, which is how a stream could reach live tier B on 60 trades and
       PF 1.2 with nobody having checked it against a coin flip. */
    const rows = [...winners(40, "trend-low-vol"), ...winners(40, "range-low-vol")];
    const r = promotionReport(rows);
    expect(r.auditionPassed).toBe(true);
    expect(r.promotable).toBe(false);
    expect(r.gate.promote).toBe(false);
    // Reported as missing evidence, not as a failed check.
    expect(r.gate.evidenceGaps).toContain("randomEntry");
    expect(r.gate.failed).not.toContain("randomEntry");
  });

  it("counts 80 closed against the gate's 150 as a real failure, not a gap", () => {
    const r = promotionReport([...winners(40, "trend-low-vol"), ...winners(40, "range-low-vol")]);
    expect(r.gate.failed).toContain("trades");
  });

  it("is promotable once every gate check is measured and passes", () => {
    const rows = [...winners(100, "trend-low-vol"), ...winners(100, "range-low-vol")];
    const r = promotionReport(rows, {
      randomEntryPercentile: 97,
      deflated: { dsr: 0.99, tStat: 3.5, trials: 20 } as never,
      pbo: { pbo: 0.1 } as never,
      oosNetExpectancy: 12.5,
      cvFoldSurvival: 0.8,
    });
    expect(r.auditionPassed).toBe(true);
    expect(r.gate.evidenceGaps).toEqual([]);
    expect(r.promotable).toBe(true);
  });

  it("refuses a stream that fails the random-entry benchmark, everything else clean", () => {
    const rows = [...winners(100, "trend-low-vol"), ...winners(100, "range-low-vol")];
    const r = promotionReport(rows, {
      randomEntryPercentile: 65.2, // B:MNQ's real Phase 1 figure
      deflated: { dsr: 0.99, tStat: 3.5, trials: 20 } as never,
      pbo: { pbo: 0.1 } as never,
      oosNetExpectancy: 12.5,
      cvFoldSurvival: 0.8,
    });
    expect(r.promotable).toBe(false);
    expect(r.gate.failed).toContain("randomEntry");
  });

  it("fails on volume alone even with a great PF", () => {
    const r = promotionReport([...winners(20, "trend-low-vol"), ...winners(20, "range-low-vol")]);
    expect(r.pf).toBeCloseTo(2.0);
    expect(r.promotable).toBe(false);
    expect(r.checklist[0].pass).toBe(false); // <60 closed
  });

  it("fails when only one regime has data, however profitable", () => {
    const r = promotionReport(winners(80, "trend-low-vol"));
    expect(r.promotable).toBe(false);
    expect(r.regimesWithData).toBe(1);
    expect(r.checklist[2].pass).toBe(false);
  });

  it("fails on PF below 1.2", () => {
    const grinder = (regime: string) =>
      Array.from({ length: 40 }, (_, i) => row(i % 2 ? -100 : 105, regime)); // PF 1.05
    const r = promotionReport([...grinder("trend-low-vol"), ...grinder("range-high-vol")]);
    expect(r.pf).toBeCloseTo(1.05);
    expect(r.promotable).toBe(false);
    expect(r.checklist[1].pass).toBe(false);
  });

  it("open positions and untagged rows don't crash the math", () => {
    const r = promotionReport([row(null, "trend-low-vol"), { ...row(50, ""), regime: null }]);
    expect(r.total).toBe(2);
    expect(r.closed).toBe(1);
    expect(r.promotable).toBe(false);
  });
});
