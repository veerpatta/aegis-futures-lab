/* The time machine filter test, frozen before any result was computed.

   docs/research/2026-11-12-time-machine-filter-preregistration.md is the
   human copy; tests/tm-filter-rules.test.ts pins this configuration's hash and
   the document's own hash. A change to any rule needs a new version and a new
   preregistration, never an edit of this one. */

import { stableHash } from "@/lib/experiment/hash";

export const TM_FILTER_VERSION = "tm-filter-v1";
export const TM_FILTER_PREREG_DOC = "docs/research/2026-11-12-time-machine-filter-preregistration.md";
export const TM_HIST_STUDY = "tm-filter-v1-historical";
export const TM_FWD_STUDY = "tm-filter-v1-forward";

export interface TmFilterLook {
  resolved: number;
  sessions: number;
  /** Two-sided alpha of the session bootstrap interval on the per-idea delta. */
  alpha: number;
  /** Minimum matched-random percentile for a pass. */
  percentile: number;
}

export const TM_FILTER_RULES = Object.freeze({
  version: TM_FILTER_VERSION,
  rule:
    "Skip an idea when the time machine's average replay result, minus one contract's costs, is below zero, both measured in units of the idea's risk. Take it otherwise, including whenever the time machine cannot run.",
  timeMachine: Object.freeze({ replays: 10_000, seed: 19, window: 2, minSessions: 20, maxSessions: 59, firstMinuteNy: 120, flatMinuteNy: 925, lookbackDays: 95 }),
  inputs:
    "Entry is the close of the last 5-minute bar closed at the decision time (the learner's own reference price). The replay starts at the first bar that starts at or after the decision. Stop and target are the idea's own. Risk is the distance from that entry to the stop. Costs are one contract's round-trip commission plus slippage on both sides at the decision time, from the learner's cost model.",
  noRun: "take" as const,
  scoring: Object.freeze({
    net: "the one-contract result after costs",
    bootstrap: Object.freeze({ iterations: 2000, random: 2000 }),
    skipRate: Object.freeze({ min: 0.1, max: 0.6 }),
    comparison:
      "The ideas the filter keeps against take every idea, no trade, and matched random skips of the same number of ideas within each session (seeded by the study id). The per-idea delta (kept result minus take-all result, skipped ideas counting 0) gets a session bootstrap interval.",
  }),
  historical: Object.freeze({
    sourceStudy: "hist-2026-10-07",
    mode: "observation" as const,
    barSource: "databento",
    population:
      "Every eligible row of the registered historical study's dataset, with its own exclusions, across all three of its periods. Each idea is regenerated from the archive with the study's own code; any regenerated outcome that does not match the stored one stops the test before scoring.",
    pool: "Archive bars only. A day that touches a flagged data-fault window is left out of every pool.",
    look: Object.freeze({ alpha: 0.05, percentile: 95 }),
    label: "development-exposed: earlier research inspected these periods; this filter was not fitted on them",
  }),
  forward: Object.freeze({
    population:
      "Decisions of the active learner campaign recorded after the forward study was registered. Void outcomes and ideas the account could not take one contract of are excluded. A decision whose call was not stored within 24 hours of the decision is excluded and counted.",
    callDeadlineHours: 24,
    looks: Object.freeze([
      Object.freeze({ resolved: 60, sessions: 15, alpha: 0.01, percentile: 99 }),
      Object.freeze({ resolved: 150, sessions: 15, alpha: 0.05, percentile: 95 }),
    ]),
    maxWeeks: 52,
  }),
  pass:
    "The per-idea delta's interval lies above 0, the matched-random percentile is at least the look's, the kept ideas made money after costs, and the filter skipped between 10% and 60% of the ideas.",
  fail: "The per-idea delta's upper bound is below 0.",
  consequence:
    "A historical pass makes the filter eligible to shadow in the learner as a challenger; the learner's own preregistered adoption rules then decide whether it ever takes charge of trades. A historical fail or inconclusive closes this version's path to trades; the forward test still runs, for information. A forward pass makes the filter eligible for a future campaign. Nothing here changes the account, a method's standing or the promotion gate directly.",
});

export type TmFilterRules = typeof TM_FILTER_RULES;

export function tmFilterRulesHash(): string {
  return stableHash(TM_FILTER_RULES);
}
