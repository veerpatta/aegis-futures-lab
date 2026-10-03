import { describe, expect, it } from "vitest";
import { autoBenchmarkOutcome, type CellResult } from "@/lib/research/auto-benchmark";

const cell = (cellName: string, verdict: CellResult["verdict"], n = 200): CellResult => ({
  cell: cellName,
  symbol: cellName.split(":")[0],
  allYears: cellName.endsWith(":all"),
  n,
  net: 0,
  percentile: verdict === "beats-random" ? 97 : 50,
  verdict,
});

describe("auto-benchmark decision rule (preregistered)", () => {
  it("never promotes, whatever the result", () => {
    const out = autoBenchmarkOutcome("orb", [cell("MES:all", "beats-random"), cell("MES:2024", "beats-random")]);
    expect(out.verdict).toBe("beats-random");
    expect(out.gate.promote).toBe(false);
  });

  it("is no-edge when any judged all-years cell misses the 95th percentile", () => {
    const out = autoBenchmarkOutcome("orb", [
      cell("MES:all", "beats-random"),
      cell("MNQ:all", "indistinguishable-from-random"),
      cell("MES:2024", "beats-random"),
    ]);
    expect(out.verdict).toBe("no-edge");
    expect(out.nextStep).toMatch(/Do not tune it/);
  });

  it("needs half the judged market-years too, not just the pooled cell", () => {
    const out = autoBenchmarkOutcome("orb", [
      cell("MES:all", "beats-random"),
      cell("MES:2023", "indistinguishable-from-random"),
      cell("MES:2024", "indistinguishable-from-random"),
      cell("MES:2025", "beats-random"),
    ]);
    expect(out.verdict).toBe("no-edge");
  });

  it("reports too few trades instead of guessing", () => {
    const out = autoBenchmarkOutcome("zone-rejection-v2", [cell("MES:all", "insufficient-sample", 4)]);
    expect(out.verdict).toBe("insufficient-sample");
    expect(out.headline).toMatch(/not tested yet/);
  });
});
