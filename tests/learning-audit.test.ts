import { describe, expect, it } from "vitest";
import { dataQualityReport, stableHash } from "../scripts/engine/learning-audit";

describe("learning audit helpers", () => {
  it("hashes objects deterministically regardless of key order", () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
  });

  it("fails data quality on missing or duplicate signal identities", () => {
    const report = dataQualityReport([
      { dedupe_key: "a" },
      { dedupe_key: "a" },
      { dedupe_key: null },
    ]);
    expect(report.healthy).toBe(false);
    expect(report.duplicateKeys).toBe(1);
    expect(report.missingKeys).toBe(1);
    expect(report.reasonCodes).toEqual(["duplicate_signal_keys", "missing_signal_keys"]);
  });

  it("passes a unique, fully identified dataset", () => {
    expect(dataQualityReport([{ dedupe_key: "a" }, { dedupe_key: "b" }]).healthy).toBe(true);
  });
});
