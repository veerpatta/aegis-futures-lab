import { describe, expect, it } from "vitest";
import { pfRank, type EvalResult } from "../scripts/engine/tune-core";

/* Finding 9: a no-loss (perfect) OOS month has null profit factor and must rank
   as the BEST possible, not the worst (the old `?? -1`). A window with no
   trades ranks worst. */

const ev = (pf: number | null, trades: number, net: number): EvalResult => ({ pf, trades, net, pnls: [] });

describe("pfRank", () => {
  it("ranks a profitable no-loss window as +Infinity", () => {
    expect(pfRank(ev(null, 10, 500))).toBe(Infinity);
  });
  it("ranks a no-trade window as worst", () => {
    expect(pfRank(ev(null, 0, 0))).toBe(-Infinity);
  });
  it("a perfect-OOS candidate beats an imperfect incumbent", () => {
    const cand = pfRank(ev(null, 12, 900)); // perfect
    const inc = pfRank(ev(1.2, 20, 400));
    expect(cand > inc).toBe(true);
  });
  it("a perfect incumbent survives a merely-good candidate", () => {
    const inc = pfRank(ev(null, 20, 1200)); // perfect incumbent
    const cand = pfRank(ev(1.3, 15, 800));
    expect(cand > inc).toBe(false);
  });
  it("passes real PFs straight through", () => {
    expect(pfRank(ev(1.5, 10, 300))).toBe(1.5);
  });
});
