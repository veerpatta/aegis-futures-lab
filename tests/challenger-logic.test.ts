import { describe, expect, it } from "vitest";
import {
  canonicalParams,
  confirmsFreshWeek,
  confirmsTwoWeeks,
} from "../scripts/engine/challenger-logic";

/* Finding 10: with one row per (week_key, stream), a same-week rerun replaces
   the verdict, so confirmation reads a single current verdict and can't trust a
   retracted one. */

const params = { oversold: 20, overbought: 75, targetR: 2 };

describe("canonicalParams", () => {
  it("is order-independent", () => {
    expect(canonicalParams({ a: 1, b: 2 })).toBe(canonicalParams({ b: 2, a: 1 }));
  });
});

describe("confirmsTwoWeeks", () => {
  it("confirms when last week's single row is a challenger with the same set", () => {
    expect(confirmsTwoWeeks(params, [{ verdict: "challenger", params }])).toBe(true);
  });

  it("does NOT confirm when last week's verdict was retracted to none/insufficient", () => {
    expect(confirmsTwoWeeks(params, [{ verdict: "none", params }])).toBe(false);
    expect(confirmsTwoWeeks(params, [{ verdict: "insufficient-oos", params }])).toBe(false);
  });

  it("does NOT confirm a different param set", () => {
    expect(confirmsTwoWeeks(params, [{ verdict: "challenger", params: { ...params, oversold: 25 } }])).toBe(false);
  });

  it("does NOT confirm with no prior row", () => {
    expect(confirmsTwoWeeks(params, [])).toBe(false);
  });

  it("matches regardless of param key order", () => {
    expect(confirmsTwoWeeks(params, [{ verdict: "challenger", params: { targetR: 2, overbought: 75, oversold: 20 } }])).toBe(true);
  });
});

describe("confirmsFreshWeek", () => {
  const previous = [
    {
      verdict: "challenger",
      params,
      data_cutoff: "2026-07-20T20:00:00.000Z",
    },
  ];

  it("requires at least one newly closed trade beyond the prior cutoff", () => {
    expect(confirmsFreshWeek(params, "2026-07-27T20:00:00.000Z", 1, previous)).toBe(true);
    expect(confirmsFreshWeek(params, "2026-07-27T20:00:00.000Z", 0, previous)).toBe(false);
  });

  it("rejects a stale cutoff or a different parameter set", () => {
    expect(confirmsFreshWeek(params, "2026-07-20T20:00:00.000Z", 4, previous)).toBe(false);
    expect(
      confirmsFreshWeek(
        { ...params, oversold: 25 },
        "2026-07-27T20:00:00.000Z",
        4,
        previous
      )
    ).toBe(false);
  });
});
