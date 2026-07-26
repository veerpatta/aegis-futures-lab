import { describe, expect, it } from "vitest";
import {
  MC_P95_ABS_CEILING,
  MC_P95_TOLERANCE,
  pfRank,
  tailGateOk,
  tailGateReason,
  type EvalResult,
} from "../scripts/engine/tune-core";

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

/* The tail gate. MC_P95_TOLERANCE is purely relative, so before the absolute
   ceiling existed a candidate could carry a 33% p95 drawdown and pass simply
   because the incumbent already did — tail risk ratcheting UP 25% at a time with
   nobody ever approving the level. Above MC_P95_ABS_CEILING a candidate must now
   strictly improve. Below it nothing changed.

   The numbers below are chosen so cases 2 and 4 would BOTH have passed the old
   relative-only gate (800 ≤ 700×1.25 and 700 ≤ 700×1.25). They are the cases
   that prove the change rather than restating the tolerance. */
describe("tailGateOk", () => {
  it("ceiling is 20% of the 3,000 book", () => {
    expect(MC_P95_ABS_CEILING).toBe(600);
  });

  it("(1) both under the ceiling and within tolerance — passes", () => {
    expect(tailGateOk(550, 500)).toBe(true);
  });

  it("(2) both above the ceiling, candidate worse than incumbent — rejected", () => {
    expect(800).toBeLessThanOrEqual(700 * MC_P95_TOLERANCE); // the old gate passed this
    expect(tailGateOk(800, 700)).toBe(false);
  });

  it("(3) both above the ceiling, candidate strictly better — passes", () => {
    expect(tailGateOk(700, 800)).toBe(true);
  });

  it("(4) inside tolerance, above the ceiling, merely equal to the incumbent — rejected", () => {
    expect(700).toBeLessThanOrEqual(700 * MC_P95_TOLERANCE); // the old gate passed this
    expect(tailGateOk(700, 700)).toBe(false);
  });

  it("still rejects on the relative leg below the ceiling", () => {
    // 600 is exactly at the ceiling, so only the tolerance leg can reject it.
    expect(tailGateOk(600, 400)).toBe(false);
  });

  it("blocks the measured MNQ challenger (p95 991 vs incumbent 793)", () => {
    // The real autopilot #1 result: it clears the 1.25× tolerance and is still
    // rejected, because both sides sit far above the ceiling and it is worse.
    expect(991).toBeLessThanOrEqual(793 * MC_P95_TOLERANCE);
    expect(tailGateOk(991, 793)).toBe(false);
  });
});

describe("tailGateReason", () => {
  const msg = tailGateReason("os20/ob75/t1.5R", 991, 793);

  it("names the ceiling, so the message cannot drift back to the false '>25% worse' claim", () => {
    expect(msg).toContain("ceiling 600");
    expect(msg).toContain("must strictly improve");
    expect(msg).not.toContain(">25% worse");
  });

  it("prints both p95 numbers and the candidate label", () => {
    expect(msg).toContain("os20/ob75/t1.5R");
    expect(msg).toContain("991");
    expect(msg).toContain("793");
  });
});
