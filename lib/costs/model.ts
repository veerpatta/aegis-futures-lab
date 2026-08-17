/* Transaction cost model.
 *
 * WHAT THIS DOES NOT DO: it does not discover that costs were missing. They
 * were not. lib/backtest/engine.ts:181 has always read
 *
 *     pnl = points * point * qty - execution.cost * qty
 *
 * and every published figure in TUNING_BASELINE is net. What this module adds
 * is (a) one place where the cost assumptions are stated instead of being two
 * bare numbers in tiers.ts, (b) the ability to run the same book at zero cost
 * so gross and net can be reported side by side, and (c) a more realistic
 * model than the legacy one, kept strictly opt-in.
 *
 * The legacy model reverse-engineers exactly to:
 *   commission $1.20 per side per contract  ->  cost 2.40 round trip
 *   1 tick of slippage, ENTRY SIDE ONLY     ->  slippage 0.25 points
 * Both MES and MNQ tick at 0.25, which is why a single scalar `slippage`
 * sufficed for the whole application until now.
 *
 * Per-trade friction at qty=1, the sizing both live streams actually use:
 *              LEGACY    REALISTIC
 *   MES        $3.65     $4.90
 *   MNQ        $2.90     $3.40
 * Against measured losses of $25.75/trade (MES) and $10.54/trade (MNQ), the
 * legacy friction is 14% and 28% of the damage respectively. Neither model
 * explains the losses; that is the point of measuring it rather than assuming.
 */

import type { ExecutionConfig } from "@/lib/strategies/types";
import { NY_SESSION_START_MIN, NY_SESSION_END_MIN } from "@/lib/time/ny";
import { specFor, type ContractSpec } from "./specs";

/** A window of the NY session where slippage is multiplied. */
export interface SlipWindow {
  /** Inclusive, minutes since NY midnight. */
  fromMin: number;
  /** Exclusive. */
  toMin: number;
  mult: number;
}

export interface CostModel {
  id: string;
  label: string;
  /** Dollars per side, per contract. Round trip is twice this. */
  commissionPerSidePerContract: number;
  /** Ticks of slippage per side. */
  slippageTicksPerSide: number;
  /** Legacy behaviour: charge slippage on the entry fill only. */
  entryOnly: boolean;
  /** Empty means no time-of-day variation. */
  openCloseWindows: SlipWindow[];
  /** Multiplier near a scheduled macro release. 1 = off. */
  macroMult: number;
  /** Half-width of the macro window, in seconds. */
  macroWindowSec: number;
}

/* The model that reproduces every number this repo has ever published.
   Changing it invalidates TUNING_BASELINE. */
export const LEGACY_MODEL: CostModel = {
  id: "legacy",
  label: "Legacy (as measured)",
  commissionPerSidePerContract: 1.2,
  slippageTicksPerSide: 1,
  entryOnly: true,
  openCloseWindows: [],
  macroMult: 1,
  macroWindowSec: 0,
};

/* Opt-in, and deliberately NOT adopted by the live tiers in Phase 1 — doing so
   would invalidate every outOfSample provenance string and needs its own
   re-measurement commit.

   The session here is the app's own: 09:30-15:30 NY (NY_SESSION_START_MIN ..
   NY_SESSION_END_MIN), with the engine force-flat at 15:25. So "first and last
   30 minutes" is 570-600 and 900-930.

   macroMult defaults to 1 (off) because there is no historical macro calendar
   in this repo covering 2019-2026 — see macro.ts. A partial calendar applied
   silently would be worse than none. */
export const REALISTIC_MODEL: CostModel = {
  id: "realistic",
  label: "Realistic (both sides, wider at the edges)",
  commissionPerSidePerContract: 1.2,
  slippageTicksPerSide: 1,
  entryOnly: false,
  openCloseWindows: [
    { fromMin: NY_SESSION_START_MIN, toMin: NY_SESSION_START_MIN + 30, mult: 1.5 },
    { fromMin: NY_SESSION_END_MIN - 30, toMin: NY_SESSION_END_MIN, mult: 1.5 },
  ],
  macroMult: 1,
  macroWindowSec: 15 * 60,
};

/* The zero-cost control. Not a "model" anyone should trade — it exists so a
   gross book can be produced by re-running the engine, which is the only
   correct way to get one (see lib/backtest/grossNet.ts). */
export const ZERO_COST_MODEL: CostModel = {
  id: "zero",
  label: "Zero cost (gross control)",
  commissionPerSidePerContract: 0,
  slippageTicksPerSide: 0,
  entryOnly: true,
  openCloseWindows: [],
  macroMult: 1,
  macroWindowSec: 0,
};

export const COST_MODELS: CostModel[] = [LEGACY_MODEL, REALISTIC_MODEL, ZERO_COST_MODEL];

/** Round-trip commission, dollars per contract. */
export function roundTripCost(model: CostModel): number {
  return model.commissionPerSidePerContract * 2;
}

/** Baseline slippage in points, before any time-of-day multiplier. */
export function baseSlippagePoints(model: CostModel, spec: ContractSpec): number {
  return model.slippageTicksPerSide * spec.tickSize;
}

/** Number of sides that pay slippage under this model. */
export function slippedSides(model: CostModel): number {
  return model.entryOnly ? 1 : 2;
}

/* Total modelled friction for one contract, one round trip, at baseline
   slippage. This is the number to quote when explaining how much of a loss is
   cost — it is what tests/costs.test.ts pins at $3.65/$2.90 for legacy. */
export function frictionDollarsPerContract(model: CostModel, symbol: string): number {
  const spec = specFor(symbol);
  return (
    roundTripCost(model) + slippedSides(model) * baseSlippagePoints(model, spec) * spec.pointValue
  );
}

/** Everything in ExecutionConfig that is not a cost assumption. */
export type ExecutionBase = Omit<ExecutionConfig, "cost" | "slippage">;

/* Collapse a model into the scalar ExecutionConfig the engine has always
   taken. This is exact for LEGACY and ZERO. For a model with time-of-day
   variation or exit slippage it produces the BASELINE only — the varying part
   cannot live in a scalar and needs the `friction` descriptor below. */
export function resolveExecution(
  model: CostModel,
  symbol: string,
  base: ExecutionBase,
): ExecutionConfig {
  const spec = specFor(symbol);
  return {
    ...base,
    cost: roundTripCost(model),
    slippage: baseSlippagePoints(model, spec),
  };
}

/* ── The engine descriptor ────────────────────────────────────────────────
   Plain data only: it crosses the web-worker structured-clone boundary in
   lib/backtest/client.ts, so no functions, no class instances.

   Its ABSENCE is the legacy path. Every consumer in engine.ts checks
   `friction !== undefined` before reading it, so a run that does not pass one
   behaves exactly as it did before this module existed — which is what keeps
   the zone-v5 parity tests green.

   That paragraph described code that did not exist for a long time:
   lib/backtest/engine.ts never imported from this module, ExecutionConfig had
   no `friction` field, and frictionSpecFor had no caller outside its own test.
   REALISTIC_MODEL was therefore not "built and deliberately not adopted" —
   it was unreachable, and no flag existed to turn it on. The consumers are
   now real (slipAt / exitSlip / gapThroughStops / sizeWithExitSlippage in
   engine.ts), and tests/friction.test.ts pins both halves: legacy runs are
   byte-identical, and a REALISTIC_MODEL run measurably differs. */
export interface FrictionSpec {
  bySymbol: Record<string, { tickSize: number; slippageTicks: number; pointValue: number }>;
  openCloseWindows: SlipWindow[];
  /** Unix seconds of scheduled macro releases. Empty disables the multiplier. */
  macroTimes: number[];
  macroWindowSec: number;
  macroMult: number;
  /** Charge slippage on market exits too (stop, session, signal). */
  slipExits: boolean;
  /** Include one exit's slippage in the per-contract risk used for sizing. */
  sizeWithExitSlippage: boolean;
  /** Fill a gapped stop at the bar's open rather than at the stop price. */
  gapThroughStops: boolean;
}

export function frictionSpecFor(
  model: CostModel,
  symbols: string[],
  macroTimes: number[] = [],
): FrictionSpec {
  const bySymbol: FrictionSpec["bySymbol"] = {};
  for (const symbol of symbols) {
    const spec = specFor(symbol);
    bySymbol[symbol] = {
      tickSize: spec.tickSize,
      slippageTicks: model.slippageTicksPerSide,
      pointValue: spec.pointValue,
    };
  }
  return {
    bySymbol,
    openCloseWindows: model.openCloseWindows,
    macroTimes: model.macroMult === 1 ? [] : macroTimes,
    macroWindowSec: model.macroWindowSec,
    macroMult: model.macroMult,
    slipExits: !model.entryOnly,
    sizeWithExitSlippage: !model.entryOnly,
    gapThroughStops: !model.entryOnly,
  };
}
