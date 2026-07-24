import { describe, expect, it } from "vitest";
import { maxDrawdown, resampleDrawdowns } from "../scripts/engine/montecarlo";

describe("maxDrawdown", () => {
  it("measures peak-to-trough on the cumulative curve", () => {
    // equity: 100, 50, 150, 30, 130 → worst drop 150→30 = 120
    expect(maxDrawdown([100, -50, 100, -120, 100])).toBe(120);
  });

  it("is zero for an all-winning sequence and for no trades", () => {
    expect(maxDrawdown([10, 20, 30])).toBe(0);
    expect(maxDrawdown([])).toBe(0);
  });
});

describe("resampleDrawdowns", () => {
  const pnls = [120, -80, 60, -100, 150, -50, 90, -70, 40, -30];

  it("is deterministic for a given seed", () => {
    const a = resampleDrawdowns(pnls, 500, 7);
    const b = resampleDrawdowns(pnls, 500, 7);
    expect(a).toEqual(b);
  });

  it("p95 is at least the median, and both are sane", () => {
    const d = resampleDrawdowns(pnls, 1000);
    expect(d.p95).toBeGreaterThanOrEqual(d.median);
    expect(d.median).toBeGreaterThan(0); // mixed sequence must draw down sometimes
    // No resample can lose more than 10 × the worst single trade.
    expect(d.p95).toBeLessThanOrEqual(1000);
  });

  it("all-positive trades cannot draw down", () => {
    expect(resampleDrawdowns([10, 20, 30], 200)).toEqual({ median: 0, p95: 0 });
  });
});
