/* The historical study's frozen rules (plan: "Aegis historical learning plan",
   7 October 2026). Registered BEFORE any replay or evaluation; a study row
   stores this object and its hash, and the database refuses edits. A change
   means a new study version, never an edit.

   What this study is for: use the retained archive to prepare a stronger
   paper learner — a small take-or-skip filter over the frozen methods' ideas —
   and then measure it on GENUINELY NEW decisions as a shadow candidate inside
   the live experiment. Historical replay contributes zero fresh sessions.

   This folder is outside the research-code hash: changing the study never
   restarts the forward evidence of the methods under test. */

import { PREREG } from "@/lib/experiment/prereg";
import type { ChallengerSpec } from "@/lib/experiment/types";

export const HIST_RULES = Object.freeze({
  version: "hist-study-2026-10-07",
  seed: 20261008,

  /* Source-pinned scope. The bar key is (symbol, source, time); every read
     pins the source. Yahoo overlaps Databento from 12 May and is compared for
     discrepancies only — never blended into this study. MGC/SI are separate
     instruments and stay out of the MES/MNQ learner. */
  scope: {
    source: "databento" as const,
    symbols: ["MES", "MNQ"] as ("MES" | "MNQ")[],
    from: "2019-05-06",
    to: "2026-09-23",
    excluded: [
      { what: "Yahoo MES/MNQ bars", why: "delayed proxy, usage rights unreviewed; overlap compared, not blended" },
      { what: "Databento MGC/SI bars", why: "separate instruments; not part of the MES/MNQ learner" },
      { what: "Personal journal and browser files", why: "private records; never imported into public research" },
      { what: "Synthetic prices", why: "software validation only, separate lineage" },
    ],
  },

  /* Two named research modes, both through the learner's own decision and
     execution core (lib/experiment/step.ts, execution.ts):
     - strategy replay: decided at the close of the idea's entry bar;
     - observation replay: decided at the first learner check (:07/:22/:37/:52)
       after the idea would have become visible — signal bar + the MEASURED
       median delay of live ideas (frozen at registration). Assumed
       observation times are labelled modeled, not recorded.
     The study trains and judges on observation replay. */
  modes: ["observation", "strategy"] as const,
  primaryMode: "observation" as const,
  tickMinutes: [7, 22, 37, 52],

  /* Chunking and the live engine's view: each (symbol, month) chunk replays
     the frozen tier streams over the month plus 60 days of warm-up (the live
     engine recomputes over 60 days) and a 2-day tail for exits. Only ideas
     whose entry falls inside the month belong to the chunk. */
  warmupDays: 60,
  tailDays: 2,

  /* Data quality. Gaps are never interpolated and discontinuities never
     spliced: an idea whose decision-to-exit window touches a flagged window is
     quarantined (counted, kept as a diagnostic, never trained on). */
  quality: {
    gapMinMissingBars: 2,
    discontinuityAtr: 6,
    discontinuityMinPoints: { MES: 8, MNQ: 40 } as Record<string, number>,
    quarantineLeadSec: 3600,
  },

  /* Chronological partition by eligible trading session, fixed once from the
     session list before any outcome is read: earliest 60% development, next
     20% validation, latest 20% final. Every period here was inspected by
     earlier research (archive through 29 July was development; 30 July–23
     September was the September confirmation), so the final period is
     labelled DEVELOPMENT-EXPOSED, never untouched. The decisive test is the
     new forward period after the candidate is registered. */
  split: { development: 0.6, validation: 0.2, final: 0.2 },
  embargoTradingDays: 5,

  /* Fold coverage, preregistered: every one of the 5 expanding development
     folds must have at least 50 training rows (after window and embargo) and
     at least 10 test rows, or the trial FAILS — it is never scored on the
     folds that happened to survive. */
  folds: { count: 5, minTrainRows: PREREG.gates.minTrainRows, minTestRows: 10 },

  /* Finite trial budget: three specifications from the live experiment's
     18-spec grid, drawn once with this study's seed and listed in the
     manifest before replay. A restart resumes the same trials; it never
     creates another search. Selection: highest validation lower bound of the
     gain over the incumbent among trials that pass fold coverage. */
  maxTrials: 3,

  /* A selected candidate is copied into the live experiment as a SHADOW
     version (never adopted directly) only when fold coverage passed and its
     final-period verdict is pass or inconclusive. Adoption then needs every
     live gate: 150 out-of-sample outcomes, the fresh 20-session / 60-decision
     window and two passing reviews 6+ days apart — historical replay counts
     for none of them. */
  shadowEligibleVerdicts: ["pass", "inconclusive"] as string[],
  /* Lifecycle for an imported shadow candidate. The campaign's 6-week shadow
     limit predates the measured idea rate (about 0.7 executable ideas a day),
     at which a fresh 60-decision window takes months; an imported candidate
     keeps shadowing until the fresh window can be judged. Evidence floors are
     unchanged — they still come from the campaign's own preregistration. */
  importedLifecycle: { shadowWeeks: 52, maxInconclusive: 52 },

  /* Budget caps (proposed conservative application caps, frozen here). */
  budget: {
    maxBarsPerRead: 100_000,
    maxExamplesPerFit: 25_000,
    jobMinutes: 5,
    initialBatchActiveMinutes: 30,
    maxStudyEgressBytes: 1_000_000_000,
    quotaReduce: 0.7,
    quotaStop: 0.85,
    quotaEssential: 0.95,
  },

  /* Prior-use map: who already looked at which period. */
  priorUse: [
    { from: "2019-05-06", to: "2026-07-29", use: "development", by: "Phase 1 and research-v2 measurements (docs/research/2026-07-31, 2026-08-17, 2026-09-25)" },
    { from: "2026-07-30", to: "2026-09-23", use: "confirmation evaluated", by: "25 September archive import and confirmation (docs/research/2026-09-25)" },
    { from: "2026-09-24", to: "2026-10-07", use: "live engine forward period (Yahoo only)", by: "signal engine; outside this study's source scope" },
  ],
  untouchedHistoricalPeriod: null as string | null,

  /* Three different beginnings — never substituted for one another. */
  beginnings: {
    codeHistory: { date: "2026-07-17", evidence: "root commit ac127ffa (2026-07-17 20:57 UTC)" },
    marketArchive: { date: "2019-05-06", evidence: "earliest Databento MES/MNQ bar" },
    experimentalLearner: { date: "2026-10-07", evidence: "learner-1 registered; first decision 09:25 UTC" },
  },

  /* Permissions ledger: what is known, not what is hoped. */
  permissions: [
    {
      source: "Databento MES/MNQ archive",
      status: "owner-purchased; licence scope for automated training, storage and redistribution NOT verified",
      handling: "read server-side only by this study; study tables are private; screens show totals, never raw bars",
      openQuestion: "The existing Data page already reads raw Databento bars through the public Data API. Confirm the licence allows that public redisplay, or restrict it.",
    },
    { source: "Yahoo delayed bars", status: "usage rights unverified", handling: "not used by this study; overlap compared for discrepancies only" },
    { source: "context_daily (VIX)", status: "Yahoo-derived; covers 2025-07-23 onward only", handling: "VIX feature is missing for older examples — a known train/live mismatch, recorded" },
    { source: "Legacy signals and shadow outcomes", status: "app's own records", handling: "audited and mapped to opportunity families; legacy execution outcomes never used as training labels" },
  ],

  /* The incumbent and controls every trial is compared with on the same ideas. */
  controls: ["incumbent take-every-idea", "training base-rate predictor", "no-trade $0", "matched seeded random take/skip"],
});

export type HistRules = typeof HIST_RULES;

export const MONTH_SEC = 31 * 86400;

/** The three registered trial specifications, drawn once with the study seed. */
export function registeredTrials(specs: ChallengerSpec[], seed: number, n: number): ChallengerSpec[] {
  const pool = [...specs];
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  return pool.slice(0, n);
}

/** "YYYY-MM" months covering the scope, oldest first. */
export function scopeMonths(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
