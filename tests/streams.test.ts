import { describe, expect, it } from "vitest";
import {
  legacyStreamKeyFor,
  streamKeyFor,
  streamKeyForRow,
  streamLabel,
} from "../lib/engine/streams";
import { buildModelRows, type RealTrainRow, type ShadowTrainRow } from "../scripts/engine/train-set";

/* Finding 8: a promoted shadow strategy (tier B) must not collide with the RSI
   B-stream on the same symbol, and must not double-count in model training. */

describe("stream keys", () => {
  it("keys tier B by label AND symbol, so a promoted shadow can't collide", () => {
    expect(streamKeyFor("B", "rsi-reversion", "MES")).toBe("B:rsi-reversion:MES");
    expect(streamKeyFor("B", "vwap-reversion", "MES")).toBe("B:vwap-reversion:MES");
    // The bug: both would previously have been "B:MES".
    expect(streamKeyFor("B", "rsi-reversion", "MES")).not.toBe(streamKeyFor("B", "vwap-reversion", "MES"));
    expect(legacyStreamKeyFor("B", "MES")).toBe("B:MES");
  });

  it("derives the key from a signals row's dedupe_key", () => {
    expect(streamKeyForRow({ tier: "B", symbol: "MES", dedupe_key: "B:vwap-reversion:MES:1700000000" })).toBe("B:vwap-reversion:MES");
    expect(streamKeyForRow({ tier: "A", symbol: "MNQ", dedupe_key: "A:zone-v5:MNQ:1700000000" })).toBe("A");
  });

  it("labels both new and legacy keys readably", () => {
    expect(streamLabel("A")).toContain("Tier A");
    expect(streamLabel("B:vwap-reversion:MES")).toBe("Tier B · vwap-reversion MES");
    expect(streamLabel("B:MES")).toBe("Tier B · MES"); // legacy
  });
});

describe("buildModelRows dedup (finding 8)", () => {
  const base = { regime: "trend-low-vol", vix_bucket: "low", score: 50, rr: 1.5, pnl_usd: 100, fill_confidence: "clean" };
  const real: RealTrainRow[] = [
    { ...base, tier: "B", symbol: "MES", dedupe_key: "B:vwap-reversion:MES:1700000000", signal_ts: "2026-01-01T10:00:00Z" },
  ];
  const shadow: ShadowTrainRow[] = [
    // Same (strategy, symbol, entry_ts) as the real row — the duplicate.
    { ...base, strategy: "vwap-reversion", symbol: "MES", signal_ts: "2026-01-01T10:00:00Z" },
    // A genuinely different shadow row — kept.
    { ...base, strategy: "orb", symbol: "MNQ", signal_ts: "2026-01-02T10:00:00Z" },
  ];

  it("drops a shadow row that duplicates a real row, keeps distinct ones", () => {
    const rows = buildModelRows(real, shadow);
    expect(rows.length).toBe(2); // 1 real + 1 distinct shadow (duplicate dropped)
    expect(rows.filter((r) => r.tier === "B").length).toBe(1); // the real row
    expect(rows.filter((r) => r.tier === null).length).toBe(1); // only the orb shadow
  });
});
