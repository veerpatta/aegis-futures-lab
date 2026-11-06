/* AI research ideas, frozen before the first proposal.

   docs/research/2026-11-07-ai-ideas-preregistration.md is the human copy;
   tests/ai-ideas-rules.test.ts pins this configuration's hash and the
   document's own hash. A change to any rule needs a new version and a new
   preregistration.

   The thresholds are stricter than the second opinion's because up to three
   rules are tested at the same time: more tries mean more chances for luck
   to look like skill. */

import { stableHash } from "@/lib/experiment/hash";
import { DSL_VERSION, FIELDS } from "./dsl";

export const IDEAS_VERSION = "ai-ideas-v1";
export const IDEAS_PROMPT_VERSION = "ai-ideas-prompt-v1";
export const IDEAS_PREREG_DOC = "docs/research/2026-11-07-ai-ideas-preregistration.md";

export interface IdeasLook {
  resolved: number;
  sessions: number;
  /** Two-sided alpha of the session bootstrap interval on the per-idea delta. */
  alpha: number;
  /** Minimum matched-random percentile for a pass. */
  percentile: number;
}

export const IDEAS_RULES = Object.freeze({
  version: IDEAS_VERSION,
  dsl: DSL_VERSION,
  fields: FIELDS,
  maxTesting: 3,
  proposalEveryDays: 7,
  minFinishedForProposal: 20,
  population:
    "Each rule is tested only on decisions of the active learner campaign recorded after the rule was proposed, with a resolved one-contract outcome. Void outcomes and ideas the account could not take even one contract of are excluded, as in the second opinion.",
  comparison:
    "The ideas the rule keeps against take every idea, no trade, and matched random skips of the same number of ideas within each session (seeded by the rule id). The per-idea delta (kept result minus take-all result) gets a session bootstrap interval.",
  bootstrap: Object.freeze({ iterations: 2000, random: 2000 }),
  looks: Object.freeze([
    Object.freeze({ resolved: 60, sessions: 15, alpha: 0.005, percentile: 99.5 }),
    Object.freeze({ resolved: 150, sessions: 15, alpha: 0.015, percentile: 98.5 }),
  ]),
  lookTiming:
    "Each look is taken once, at the first moment its minimum resolved decisions and sessions are both met, on the decisions resolved up to then in decision order. A pass or a fail at a look is final and ends the test.",
  skipRate: Object.freeze({ min: 0.1, max: 0.6 }),
  pass:
    "At a look: the per-idea delta's interval lies above 0, the matched-random percentile is at least the look's, the kept ideas made money after costs, and the rule skipped between 10% and 60% of the ideas.",
  fail: "At a look: the per-idea delta's upper bound is below 0.",
  retire: "A rule is retired after a pass or a fail, at the final look whatever its verdict, or 26 weeks after it was proposed.",
  maxWeeks: 26,
  consequence:
    "A pass only makes the rule eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes the account, the learner or the methods automatically.",
});

export type IdeasRules = typeof IDEAS_RULES;
export const ideasRulesHash = (): string => stableHash(IDEAS_RULES);
