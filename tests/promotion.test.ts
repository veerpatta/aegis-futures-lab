import { describe, expect, it } from "vitest";
import { promotionReport, type ShadowLike } from "../scripts/engine/promotion";

/* Promotion must be mechanical: ≥60 closed AND PF ≥ 1.2 AND positive net in
   ≥2 regimes with data (≥5 closed each). Anything less reads not-promotable
   with the failing checks visible. */

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
  it("passes a stream with volume, PF and regime diversity", () => {
    const rows = [...winners(40, "trend-low-vol"), ...winners(40, "range-low-vol")];
    const r = promotionReport(rows);
    expect(r.closed).toBe(80);
    expect(r.pf).toBeCloseTo(2.0);
    expect(r.regimesPositive).toBe(2);
    expect(r.promotable).toBe(true);
    expect(r.checklist.every((c) => c.pass)).toBe(true);
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
