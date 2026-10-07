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
export function sizeExperimentTrade(state: RiskState, contractRisk: number): { qty: number; reason: SkipReason | null } {
  if (![state.equity, state.peak, state.dailyPnl, state.openRisk, contractRisk].every(Number.isFinite) || contractRisk <= 0 || state.openRisk < 0)
    return { qty: 0, reason: "no-risk" };
  if (state.locked || state.peak - state.equity >= EXP_RISK.maxDrawdown) return { qty: 0, reason: "locked" };
  if (state.dayHalted || state.dailyPnl <= -EXP_RISK.dailyLoss) return { qty: 0, reason: "daily-loss" };
  const openRoom = EXP_RISK.totalOpenRisk - state.openRisk;
  const dayRoom = EXP_RISK.dailyLoss + state.dailyPnl;
  const budget = Math.min(EXP_RISK.riskPerTrade, openRoom, dayRoom);
  const qty = Math.max(0, Math.floor((budget + 1e-9) / contractRisk));
  if (qty > 0) return { qty, reason: null };
  if (openRoom < contractRisk && openRoom < EXP_RISK.riskPerTrade && openRoom <= dayRoom) return { qty: 0, reason: "open-risk" };
  if (dayRoom < contractRisk && dayRoom < EXP_RISK.riskPerTrade) return { qty: 0, reason: "daily-loss" };
  return { qty: 0, reason: "risk-budget" };
}

/** Contracts $100 of risk buys on its own — the shadow outcome's size. */
export function standaloneQty(contractRisk: number): number {
  return Number.isFinite(contractRisk) && contractRisk > 0 ? Math.floor((EXP_RISK.riskPerTrade + 1e-9) / contractRisk) : 0;
}
