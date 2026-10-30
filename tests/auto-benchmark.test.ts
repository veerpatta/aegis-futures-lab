import { describe, expect, it } from "vitest";
import { noTradeEvidence, benchmarkBaselines } from "@/lib/research/auto-benchmark";

describe("no-trade comparison", () => {
  it("reports net after costs against zero separately for each market", () => {
    const cells = [
      { cell: "MES:all", symbol: "MES", allYears: true, n: 200, net: -100, percentile: 97, verdict: "beats-random" as const },
      { cell: "MNQ:all", symbol: "MNQ", allYears: true, n: 180, net: 50, percentile: 20, verdict: "indistinguishable-from-random" as const },
      { cell: "MES:2025", symbol: "MES", allYears: false, n: 40, net: 12, percentile: 40, verdict: "indistinguishable-from-random" as const },
    ];
    expect(noTradeEvidence(cells)).toEqual([{ symbol: "MES", n: 200, net: -100, status: "below-zero" }, { symbol: "MNQ", n: 180, net: 50, status: "above-zero" }]);
  });
  it("does not call a small sample or missing result a pass", () => {
    const cells = [{ cell: "MES:all", symbol: "MES", allYears: true, n: 2, net: 15, percentile: null, verdict: "insufficient-sample" as const }];
    expect(noTradeEvidence(cells)[0].status).toBe("insufficient-sample");
  });
  it("only compares saved results from the same registered configuration", () => {
    const rows = [
      { config_hash: "a", symbol: "MES", net: { total: -40, trades: 50 }, window_from: "2019-05-06T00:00:00Z", window_to: "2026-07-29T00:00:00Z", bar_source: "databento" },
      { config_hash: "b", symbol: "MNQ", net: { total: 100, trades: 50 } },
      { config_hash: "a", symbol: "MNQ", net: {} },
    ];
    expect(benchmarkBaselines("a", rows)).toEqual([{ symbol: "MES", n: 50, net: -40, status: "below-zero", from: "2019-05-06", to: "2026-07-29", source: "databento" }]);
  });
});
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
