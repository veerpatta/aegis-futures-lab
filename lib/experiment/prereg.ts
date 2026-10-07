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

/* Version-dispatched rules. A campaign stores the version it was registered
   under (experiments.prereg.version); jobs load THAT rule set, never "whatever
   PREREG says today", so adding a new version can never silently change a
   running campaign's rules. Unknown versions are refused, not defaulted. */
export const PREREG_VERSIONS: Readonly<Record<string, Prereg>> = Object.freeze({ [PREREG.version]: PREREG });

export function rulesFor(version: string | null | undefined): Prereg {
  if (!version) return PREREG;
  const r = PREREG_VERSIONS[version];
  if (!r) throw new Error(`Unknown preregistration version ${version}; refusing to apply other rules.`);
  return r;
}

/* Lifecycle limits for a model version. A version imported from a historical
   study carries its study's lifecycle (it keeps shadowing until its fresh
   window can be judged); every evidence floor still comes from the campaign. */
export function lifecycleFor(campaign: Prereg, origin: { rulesVersion?: string } | null | undefined, imported: Record<string, { shadowWeeks: number; maxInconclusive: number }>) {
  if (origin?.rulesVersion && imported[origin.rulesVersion]) return imported[origin.rulesVersion];
  return campaign.lifecycle;
}

/** Lifecycles of imported shadow candidates, by study rules version.
    tests/history-rules.test.ts pins this to lib/history/rules.ts. */
export const IMPORTED_LIFECYCLES: Readonly<Record<string, { shadowWeeks: number; maxInconclusive: number }>> = Object.freeze({
  "hist-study-2026-10-07": { shadowWeeks: 52, maxInconclusive: 52 },
});
