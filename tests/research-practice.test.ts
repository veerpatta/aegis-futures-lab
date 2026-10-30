import { describe, expect, it } from "vitest";
import type { SignalRow } from "@/lib/neon/client";
import { researchPractice, practiceResult } from "@/lib/plain/activity";
import { visibleSignals } from "@/lib/signals/snapshot";

const base = { id: 1, tier: "B", symbol: "MES", dedupe_key: "B:rsi-reversion:MES:1", signal_ts: "2026-10-15T14:00:00Z", status: "hit_stop", pnl_usd: -25, suppressed: true, stale_data: false, orphaned: false, fill_confidence: "clean" } as SignalRow;

describe("paused source practice", () => {
  it("keeps paused records separate from the ideas used by the learner", () => {
    const rows = [base, { ...base, id: 2, suppressed: false }, { ...base, id: 3, orphaned: true }];
    expect(researchPractice(rows).map(r => r.id)).toEqual([1, 3]);
    expect(visibleSignals(rows).map(r => r.id)).toEqual([2]);
  });

  it("does not present stale or uncertain fills as reliable outcomes", () => {
    expect(practiceResult({ ...base, stale_data: true })).toEqual({ label: "Price data too old to judge", net: null });
    expect(practiceResult({ ...base, fill_confidence: "doubtful" })).toEqual({ label: "Fill uncertain", net: null });
    expect(practiceResult({ ...base, fill_confidence: "marginal" })).toEqual({ label: "Fill uncertain", net: null });
    expect(practiceResult({ ...base, fill_confidence: null })).toEqual({ label: "Fill not checked", net: null });
    expect(practiceResult({ ...base, orphaned: true })).toEqual({ label: "Revised away", net: null });
    expect(practiceResult(base)).toEqual({ label: "Closed practice result", net: -25 });
  });

  it("shows an unresolved or incomplete result without inventing a profit", () => {
    expect(practiceResult({ ...base, status: "triggered", pnl_usd: null })).toEqual({ label: "Result not confirmed", net: null });
    expect(practiceResult({ ...base, status: "triggered", pnl_usd: null, fill_confidence: "marginal" })).toEqual({ label: "Fill uncertain", net: null });
    expect(practiceResult({ ...base, status: "cancelled", pnl_usd: null })).toEqual({ label: "Not filled", net: null });
  });
});
