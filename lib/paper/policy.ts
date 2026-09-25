import { evaluatePromotion, type PromotionEvidence } from "@/lib/validation/promotionGate";

export const PAPER_RISK = Object.freeze({ version: "paper-risk-2026-09-25", capital: 10000,
  riskPerTrade: 50, probationRisk: 25, totalOpenRisk: 100, dailyLoss: 200, maxDrawdown: 1000 });
export interface ForwardEvidence {
  closed: number; days: number; net: number; pf: number | null;
  fingerprint: string; evaluatedAt: string;
}
export function qualifiesForward(e: ForwardEvidence): boolean {
  return e.closed >= 60 && e.days >= 20 && Number.isFinite(e.net) && e.net > 0 &&
    e.pf !== null && e.pf >= 1.2;
}
export function freshWeeklyEvidence(previous: ForwardEvidence, current: ForwardEvidence): boolean {
  return qualifiesForward(previous) && qualifiesForward(current) &&
    current.closed - previous.closed >= 10 && current.fingerprint !== previous.fingerprint &&
    Date.parse(current.evaluatedAt) - Date.parse(previous.evaluatedAt) >= 6 * 86400000;
}
export function releaseEligible(historical: PromotionEvidence, stressDrawdown: number | null,
  previous: ForwardEvidence | null, current: ForwardEvidence): boolean {
  return evaluatePromotion(historical).promote && stressDrawdown !== null && Number.isFinite(stressDrawdown) &&
    stressDrawdown < PAPER_RISK.maxDrawdown && !!previous && freshWeeklyEvidence(previous, current);
}
export interface RiskState { equity: number; peak: number; dailyPnl: number; openRisk: number; locked: boolean; }
export function sizePaperTrade(state: RiskState, perContractRisk: number, probation = true): { qty: number; reason: string | null } {
  if (![state.equity, state.peak, state.dailyPnl, state.openRisk, perContractRisk].every(Number.isFinite) || perContractRisk <= 0 || state.openRisk < 0)
    return { qty: 0, reason: "Risk information unavailable" };
  if (state.locked || state.peak - state.equity >= PAPER_RISK.maxDrawdown) return { qty: 0, reason: "Drawdown lock: explicit reset required" };
  if (state.dailyPnl <= -PAPER_RISK.dailyLoss) return { qty: 0, reason: "Daily loss limit" };
  const budget = Math.min(probation ? PAPER_RISK.probationRisk : PAPER_RISK.riskPerTrade,
    PAPER_RISK.totalOpenRisk - state.openRisk, PAPER_RISK.dailyLoss + state.dailyPnl);
  const qty = Math.max(0, Math.floor((budget + 1e-9) / perContractRisk));
  return { qty, reason: qty ? null : "One contract exceeds the available risk budget" };
}
