import { describe, expect, it } from "vitest";
import {
  MIN_CELL_N,
  describeCell,
  describeInvalidation,
  describeSetup,
  describeWinProb,
  historicalCells,
  type ConditionLedger,
  type SignalLike,
} from "@/lib/signals/context";

/* Item 2.8. The rule that matters: a historical cell is NEVER rendered as
   guidance without its sample count, and is explicitly marked insufficient
   below MIN_CELL_N. A win rate on n=3 that looks like a win rate on n=300 is
   worse than no number at all — the condition ledger exists to prevent exactly
   that, so the presentation layer must not undo it. */

const sig = (over: Partial<SignalLike> = {}): SignalLike => ({
  tier: "B",
  symbol: "MNQ",
  direction: "long",
  timeframe: "5m",
  reason: "rsi-reversion: RSI up through 25",
  entry_price: 28242.5,
  stop_price: 28176.57,
  target_price: 28341.39,
  regime: "range-low-vol",
  vix_bucket: "low",
  win_prob: 0.61,
  score: null,
  ...over,
});

const cell = (n: number, winRate = 55, pf: number | null = 1.4) => ({
  n,
  net: 100 * n,
  pf,
  winRate,
  insufficient: n < MIN_CELL_N,
});

const ledger = (over: Partial<ConditionLedger> = {}): ConditionLedger => ({
  tierRegime: { "B·range-low-vol": cell(24) },
  tierVix: { "B·low": cell(18, 50, 1.55) },
  minCell: MIN_CELL_N,
  ...over,
});

describe("describeSetup", () => {
  it("uses the trader-facing half of the engine's reason", () => {
    expect(describeSetup(sig())).toBe("buy — RSI up through 25");
    expect(describeSetup(sig({ direction: "short", reason: "zone-v5: DBR" }))).toBe("sell — DBR");
  });

  it("names the timeframe when it is not the base 5m", () => {
    expect(
      describeSetup(sig({ timeframe: "1H", direction: "short", reason: "zone-v5: RBD" }))
    ).toBe("1H sell — RBD");
    expect(describeSetup(sig({ timeframe: "1H", reason: "zone-v5: DBR" }))).toBe("1H buy — DBR");
  });

  it("falls back to something true when there is no reason", () => {
    expect(describeSetup(sig({ reason: null }))).toBe("buy setup on MNQ");
    expect(describeSetup(sig({ reason: "" }))).toBe("buy setup on MNQ");
  });
});

describe("describeInvalidation", () => {
  it("states the side and the distance, the only unambiguous answer", () => {
    expect(describeInvalidation(sig())).toBe("wrong below 28176.57 (65.93 pts away)");
    expect(describeInvalidation(sig({ direction: "short", entry_price: 100, stop_price: 110 }))).toBe(
      "wrong above 110.00 (10.00 pts away)"
    );
  });
});

describe("describeWinProb", () => {
  it("reports the model's number when there is one", () => {
    expect(describeWinProb(sig())).toBe("the model puts this at about 61% to win");
  });

  it("never invents one", () => {
    expect(describeWinProb(sig({ win_prob: null }))).toBe("the model has not scored this one yet");
    expect(describeWinProb(sig({ win_prob: undefined }))).toBe(
      "the model has not scored this one yet"
    );
  });
});

describe("historicalCells", () => {
  it("matches the tier x regime and tier x VIX cells", () => {
    const cells = historicalCells(ledger(), sig());
    expect(cells).toHaveLength(2);
    expect(cells[0].label).toBe("Tier B in a choppy, quiet market");
    expect(cells[1].label).toBe("Tier B when fear is low");
  });

  it("returns nothing when the ledger has not been built", () => {
    expect(historicalCells(null, sig())).toEqual([]);
  });

  it("returns nothing for a combination with no data, which is not the same as n=0", () => {
    expect(historicalCells(ledger({ tierRegime: {}, tierVix: {} }), sig())).toEqual([]);
  });

  it("skips a slice the signal has no value for", () => {
    const cells = historicalCells(ledger(), sig({ regime: null }));
    expect(cells).toHaveLength(1);
    expect(cells[0].label).toContain("fear");
  });

  it("carries the sample count and required count on EVERY cell", () => {
    for (const h of historicalCells(ledger(), sig())) {
      expect(h.progress).toMatch(/^n=\d+ of 10 needed$/);
      expect(h.cell.n).toBeGreaterThan(0);
    }
  });

  it("flags a thin cell as insufficient", () => {
    const cells = historicalCells(
      ledger({ tierRegime: { "B·range-low-vol": cell(3, 100, null) }, tierVix: {} }),
      sig()
    );
    expect(cells[0].insufficient).toBe(true);
    expect(cells[0].progress).toBe("n=3 of 10 needed");
  });

  it("honours a minCell carried in the payload over the default", () => {
    const cells = historicalCells(
      ledger({ tierRegime: { "B·range-low-vol": cell(24) }, tierVix: {}, minCell: 30 }),
      sig()
    );
    expect(cells[0].insufficient).toBe(true);
    expect(cells[0].progress).toBe("n=24 of 30 needed");
  });
});

describe("describeCell — no bare percentages, ever", () => {
  it("shows the numbers WITH the sample count when the cell is usable", () => {
    const [h] = historicalCells(ledger(), sig());
    const text = describeCell(h);
    expect(text).toContain("55% win rate");
    expect(text).toContain("profit factor 1.40");
    expect(text).toContain("(n=24)");
  });

  it("refuses to show a rate at all when the cell is thin", () => {
    const cells = historicalCells(
      ledger({ tierRegime: { "B·range-low-vol": cell(3, 100, null) }, tierVix: {} }),
      sig()
    );
    const text = describeCell(cells[0]);
    expect(text).toContain("still collecting");
    expect(text).toContain("n=3 of 10 needed");
    expect(text).toContain("too few to judge");
    // The seductive "100%" must not appear anywhere.
    expect(text).not.toContain("100%");
    expect(text).not.toContain("win rate");
  });

  it("handles a usable cell whose win rate is genuinely unknown", () => {
    const cells = historicalCells(
      ledger({ tierRegime: { "B·range-low-vol": { ...cell(20), winRate: null, pf: null } }, tierVix: {} }),
      sig()
    );
    expect(describeCell(cells[0])).toBe(
      "Tier B in a choppy, quiet market: — win rate, profit factor — (n=20)"
    );
  });
});
