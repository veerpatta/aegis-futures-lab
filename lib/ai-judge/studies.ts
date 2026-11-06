/* The AI second opinion study, frozen before its first call.

   docs/research/2026-11-07-ai-second-opinion-preregistration.md is the human
   copy of these rules. tests/ai-judge-studies.test.ts pins the hash of each
   config, so a change to any rule fails the build and needs a NEW study id
   with its own preregistration (an evaluation whose rules move with its
   results is not an evaluation).

   One study per model: a change of model never mixes evidence. Kimi K3.1 Pro
   is registered now and starts at its first successful answer, so its rules
   are fixed before any of its evidence exists. */

import { stableHash } from "@/lib/experiment/hash";
import { KIMI_K31_PRO, NEMOTRON_ULTRA } from "@/lib/ai-free/nvidia";

export const JUDGE_PROMPT_VERSION = "ai-judge-prompt-v1";
export const JUDGE_FEATURE_VERSION = "ai-judge-features-v1";
export const JUDGE_PREREG_DOC = "docs/research/2026-11-07-ai-second-opinion-preregistration.md";

export interface JudgeLook {
  /** Minimum resolved calls and distinct sessions for this look. */
  resolved: number;
  sessions: number;
  /** Two-sided alpha of the session bootstrap interval on the per-idea delta. */
  alpha: number;
  /** Minimum matched-random percentile for a pass. */
  percentile: number;
}

export interface JudgeRules {
  population: string;
  freshnessSeconds: number;
  freshness: string;
  inputs: string;
  output: string;
  outcome: string;
  controls: readonly string[];
  bootstrap: { iterations: number; random: number };
  looks: readonly JudgeLook[];
  lookTiming: string;
  takeRate: { min: number; max: number };
  pass: string;
  fail: string;
  consequence: string;
}

export interface JudgeStudyConfig {
  id: string;
  label: string;
  model: string;
  promptVersion: string;
  featureVersion: string;
  /** "active" from registration, or waiting until the model's first answer. */
  initialStatus: "active" | "waiting-for-model";
  rules: JudgeRules;
}

export const JUDGE_RULES: JudgeRules = Object.freeze({
  population:
    "Every decision (take or skip, paused methods included) of the active learner campaign recorded at or after the study start.",
  freshnessSeconds: 7200,
  freshness:
    "A decision is asked, and its answer recorded, within two hours of the decision being recorded. The database refuses an answer recorded later.",
  inputs:
    "The idea, the learner's saved features and context from bars_5m bars that ended at or before the decision's information cutoff. Nothing later.",
  output:
    "One JSON object: decision take|skip, confidence 0-100 (rounded to a whole number) and a plain-English reason (asked for at most 60 words). An answer without a usable decision, confidence and reason, including an empty answer, is recorded as invalid and never re-asked. A provider failure (no answer seen) may be retried while the two-hour window is open, at most three attempts. An attempt left without an answer or an error for over 3 minutes (a crash or a failed save) counts as one of the three.",
  outcome:
    "The learner's one-contract shadow result for the decision, after modelled costs (experiment_outcomes.net). Excluded, as in the learner's own dataset: void outcomes (no fill was possible, including cancelled simulations) and ideas the account could not take even one contract of.",
  controls: Object.freeze(["take-all", "no-trade", "matched-random"]),
  bootstrap: Object.freeze({ iterations: 2000, random: 2000 }),
  looks: Object.freeze([
    Object.freeze({ resolved: 60, sessions: 15, alpha: 0.01, percentile: 99 }),
    Object.freeze({ resolved: 150, sessions: 15, alpha: 0.05, percentile: 95 }),
  ]),
  lookTiming:
    "Calls are ordered by when their decision was recorded. A look's window is the shortest prefix of that order with its minimum resolved calls and sessions (excluded calls are skipped). The look is taken only when every call in the window is final and two hours have passed since the window's last decision, so the window can never change. Its result is stored once and never recomputed. A pass or a fail at a look is final. Otherwise the next look follows. The running totals shown between looks are information, not a verdict.",
  takeRate: Object.freeze({ min: 0.1, max: 0.9 }),
  pass:
    "At a look: the per-idea delta (AI picks minus take-all) has its interval's lower bound above 0, the matched-random percentile is at least the look's, the AI's own picks made money after costs, and it took between 10% and 90% of ideas.",
  fail: "At a look: the delta's upper bound is below 0, or the AI's picks made less than take-all while the matched-random percentile is below 50.",
  consequence:
    "A pass only makes an AI filter eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes automatically.",
}) as JudgeRules;

export const NEMOTRON_JUDGE_STUDY: JudgeStudyConfig = Object.freeze({
  id: "ai-judge-nemotron-ultra-v1",
  label: "Nemotron 3 Ultra",
  model: NEMOTRON_ULTRA,
  promptVersion: JUDGE_PROMPT_VERSION,
  featureVersion: JUDGE_FEATURE_VERSION,
  initialStatus: "active",
  rules: JUDGE_RULES,
});

export const KIMI_JUDGE_STUDY: JudgeStudyConfig = Object.freeze({
  id: "ai-judge-kimi-k3.1-pro-v1",
  label: "Kimi K3.1 Pro",
  model: KIMI_K31_PRO,
  promptVersion: JUDGE_PROMPT_VERSION,
  featureVersion: JUDGE_FEATURE_VERSION,
  initialStatus: "waiting-for-model",
  rules: JUDGE_RULES,
});

export const JUDGE_STUDIES: readonly JudgeStudyConfig[] = Object.freeze([NEMOTRON_JUDGE_STUDY, KIMI_JUDGE_STUDY]);

export const studyConfig = (id: string): JudgeStudyConfig | null => JUDGE_STUDIES.find((s) => s.id === id) ?? null;

/** The hash stored with each registration row; the runner refuses a row whose
    stored hash does not match the code. */
export const judgeConfigHash = (config: JudgeStudyConfig): string => stableHash(config);

/** A waiting study's model is probed at most this often. */
export const MODEL_PROBE_INTERVAL_MS = 6 * 3600_000;
