import { PAPER_RISK } from "@/lib/paper/policy";
import { REALISTIC_MODEL, frictionSpecFor, roundTripCost } from "@/lib/costs/model";
import { slippagePointsAt } from "@/lib/costs/slippage";
import { specFor } from "@/lib/costs/specs";
import type { ExpSymbol, SkipReason } from "./types";

/* The experimental learner's limits.

   Every protective number is the practice account's own rule, imported rather
   than restated: the $10,000 start, $100 most risk on one trade, $200 most
   risk open at once, a $400 daily loss stop and a $2,000 drawdown stop. These
   mirror the full-size practice limits; they are not a recommendation for real
   trading, and a gap through a stop can lose more than the planned risk.

   No martingale and no automatic risk increase: the per-trade budget is a
   fixed cap, and losses only ever shrink what the daily room allows. A drawdown
   stop locks the campaign for good — a fresh campaign has to be preregistered
   and the lifetime totals keep the earlier losses. */
export const EXP_RISK = Object.freeze({
  version: "exp-risk-2026-10-07",
  capital: PAPER_RISK.capital,
  riskPerTrade: PAPER_RISK.riskPerTrade,
  totalOpenRisk: PAPER_RISK.totalOpenRisk,
  dailyLoss: PAPER_RISK.dailyLoss,
  maxDrawdown: PAPER_RISK.maxDrawdown,
  /** Stops tighter than this are skipped (EXECUTION.minStopPoints). */
  minStopPoints: 2,
});

export interface RiskLimits {
  version: string;
  capital: number;
  riskPerTrade: number;
  totalOpenRisk: number;
  dailyLoss: number;
  maxDrawdown: number;
  minStopPoints: number;
  /** v3: when $riskPerTrade buys no contract, ONE contract may still be taken if it
      risks no more than this. Absent on the 2026-10-07 limits (no exception). */
  singleContractMax?: number;
}

/* The v3 campaign limits (2026-11-06). Identical to the 2026-10-07 limits plus one
   exception: an idea whose single contract risks more than $100 but no more than
   $150 (1.5% of the account) may be taken at ONE contract. Micro Nasdaq ideas carry
   50-70 point stops ($100-$145 a contract), so under the strict $100 rule nearly
   every MNQ idea was skipped and, with quantity 0, also left out of learning
   (2 of the 3 skipped on 3-4 November reached their targets). Open risk ($200),
   the $400 daily stop and the $2,000 drawdown lock still bound every trade, so two
   such trades can never be open together. No martingale, no scaling up. */
export const EXP_RISK_V3: RiskLimits = Object.freeze({
  ...EXP_RISK,
  version: "exp-risk-2026-11-06",
  singleContractMax: 150,
});

/** The limits a NEW campaign is registered under. Running campaigns keep their own. */
export const CAMPAIGN_RISK: RiskLimits = EXP_RISK_V3;

export const RISK_VERSIONS: Readonly<Record<string, RiskLimits>> = Object.freeze({
  [EXP_RISK.version]: EXP_RISK,
  [EXP_RISK_V3.version]: EXP_RISK_V3,
});

/** A campaign's registered limits. A campaign without a stored version predates
    versioned limits and keeps the 2026-10-07 ones; an unknown version is refused. */
export function riskFor(version: string | null | undefined): RiskLimits {
  if (!version) return EXP_RISK;
  const r = RISK_VERSIONS[version];
  if (!r) throw new Error(`Unknown risk version ${version}; refusing to apply other limits.`);
  return r;
}

/** The most one trade of `qty` contracts may risk at its fill. */
export function perTradeCap(qty: number, limits: RiskLimits = EXP_RISK): number {
  return qty === 1 && limits.singleContractMax !== undefined ? Math.max(limits.riskPerTrade, limits.singleContractMax) : limits.riskPerTrade;
}

/* The live engine's REALISTIC cost model: $1.20 a side, one tick of slippage
   on both sides, 1.5x at the session edges. Built from lib/costs directly so
   the function bundle need not load the strategy tree; tests pin it equal to
   EXECUTION.friction. Costs are assumptions with a version, not broker quotes. */
export const FRICTION = frictionSpecFor(REALISTIC_MODEL, ["MES", "MNQ"]);
export const COMMISSION_RT = roundTripCost(REALISTIC_MODEL);
export const COST_VERSION = `cost-${REALISTIC_MODEL.id}-2026-08-17`;

export const pointValue = (s: ExpSymbol): number => specFor(s).pointValue;
export const tickSize = (s: ExpSymbol): number => specFor(s).tickSize;
export const slipPoints = (s: ExpSymbol, timeSec: number): number => slippagePointsAt(FRICTION, s, timeSec);

/** Risk of one contract: stop distance plus one exit's slippage, in dollars,
    plus the round-trip commission — how the methods size their ideas. */
export function perContractRisk(symbol: ExpSymbol, entry: number, stop: number, timeSec: number): number {
  return (Math.abs(entry - stop) + slipPoints(symbol, timeSec)) * pointValue(symbol) + COMMISSION_RT;
}

export interface RiskState {
  equity: number;
  peak: number;
  dailyPnl: number;
  openRisk: number;
  locked: boolean;
  dayHalted: boolean;
}

/** Whole contracts for one trade inside the limits, or the reason it is skipped. */
export function sizeExperimentTrade(state: RiskState, contractRisk: number, limits: RiskLimits = EXP_RISK): { qty: number; reason: SkipReason | null } {
  if (![state.equity, state.peak, state.dailyPnl, state.openRisk, contractRisk].every(Number.isFinite) || contractRisk <= 0 || state.openRisk < 0)
    return { qty: 0, reason: "no-risk" };
  if (state.locked || state.peak - state.equity >= limits.maxDrawdown) return { qty: 0, reason: "locked" };
  if (state.dayHalted || state.dailyPnl <= -limits.dailyLoss) return { qty: 0, reason: "daily-loss" };
  const openRoom = limits.totalOpenRisk - state.openRisk;
  const dayRoom = limits.dailyLoss + state.dailyPnl;
  const budget = Math.min(limits.riskPerTrade, openRoom, dayRoom);
  const qty = Math.max(0, Math.floor((budget + 1e-9) / contractRisk));
  if (qty > 0) return { qty, reason: null };
  // v3: one contract above the per-trade budget, never above the single-contract
  // cap and never beyond the room left under the open-risk and daily limits.
  if (limits.singleContractMax !== undefined && contractRisk <= limits.singleContractMax + 1e-9) {
    if (contractRisk <= openRoom + 1e-9 && contractRisk <= dayRoom + 1e-9) return { qty: 1, reason: null };
    return { qty: 0, reason: openRoom < dayRoom ? "open-risk" : "daily-loss" };
  }
  if (openRoom < contractRisk && openRoom < limits.riskPerTrade && openRoom <= dayRoom) return { qty: 0, reason: "open-risk" };
  if (dayRoom < contractRisk && dayRoom < limits.riskPerTrade) return { qty: 0, reason: "daily-loss" };
  return { qty: 0, reason: "risk-budget" };
}

/** Contracts one trade would get on its own (no other trades open) — the shadow
    outcome's size: what $100 buys, or one contract under the v3 exception. */
export function standaloneQty(contractRisk: number, limits: RiskLimits = EXP_RISK): number {
  if (!Number.isFinite(contractRisk) || contractRisk <= 0) return 0;
  const qty = Math.floor((limits.riskPerTrade + 1e-9) / contractRisk);
  if (qty > 0) return qty;
  return limits.singleContractMax !== undefined && contractRisk <= limits.singleContractMax + 1e-9 ? 1 : 0;
}
