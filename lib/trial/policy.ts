import { PAPER_RISK } from "@/lib/paper/policy";

/* The trial account's limits.

   The account must copy EVERY idea, so it takes each one at the idea's own
   size — the methods size every idea to at most $160 of risk
   (EXECUTION.maxRisk in scripts/engine/tiers.ts; tests/trial.test.ts pins the
   two equal). The practice account's $100 per trade would refuse most Nasdaq
   ideas outright (one MNQ contract typically risks $100–$170), and an account
   that silently skips half the ideas is not a copy of them.

   Everything that protects the account is the practice account's own rule,
   imported rather than restated: the $10,000 start, the $400 daily loss limit
   and the $2,000 drawdown stop. Two full trades may be open at once. */
export const TRIAL_RISK = Object.freeze({
  version: "trial-risk-2026-10-05",
  capital: PAPER_RISK.capital,
  perTrade: 160,
  totalOpenRisk: 320,
  dailyLoss: PAPER_RISK.dailyLoss,
  maxDrawdown: PAPER_RISK.maxDrawdown,
});

export type TrialSkipReason = "daily-loss" | "open-risk" | "risk-budget" | "locked" | "no-risk";

export interface TrialRiskState {
  equity: number;
  peak: number;
  dailyPnl: number;
  openRisk: number;
  locked: boolean;
}

/** Contracts for one idea: the idea's own size, trimmed to what the limits allow. */
export function sizeTrialTrade(state: TrialRiskState, perContractRisk: number, wantedQty: number | null): { qty: number; reason: TrialSkipReason | null } {
  if (![state.equity, state.peak, state.dailyPnl, state.openRisk, perContractRisk].every(Number.isFinite) || perContractRisk <= 0 || state.openRisk < 0)
    return { qty: 0, reason: "no-risk" };
  if (state.locked || state.peak - state.equity >= TRIAL_RISK.maxDrawdown) return { qty: 0, reason: "locked" };
  if (state.dailyPnl <= -TRIAL_RISK.dailyLoss) return { qty: 0, reason: "daily-loss" };
  const openRoom = TRIAL_RISK.totalOpenRisk - state.openRisk;
  const dayRoom = TRIAL_RISK.dailyLoss + state.dailyPnl;
  const budget = Math.min(TRIAL_RISK.perTrade, openRoom, dayRoom);
  const fit = Math.max(0, Math.floor((budget + 1e-9) / perContractRisk));
  const wanted = wantedQty && wantedQty > 0 ? Math.floor(wantedQty) : 1;
  const qty = Math.min(wanted, fit);
  if (qty > 0) return { qty, reason: null };
  if (openRoom < perContractRisk && openRoom <= dayRoom) return { qty: 0, reason: "open-risk" };
  if (dayRoom < perContractRisk) return { qty: 0, reason: "daily-loss" };
  return { qty: 0, reason: "risk-budget" };
}
