import { describe, expect, it } from "vitest";
import {
  STRATEGIES,
  feedsFor,
  tradableFeedsFor,
  isUnmeasured,
  isRefutedStrategy,
  standingOf,
  strategyById,
} from "@/lib/strategies/registry";
import {
  REFUTED_STREAM_EVIDENCE,
  GATE,
  evaluatePromotion,
} from "@/lib/validation/promotionGate";
import { goldSilverZone, GOLD, SILVER } from "@/lib/strategies/gold-silver-zone";
import { specFor } from "@/lib/costs/specs";
import type { SkipNote } from "@/lib/strategies/types";
import { defaultParams } from "@/lib/strategies/types";

/* Which market a strategy is actually handed.
 
   This exists because the answer used to be "MES and MNQ, always". The Lab
   hardcoded that pair in its picker, ForwardTab hardcoded it in BOTH arms of a
   ternary that pretended to branch on symbolMode, and the gold strategy — the
   one strategy that does not trade an equity index — was therefore run against
   S&P and Nasdaq bars. It returned an empty array and said nothing, so the
   failure looked like a quiet market rather than a wiring bug.
 
   The rule these tests protect: the STRATEGY decides, and the UI asks. */

describe("feedsFor", () => {
  it("gives gold its own two legs, not the index pair", () => {
    expect(feedsFor(goldSilverZone)).toEqual([GOLD, SILVER]);
  });

  it("falls back to the legacy index pair for every strategy that predates feeds", () => {
    for (const s of STRATEGIES) {
      if (s.feeds) continue;
      expect(feedsFor(s)).toEqual(["MES", "MNQ"]);
    }
  });

  it("returns a fresh array, so a caller cannot mutate the declaration", () => {
    const a = feedsFor(goldSilverZone);
    a.push("MES");
    expect(feedsFor(goldSilverZone)).toEqual([GOLD, SILVER]);
  });
});

describe("tradableFeedsFor", () => {
  it("drops silver, because specs.ts role-locks it to confirmation", () => {
    expect(specFor(SILVER).tradable).toBe(false);
    expect(tradableFeedsFor(goldSilverZone)).toEqual([GOLD]);
  });

  it("agrees with the spec table for every registered strategy", () => {
    for (const s of STRATEGIES)
      for (const sym of tradableFeedsFor(s)) expect(specFor(sym).tradable).toBe(true);
  });
});

describe("evidence standing is readable by the UI", () => {
  /* Gold was UNMEASURED until 2026-08-21, when gold-benchmark.ts put it at the
     53.8th percentile of matched random entries across 0-of-9 winning cells.
     "Never tested" and "tested and refuted" are different claims; the badge
     moved, and this pins that it moved rather than merely being dropped. */
  it("marks gold refuted, not unmeasured — the benchmark has now run", () => {
    expect(isRefutedStrategy("gold-silver-zone")).toBe(true);
    expect(isUnmeasured("gold-silver-zone")).toBe(false);
    expect(standingOf("gold-silver-zone")).toBe("refuted");
  });

  it("keeps the two states disjoint, so nothing carries both badges", () => {
    for (const s of STRATEGIES)
      expect(isUnmeasured(s.id) && isRefutedStrategy(s.id)).toBe(false);
  });

  it("gives the refuted strategy real gate evidence to be refused on", () => {
    const ev = REFUTED_STREAM_EVIDENCE["gold-silver-zone"];
    expect(ev).toBeDefined();
    expect(ev.randomEntryPercentile).toBeLessThan(GATE.randomEntryPercentile);
    expect(evaluatePromotion(ev).promote).toBe(false);
  });

  it("still marks the Phase 4 hypotheses unmeasured", () => {
    expect(isUnmeasured("orb-relvol")).toBe(true);
    expect(isUnmeasured("turn-of-month")).toBe(true);
  });

  it("does not smear the label onto measured streams", () => {
    expect(isUnmeasured("zone-v5")).toBe(false);
    expect(isUnmeasured("rsi-reversion")).toBe(false);
  });

  it("names a real strategy for every id in the set", () => {
    for (const s of STRATEGIES) if (isUnmeasured(s.id)) expect(strategyById(s.id).id).toBe(s.id);
  });
});

describe("gold says why when it is handed the wrong market", () => {
  it("notes noGoldSeries instead of returning a silent empty array", () => {
    const reasons: string[] = [];
    const note: SkipNote = (r) => reasons.push(r);
    const ctx = goldSilverZone.prepare({ MES: [], MNQ: [] }, defaultParams(goldSilverZone), {
      cost: 0,
      slippage: 0,
      maxRisk: 100,
      sizing: "risk",
    });
    const out = goldSilverZone.onSnapshot(
      ctx,
      { time: 0, bySymbol: {} },
      defaultParams(goldSilverZone),
      note
    );
    expect(out).toEqual([]);
    expect(reasons).toContain("noGoldSeries");
  });
});
