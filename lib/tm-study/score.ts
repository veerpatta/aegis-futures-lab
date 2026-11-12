/* Scoring of the time machine filter (tm-filter-v1). It reuses the AI research
   ideas' scorer unchanged (lib/ai-ideas/score.ts): the kept ideas against take
   every idea, no trade and matched random skips, with a session bootstrap on
   the per-idea delta. Only the thresholds come from this study's frozen rules. */

import { IDEAS_RULES, type IdeasRules } from "@/lib/ai-ideas/rules";
import { dueIdeaLook, evaluateIdeaLook, runningIdea, type IdeaLookResult, type IdeaRow, type IdeaRunning } from "@/lib/ai-ideas/score";
import type { StoredLook } from "@/lib/ai-judge/looks";
import { TM_FILTER_RULES, type TmFilterLook } from "./rules";

export type { IdeaRow as TmRow, IdeaLookResult as TmLookResult };

/** The ideas scorer's settings with this study's bootstrap, skip-rate range and forward looks. */
function scorerRules(looks: readonly TmFilterLook[] = TM_FILTER_RULES.forward.looks): IdeasRules {
  return { ...IDEAS_RULES, bootstrap: TM_FILTER_RULES.scoring.bootstrap, skipRate: TM_FILTER_RULES.scoring.skipRate, looks, maxWeeks: TM_FILTER_RULES.forward.maxWeeks } as unknown as IdeasRules;
}

/** The historical test's one look, on every row at once. */
export function historicalLook(rows: readonly IdeaRow[], studyId: string): IdeaLookResult {
  const sessions = new Set(rows.filter((r) => r.state === "resolved").map((r) => r.session)).size;
  const look = { resolved: rows.length, sessions, ...TM_FILTER_RULES.historical.look };
  return evaluateIdeaLook(rows, 1, look, studyId, scorerRules([look]));
}

/** The forward look that can be taken now, if any. */
export function dueForwardLook(rows: readonly IdeaRow[], stored: readonly StoredLook[], studyId: string, nowSec: number) {
  return dueIdeaLook(rows, stored, studyId, scorerRules(), nowSec);
}

/** Running totals between looks (information, not a verdict). */
export function runningForward(rows: readonly IdeaRow[], studyId: string): IdeaRunning {
  return runningIdea(rows, studyId, scorerRules());
}
