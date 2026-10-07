/* The experiment's preregistration: every rule that decides whether a change
   is adopted, rejected or rolled back, written down before any data arrives.
   docs/research/2026-10-07-experiment-preregistration.md explains each number.
   A campaign stores a frozen copy (experiments.prereg) and its hash; changing
   a rule means preregistering a new version, never editing a live one.

   These are evidence floors drawn from the existing gates (lib/paper/policy.ts,
   lib/validation/promotionGate.ts), not proof by themselves. */

/** How long a challenger may shadow before it is retired. */
export interface Lifecycle {
  /** Inconclusive reviews in a row (since its last pass) that retire a challenger. */
  maxInconclusive: number;
  /** "all": every inconclusive review counts (the original rule). "informative": only a
      review that already had the minimum out-of-sample outcomes counts — before that,
      "inconclusive" only means "too early to tell". Absent = "all". */
  inconclusiveCounts?: "all" | "informative";
  /** Hard backstop: weeks of shadowing without a passing review. */
  shadowWeeks: number;
  /** Native challengers shadowing at once; a new one is registered only into a free
      slot (the weekly cap still applies). Absent = no cap (the original rule). */
  maxShadowing?: number;
}

/** The campaign registered on 2026-10-07 (learner-1). FROZEN: its hash is stored
    with the campaign and pinned by tests/experiment-amendment.test.ts. */
export const PREREG_2026_10_07 = Object.freeze({
  version: "exp-prereg-2026-10-07" as string,
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
  } as Lifecycle,
  rollback: {
    minPost: 30,
    drawdownStop: 1000,
    brierNights: 2,
  },
  /** Synthetic outcomes never count as market evidence. */
  allowSyntheticEvidence: false,
});

export type Prereg = typeof PREREG_2026_10_07;

/* The lifecycle that lets a challenger reach the fresh window.

   At the measured rate (about 0.7–1 executable idea a trading day) the learner
   needs roughly 50 closed outcomes before it can train anything, about 180 before
   a walk-forward review has 150 out-of-sample results, and 60 fresh decisions
   after a challenger's registration — months, not weeks. Under the original 6
   weeks / 6 inconclusive reviews a native challenger was always retired first,
   and the 18-spec grid was used up within 6 weeks, so nothing could ever be
   adopted. This rule keeps every evidence floor and changes only how long a
   challenger may wait for them, and how many wait at once. */
export const LIFECYCLE_EVIDENCE_HORIZON: Lifecycle = Object.freeze({
  maxInconclusive: 6,
  inconclusiveCounts: "informative",
  shadowWeeks: 52,
  maxShadowing: 3,
});

/** Rules for campaigns registered from now on: the same floors, the reachable lifecycle. */
export const PREREG: Prereg = Object.freeze({
  ...PREREG_2026_10_07,
  version: "exp-prereg-2026-10-07-v2",
  lifecycle: LIFECYCLE_EVIDENCE_HORIZON,
});

/* Version-dispatched rules. A campaign stores the version it was registered
   under (experiments.prereg.version); jobs load THAT rule set, never "whatever
   PREREG says today", so adding a new version can never silently change a
   running campaign's rules. Unknown versions are refused, not defaulted. */
export const PREREG_VERSIONS: Readonly<Record<string, Prereg>> = Object.freeze({
  [PREREG_2026_10_07.version]: PREREG_2026_10_07,
  [PREREG.version]: PREREG,
});

export function rulesFor(version: string | null | undefined): Prereg {
  if (!version) return PREREG;
  const r = PREREG_VERSIONS[version];
  if (!r) throw new Error(`Unknown preregistration version ${version}; refusing to apply other rules.`);
  return r;
}

/* Amendments. A running campaign's stored rules are write-once, so a
   correction is an AMENDMENT: declared here, and in force only once a
   `rules_amended` change row records it in the campaign's append-only history.
   An amendment may touch the lifecycle only — never an evidence floor, the
   search grid, the rollback rule or the risk limits — and it applies only to
   challengers registered AFTER its record (and to search slots from then on),
   so it can never rescue a challenger that has already seen its results. */
export interface Amendment {
  id: string;
  section: "lifecycle";
  lifecycle: Lifecycle;
  reason: string;
}

export const AMENDMENTS: Readonly<Record<string, readonly Amendment[]>> = Object.freeze({
  [PREREG_2026_10_07.version]: [
    {
      id: "exp-amend-2026-10-07-lifecycle",
      section: "lifecycle",
      lifecycle: LIFECYCLE_EVIDENCE_HORIZON,
      reason:
        "Native challengers retired after 6 weeks, before the 150 out-of-sample and 20-session/60-decision fresh floors are reachable at the measured idea rate; the 18-spec grid was used up in 6 weeks. Lifecycle only; every evidence floor unchanged; applies to challengers registered after this record.",
    },
  ],
});

export interface RecordedAmendment {
  amendment: Amendment;
  at: number;
}

const flat = (v: unknown) => (v && typeof v === "object" ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))) : String(v));
const same = (a: unknown, b: unknown) => flat(a) === flat(b);

/** The campaign's recorded amendments, oldest first. A record the code does not
    know, or whose rules differ from the declaration, is refused — never guessed. */
export function recordedAmendments(campaignVersion: string, changes: { kind: string; evidence?: Record<string, unknown>; createdAt?: number }[]): RecordedAmendment[] {
  const known = AMENDMENTS[campaignVersion] ?? [];
  const out: RecordedAmendment[] = [];
  for (const c of changes) {
    if (c.kind !== "rules_amended") continue;
    const ev = (c.evidence ?? {}) as { amendment?: string; section?: string; rules?: unknown };
    const a = known.find((k) => k.id === ev.amendment);
    if (!a) throw new Error(`Recorded amendment ${ev.amendment ?? "(unnamed)"} is not declared for ${campaignVersion}; refusing to guess its rules.`);
    if (ev.section !== a.section || !same(ev.rules, a.lifecycle)) throw new Error(`Recorded amendment ${a.id} does not match its declaration; refusing to apply it.`);
    if (c.createdAt === undefined) throw new Error(`Recorded amendment ${a.id} has no time`);
    out.push({ amendment: a, at: c.createdAt });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** The lifecycle in force at `atSec`: the latest amendment recorded at or before it, else the campaign's own. */
export function lifecycleAt(campaign: Prereg, amendments: readonly RecordedAmendment[], atSec: number): Lifecycle {
  let life = campaign.lifecycle;
  for (const r of amendments) if (r.at <= atSec) life = r.amendment.lifecycle;
  return life;
}

/* Lifecycle limits for one model version. A version imported from a historical
   study carries its study's lifecycle; a native one gets the lifecycle in force
   when it was registered. Every evidence floor still comes from the campaign. */
export function lifecycleFor(
  campaign: Prereg,
  version: { registeredAt: number; origin?: { rulesVersion?: string } | null },
  imported: Readonly<Record<string, Lifecycle>>,
  amendments: readonly RecordedAmendment[] = [],
): Lifecycle {
  const o = version.origin;
  if (o?.rulesVersion && imported[o.rulesVersion]) return imported[o.rulesVersion];
  return lifecycleAt(campaign, amendments, version.registeredAt);
}

/** Lifecycles of imported shadow candidates, by study rules version.
    tests/history-study.test.ts pins this to lib/history/rules.ts. */
export const IMPORTED_LIFECYCLES: Readonly<Record<string, Lifecycle>> = Object.freeze({
  "hist-study-2026-10-07": { shadowWeeks: 52, maxInconclusive: 52 },
});

/** Should a challenger that was not adopted this review be retired? */
export function retirementDecision(input: {
  life: Lifecycle;
  /** This review first, then earlier ones, newest first. */
  reviews: { verdict: string; nOos: number }[];
  minOos: number;
  registeredAt: number;
  nowSec: number;
}): { retire: boolean; reason: "inconclusive-limit" | "shadow-expired" | null; streak: number } {
  const { life, reviews } = input;
  const run = reviews.findIndex((r) => r.verdict !== "inconclusive");
  const sincePass = run === -1 ? reviews : reviews.slice(0, run);
  const streak = life.inconclusiveCounts === "informative" ? sincePass.filter((r) => r.nOos >= input.minOos).length : sincePass.length;
  const tooOld = input.nowSec - input.registeredAt > life.shadowWeeks * 7 * 86400 && reviews[0]?.verdict !== "pass";
  if (tooOld) return { retire: true, reason: "shadow-expired", streak };
  if (streak >= life.maxInconclusive) return { retire: true, reason: "inconclusive-limit", streak };
  return { retire: false, reason: null, streak };
}

/** New native challengers this review may register: the weekly budget, limited to free slots. */
export function challengerSlots(weekBudget: number, life: Lifecycle, nativeShadowing: number): number {
  const free = life.maxShadowing === undefined ? Infinity : Math.max(0, life.maxShadowing - nativeShadowing);
  return Math.max(0, Math.min(weekBudget, free));
}
