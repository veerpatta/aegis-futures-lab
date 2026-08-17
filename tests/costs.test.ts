import { describe, it, expect } from "vitest";
import {
  CONTRACT_SPECS,
  specFor,
  assertTradable,
  LEGACY_MODEL,
  REALISTIC_MODEL,
  ZERO_COST_MODEL,
  roundTripCost,
  baseSlippagePoints,
  frictionDollarsPerContract,
  resolveExecution,
  frictionSpecFor,
  slippagePointsAt,
  nfpTimes,
  firstFridayKey,
} from "@/lib/costs";
import { FEED_SYMBOLS, POINT_VALUES } from "@/lib/market/contracts";
import { EXECUTION } from "@/scripts/engine/tiers";
import { nyMeta, nyTimeToUnix, NY_SESSION_START_MIN } from "@/lib/time/ny";

/* ── The equivalence anchor ──────────────────────────────────────────────
   The whole cost module is only trustworthy if it reproduces the numbers the
   engine has always used. If this block fails, every measured result in
   TUNING_BASELINE is being compared against a different cost model than the
   one that produced it. */
describe("legacy model reproduces EXECUTION exactly", () => {
  const base = { maxRisk: EXECUTION.maxRisk, sizing: EXECUTION.sizing, fillModel: EXECUTION.fillModel };

  /* The SCALARS are still the historical literal, and that is deliberate:
     REALISTIC_MODEL carries the same $1.20/side commission and the same one
     tick as LEGACY_MODEL. What the 2026-08-17 adoption changed is WHERE and
     HOW OFTEN they are charged — both sides instead of entry only, 1.5x at the
     session edges, gapped stops filled at the open — plus the two sizing
     corrections. So a drift in the underlying commission or tick still fails
     here, while the corrections live in fields of their own. */
  it("still charges the literal the baselines were measured with", () => {
    expect(EXECUTION.cost).toBeCloseTo(2.4, 10);
    expect(EXECUTION.slippage).toBeCloseTo(0.25, 10);
    expect(EXECUTION.maxRisk).toBe(160);
    expect(EXECUTION.sizing).toBe("risk");
    expect(EXECUTION.fillModel).toBe("limit");
  });

  it("carries the corrections adopted with the re-measurement", () => {
    /* If any of these is ever silently dropped, the live engine reverts to the
       book Phase 1 refuted while the published figures keep describing the
       corrected one. That mismatch is the thing this file exists to catch. */
    expect(EXECUTION.minStopPoints).toBe(2.0);
    expect(EXECUTION.restingLimitOrders).toBe(true);
    expect(EXECUTION.friction).toBeTruthy();
    expect(EXECUTION.friction!.slipExits).toBe(true);
    expect(EXECUTION.friction!.gapThroughStops).toBe(true);
    expect(EXECUTION.friction!.sizeWithExitSlippage).toBe(true);
  });

  it("derives its scalars from the model for MES", () => {
    const r = resolveExecution(LEGACY_MODEL, "MES", base);
    expect(r.cost).toBeCloseTo(EXECUTION.cost, 10);
    expect(r.slippage).toBeCloseTo(EXECUTION.slippage, 10);
  });

  it("derives its scalars from the model for MNQ", () => {
    // Both micros tick at 0.25, which is why one scalar sufficed until now.
    const r = resolveExecution(LEGACY_MODEL, "MNQ", base);
    expect(r.cost).toBeCloseTo(EXECUTION.cost, 10);
    expect(r.slippage).toBeCloseTo(EXECUTION.slippage, 10);
  });

  /* Catches the realistic failure mode: entering $2.40 as the per-SIDE
     commission instead of the round trip, which doubles every cost silently
     while leaving all the shapes and types correct. */
  it("charges $1.20 per side, not $2.40", () => {
    expect(LEGACY_MODEL.commissionPerSidePerContract).toBe(1.2);
    expect(roundTripCost(LEGACY_MODEL)).toBeCloseTo(2.4, 10);
  });

  it("slips one tick on the entry side only", () => {
    expect(LEGACY_MODEL.entryOnly).toBe(true);
    expect(baseSlippagePoints(LEGACY_MODEL, specFor("MES"))).toBeCloseTo(0.25, 10);
  });
});

/* ── Friction magnitudes ─────────────────────────────────────────────────
   These are the numbers quoted when explaining how much of the measured loss
   is cost. Pinning them means the claim "friction is 14%/28% of the damage"
   cannot drift without a test failing. */
describe("per-contract friction", () => {
  it("legacy: $3.65 MES, $2.90 MNQ", () => {
    expect(frictionDollarsPerContract(LEGACY_MODEL, "MES")).toBeCloseTo(3.65, 10);
    expect(frictionDollarsPerContract(LEGACY_MODEL, "MNQ")).toBeCloseTo(2.9, 10);
  });

  it("realistic: $4.90 MES, $3.40 MNQ", () => {
    expect(frictionDollarsPerContract(REALISTIC_MODEL, "MES")).toBeCloseTo(4.9, 10);
    expect(frictionDollarsPerContract(REALISTIC_MODEL, "MNQ")).toBeCloseTo(3.4, 10);
  });

  it("zero model is actually zero", () => {
    expect(frictionDollarsPerContract(ZERO_COST_MODEL, "MES")).toBe(0);
    expect(frictionDollarsPerContract(ZERO_COST_MODEL, "MNQ")).toBe(0);
    const base = { maxRisk: 160, sizing: "risk" as const, fillModel: "limit" as const };
    expect(resolveExecution(ZERO_COST_MODEL, "MES", base)).toMatchObject({ cost: 0, slippage: 0 });
  });

  /* Even the harsher model cannot account for the measured losses. Stated as
     a test so it cannot quietly stop being true. */
  it("no model's friction approaches the measured per-trade loss", () => {
    expect(frictionDollarsPerContract(REALISTIC_MODEL, "MES")).toBeLessThan(25.75 * 0.25);
    expect(frictionDollarsPerContract(REALISTIC_MODEL, "MNQ")).toBeLessThan(10.54 * 0.5);
  });
});

/* ── Spec table integrity ────────────────────────────────────────────────
   A hand-entered table's realistic failure is a transcription typo, and this
   invariant is what catches it. */
describe("contract specs", () => {
  it("tickValue / tickSize === pointValue for every contract", () => {
    for (const spec of Object.values(CONTRACT_SPECS)) {
      expect(spec.tickValue / spec.tickSize).toBeCloseTo(spec.pointValue, 9);
    }
  });

  /* POINT_VALUES is now DERIVED from these specs, so iterating it against
     specFor would be tautological. The literals live here instead — a second
     source that cannot be shipped half-updated, because a wrong number fails
     the suite rather than quietly repricing an instrument. */
  it("prices every fetchable symbol at the figure the app was built on", () => {
    expect(POINT_VALUES.MES).toBe(5);
    expect(POINT_VALUES.MNQ).toBe(2);
    expect(POINT_VALUES.MGC).toBe(10);
    expect(POINT_VALUES.SI).toBe(5000);
  });

  it("tradable is exactly MES, MNQ and MGC — silver is fetched but never sized", () => {
    const tradable = Object.values(CONTRACT_SPECS)
      .filter((s) => s.tradable)
      .map((s) => s.symbol)
      .sort();
    expect(tradable).toEqual(["MES", "MGC", "MNQ"]);
    for (const spec of Object.values(CONTRACT_SPECS)) {
      // An unverified spec must never be tradable. The converse is allowed:
      // a verified spec may still lack a data feed.
      if (!spec.verified) expect(spec.tradable).toBe(false);
      expect(spec.source.length).toBeGreaterThan(20);
    }
  });

  /* The role is what makes "never traded" legible. SI is watched on purpose;
     SIL is simply unused and carries its own lock against confirmation duty. */
  it("gives every symbol a role, and only tradable roles are tradable", () => {
    expect(CONTRACT_SPECS.SI.role).toBe("confirmation");
    expect(CONTRACT_SPECS.SIL.role).toBe("reference");
    for (const spec of Object.values(CONTRACT_SPECS)) {
      expect(spec.tradable).toBe(spec.role === "tradable");
    }
  });

  it("MGC's citation admits it is empirical, not a CME page", () => {
    /* The file's rule is "do not flip either flag without attaching a citation
       to source". CME was unreachable from the build environment, so the tick
       size was measured from real prices instead. The point of asserting this
       is that the NEXT reader is told which kind of evidence they have. */
    const src = CONTRACT_SPECS.MGC.source;
    expect(src).toMatch(/MEASURED/);
    expect(src).toMatch(/NOT a CME contract page/);
  });

  it("still refuses to size silver, in either contract size", () => {
    expect(() => assertTradable("SIL")).toThrow(/not tradable/);
    expect(() => assertTradable("SI")).toThrow(/not tradable/);
    expect(assertTradable("MES").symbol).toBe("MES");
    expect(assertTradable("MGC").symbol).toBe("MGC");
  });

  it("throws on an unknown symbol rather than defaulting", () => {
    expect(() => specFor("ZZZ")).toThrow(/No contract spec/);
  });
});

/* ── Time-varying slippage ───────────────────────────────────────────────*/
describe("slippagePointsAt", () => {
  const friction = frictionSpecFor(REALISTIC_MODEL, ["MES", "MNQ"]);
  const at = (dateKey: string, minute: number) => nyTimeToUnix(dateKey, minute);

  it("is one tick in the middle of the session", () => {
    expect(slippagePointsAt(friction, "MES", at("2026-06-01", 720))).toBeCloseTo(0.25, 10);
  });

  it("widens 1.5x in the opening 30 minutes", () => {
    const t = at("2026-06-01", NY_SESSION_START_MIN + 5);
    expect(nyMeta(t).minutes).toBe(NY_SESSION_START_MIN + 5);
    expect(slippagePointsAt(friction, "MES", t)).toBeCloseTo(0.375, 10);
  });

  it("widens 1.5x in the closing 30 minutes", () => {
    expect(slippagePointsAt(friction, "MES", at("2026-06-01", 910))).toBeCloseTo(0.375, 10);
  });

  it("is flat everywhere under the legacy model", () => {
    const legacy = frictionSpecFor(LEGACY_MODEL, ["MES", "MNQ"]);
    for (const m of [575, 720, 910]) {
      expect(slippagePointsAt(legacy, "MES", at("2026-06-01", m))).toBeCloseTo(0.25, 10);
    }
  });

  /* This assertion used to read "returns 0 for a symbol the spec does not
     cover", with MGC as the stand-in for "a symbol nobody trades". MGC is now
     traded, and keeping that assertion would have meant shipping a gold stream
     that paid no slippage at all — a clean, plausible, entirely fictional book.

     The property being defended is NOT "uncovered symbols are free". It is
     "friction must be explicit, never assumed". The old code made the
     assumption free and invisible; throwing makes it impossible. That is a
     strictly stronger guarantee, which is why this is a correction and not a
     relaxed threshold. */
  it("throws for a symbol the spec does not cover, rather than charging nothing", () => {
    expect(() => slippagePointsAt(friction, "ZZZ", at("2026-06-01", 720))).toThrow(
      /not covered/
    );
  });

  it("covers every fetchable symbol, so a live stream cannot fill for free", () => {
    for (const s of FEED_SYMBOLS) {
      expect(() => slippagePointsAt(EXECUTION.friction!, s, at("2026-06-01", 720))).not.toThrow();
    }
  });

  /* Overlapping windows must not compound into 2.25x. */
  it("takes the widest applicable window, never the product", () => {
    const overlapping = {
      ...friction,
      openCloseWindows: [
        { fromMin: 570, toMin: 700, mult: 1.5 },
        { fromMin: 600, toMin: 650, mult: 2 },
      ],
    };
    expect(slippagePointsAt(overlapping, "MES", at("2026-06-01", 620))).toBeCloseTo(0.5, 10);
  });
});

/* ── Macro calendar ──────────────────────────────────────────────────────*/
describe("macro releases", () => {
  it("finds the first Friday of a month", () => {
    // 2026-06-05 is the first Friday of June 2026.
    expect(firstFridayKey(2026, 6)).toBe("2026-06-05");
    // 2026-05-01 is itself a Friday.
    expect(firstFridayKey(2026, 5)).toBe("2026-05-01");
  });

  it("lands on 08:30 NY regardless of DST", () => {
    const [winter] = nfpTimes(nyTimeToUnix("2026-01-01", 0), nyTimeToUnix("2026-01-31", 0));
    const [summer] = nfpTimes(nyTimeToUnix("2026-07-01", 0), nyTimeToUnix("2026-07-31", 0));
    expect(nyMeta(winter).minutes).toBe(8 * 60 + 30);
    expect(nyMeta(summer).minutes).toBe(8 * 60 + 30);
  });

  it("returns one release per month over a year", () => {
    const times = nfpTimes(nyTimeToUnix("2025-01-01", 0), nyTimeToUnix("2025-12-31", 23 * 60));
    expect(times).toHaveLength(12);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  /* The multiplier must stay off while the calendar is partial. */
  it("is disabled by default in every shipped model", () => {
    expect(LEGACY_MODEL.macroMult).toBe(1);
    expect(REALISTIC_MODEL.macroMult).toBe(1);
    const spec = frictionSpecFor(REALISTIC_MODEL, ["MES"], [1_700_000_000]);
    expect(spec.macroTimes).toEqual([]);
  });
});

/* ── The descriptor that crosses the worker boundary ─────────────────────*/
describe("frictionSpecFor", () => {
  it("is structured-clone safe (plain data only)", () => {
    const spec = frictionSpecFor(REALISTIC_MODEL, ["MES", "MNQ"]);
    expect(() => structuredClone(spec)).not.toThrow();
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it("turns exit slippage and gap-through on only for non-legacy models", () => {
    expect(frictionSpecFor(LEGACY_MODEL, ["MES"])).toMatchObject({
      slipExits: false,
      sizeWithExitSlippage: false,
      gapThroughStops: false,
    });
    expect(frictionSpecFor(REALISTIC_MODEL, ["MES"])).toMatchObject({
      slipExits: true,
      sizeWithExitSlippage: true,
      gapThroughStops: true,
    });
  });
});
