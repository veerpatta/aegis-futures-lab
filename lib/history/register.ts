/* Stage 1 — the history register and the immutable dataset manifest. Pure:
   facts from read-only database aggregates in, a frozen manifest out.

   The register accounts for every retained source (with coverage, overlaps
   and limits), states the three different beginnings and what is still
   unknown, and maps prior use. The manifest freezes the scope, the replay
   assumptions (including the MEASURED observation delay), the split and fold
   rules, the three trial specifications and the budget — before any replay. */

import { stableHash } from "@/lib/experiment/hash";
import { searchSpace } from "@/lib/experiment/search";
import { EXP_RISK, COST_VERSION } from "@/lib/experiment/policy";
import { EXP_FEATURE_VERSION } from "@/lib/experiment/features";
import { PREREG } from "@/lib/experiment/prereg";
import type { ChallengerSpec } from "@/lib/experiment/types";
import { HIST_RULES, registeredTrials, scopeMonths } from "./rules";
import type { RegisterFacts } from "./store";

export interface Manifest {
  study: string;
  version: string;
  register: RegisterFacts & { unknowns: string[]; launch: { firstEngineRun: string | null; firstSignalCreated: string | null; note: string } };
  scope: typeof HIST_RULES.scope;
  observationLagSec: number;
  observationModel: string;
  months: string[];
  plannedChunks: number;
  trials: ChallengerSpec[];
  versions: { features: string; costs: string; risk: string; experimentPrereg: string; studyRules: string };
  researchCodeHash: string;
  codeSha: string | null;
  priorUse: typeof HIST_RULES.priorUse;
  untouchedHistoricalPeriod: string | null;
  permissions: typeof HIST_RULES.permissions;
}

export function buildManifest(input: { studyId: string; facts: RegisterFacts; researchCodeHash: string; codeSha: string | null; rules?: typeof HIST_RULES }): { manifest: Manifest; manifestHash: string; trials: ChallengerSpec[] } {
  const rules = input.rules ?? HIST_RULES;
  const lag = Math.max(300, Math.round(input.facts.observationLag.medianSec));
  const months = scopeMonths(rules.scope.from, rules.scope.to);
  const trials = registeredTrials(searchSpace(PREREG), rules.seed, rules.maxTrials);
  const unknowns = [
    "Exact original production launch: the earliest engine heartbeat and signal row are recorded below, but earlier pre-migration records may be missing.",
    "Archive licence scope for automated training, storage and public redisplay is not verified.",
    "Native contract identities: the archive aggregates continuous-contract one-minute inputs; roll jumps are detected, not mapped.",
    "Exact deduplicated eligible sample size is known only after replay (recorded in the study's dataset).",
    "No genuinely unexamined historical period remains; the decisive test is the new forward period.",
  ];
  const manifest: Manifest = {
    study: input.studyId,
    version: rules.version,
    register: {
      ...input.facts, unknowns,
      launch: {
        firstEngineRun: input.facts.firstEngineRun, firstSignalCreated: input.facts.signals.firstCreated,
        note: "Code history starts 2026-07-17; the archive starts 2019-05-06; the learner started 2026-10-07. None substitutes for another.",
      },
    },
    scope: rules.scope,
    observationLagSec: lag,
    observationModel: `modeled: decided at the first learner check after signal bar + ${Math.round(lag / 60)} min (median of ${input.facts.observationLag.n} live ideas)`,
    months,
    plannedChunks: months.length * rules.scope.symbols.length,
    trials,
    versions: { features: EXP_FEATURE_VERSION, costs: COST_VERSION, risk: EXP_RISK.version, experimentPrereg: PREREG.version, studyRules: rules.version },
    researchCodeHash: input.researchCodeHash,
    codeSha: input.codeSha,
    priorUse: rules.priorUse,
    untouchedHistoricalPeriod: rules.untouchedHistoricalPeriod,
    permissions: rules.permissions,
  };
  return { manifest, manifestHash: stableHash(manifest), trials };
}

export const studyIdFor = (rules = HIST_RULES) => `hist-${rules.version.replace(/^hist-study-/, "")}`;
