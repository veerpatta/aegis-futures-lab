/* The time machine filter's decision for one idea (tm-filter-v1). Pure. Uses
   only what existed at the decision: bars from days before the decision's day,
   and the reference price the learner itself used. */

import { indexDays, timeMachineDays, type TmBar, type TmDay } from "@/lib/timemachine";
import { COMMISSION_RT, pointValue, slipPoints } from "@/lib/experiment/policy";
import type { ExpSymbol } from "@/lib/experiment/types";
import { TM_FILTER_RULES } from "./rules";

export interface FilterIdea {
  symbol: ExpSymbol;
  side: "LONG" | "SHORT";
  stop: number;
  target: number | null;
  /** The learner's reference price: the close of the last bar closed at the decision. */
  refPrice: number;
  decidedAt: number;
}

export type FilterCall =
  | { ok: true; skip: boolean; edgeR: number; avgR: number; costR: number; targetFirst: number; stopFirst: number; neither: number; sessions: number }
  | { ok: false; skip: false; refusal: string };

export function costR(symbol: ExpSymbol, entry: number, stop: number, atSec: number): number {
  const pv = pointValue(symbol);
  return (COMMISSION_RT + 2 * slipPoints(symbol, atSec) * pv) / (Math.abs(entry - stop) * pv);
}

export function filterCall(bars: readonly TmBar[], idea: FilterIdea, rules = TM_FILTER_RULES): FilterCall {
  return filterCallDays(indexDays(bars), idea, rules);
}

/** The same, from days grouped once by `indexDays`. */
export function filterCallDays(days: readonly TmDay[], idea: FilterIdea, rules = TM_FILTER_RULES): FilterCall {
  const t = rules.timeMachine;
  const r = timeMachineDays(
    days,
    { side: idea.side, entry: idea.refPrice, stop: idea.stop, target: idea.target, startSec: idea.decidedAt },
    { replays: t.replays, seed: t.seed, window: t.window, minSessions: t.minSessions, maxSessions: t.maxSessions },
  );
  if (!r.ok) return { ok: false, skip: false, refusal: r.kind === "bad-plan" ? `bad-plan:${r.why}` : r.kind };
  const c = costR(idea.symbol, idea.refPrice, idea.stop, idea.decidedAt);
  const edgeR = r.odds.avgR - c;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    ok: true, skip: edgeR < 0, edgeR: round(edgeR), avgR: round(r.odds.avgR), costR: round(c),
    targetFirst: r.odds.targetFirst, stopFirst: r.odds.stopFirst, neither: r.odds.neither, sessions: r.sessions,
  };
}
