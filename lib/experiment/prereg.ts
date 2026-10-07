/* The experiment's preregistration: every rule that decides whether a change
   is adopted, rejected or rolled back, written down before any data arrives.
   docs/research/2026-10-07-experiment-preregistration.md explains each number.
   A campaign stores a frozen copy (experiments.prereg) and its hash; changing
   a rule means preregistering a new campaign, never editing a live one.

   These are evidence floors drawn from the existing gates (lib/paper/policy.ts,
   lib/validation/promotionGate.ts), not proof by themselves. */

export const PREREG = Object.freeze({
  version: "exp-prereg-2026-10-07",
  seed: 20261007,
  /** The frozen control the experiment starts from. */
  incumbent: "v1-take-all",
  search: {
    windowSessions: [null, 60, 120] as (number | null)[],
    featureSets: ["v1", "v2"] as ("v1" | "v2")[],
    l2: [0.001, 0.01, 0.1],
    maxPerWeek: 3,
  },
  gates: {
    minOos: 150,
    freshSessions: 20,
    freshDecisions: 60,
    reviewGapDays: 6,
    minNewOutcomes: 10,
    randomPct: 95,
    stressDrawdown: 2000,
    alpha: 0.05,
    bootstrapB: 2000,
    randomR: 1000,
    stressR: 500,
    minTrainRows: 50,
    folds: 5,
    lateThresholdSec: 1800,
  },
  lifecycle: {
    maxInconclusive: 6,
    shadowWeeks: 6,
  },
  rollback: {
    minPost: 30,
    drawdownStop: 1000,
    brierNights: 2,
  },
  /** Synthetic outcomes never count as market evidence. */
  allowSyntheticEvidence: false,
});

export type Prereg = typeof PREREG;
