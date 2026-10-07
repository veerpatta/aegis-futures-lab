/* Persistence boundary for the historical study. store-pg.ts implements it
   over Neon (read-only, source-pinned bar reads; writes only history_*);
   store-memory.ts implements it for tests. */

import type { Bar } from "@/lib/types";
import type { ReplayExample, ContextRowLike } from "./replay";
import type { QualityReport } from "./quality";
import type { FoldReport } from "./dataset";
import type { ChallengerSpec, LogitArtifact } from "@/lib/experiment/types";

export type HistStage = "register" | "replay" | "study" | "shadow";
export type StudyStatus = "registered" | "replaying" | "replayed" | "evaluated" | "partial" | "failed";

export interface StudyRow {
  id: string;
  version: string;
  status: StudyStatus;
  statusReason: string | null;
  rules: Record<string, unknown>;
  rulesHash: string;
  manifest: Record<string, unknown>;
  manifestHash: string;
  codeSha: string | null;
  researchCodeHash: string;
  observationLagSec: number;
  trials: ChallengerSpec[];
  split: Record<string, unknown> | null;
  dataset: Record<string, unknown> | null;
  datasetHash: string | null;
  finalAccessedAt: number | null;
  budget: Record<string, unknown>;
  registeredAt: number;
}

export interface ChunkRow {
  symbol: "MES" | "MNQ";
  month: string;
  status: "done" | "failed";
  barsRead: number;
  bytesRead: number;
  barsHash: string | null;
  firstBar: number | null;
  lastBar: number | null;
  quality: Omit<QualityReport, "windows"> & { windows?: number };
  ideas: number;
  examples: number;
  runtimeMs: number;
  error: string | null;
}

export interface TrialRow {
  id?: number;
  ordinal: number;
  spec: ChallengerSpec;
  specHash: string;
  status: "registered" | "evaluated" | "failed_coverage" | "invalid" | "selected";
  folds: FoldReport[] | null;
  development: Record<string, unknown> | null;
  validation: Record<string, unknown> | null;
  reason: string | null;
}

export interface FinalRow {
  trialId: number;
  artifact: LogitArtifact;
  artifactHash: string;
  trainCutoff: number;
  trainRows: number;
  metrics: Record<string, unknown>;
  verdict: "pass" | "fail" | "inconclusive" | "invalid";
  reasons: string[];
  checks: Record<string, boolean>;
  developmentExposed: boolean;
  shadowEligible: boolean;
  shadowVersionId: string | null;
  shadowRegisteredAt: number | null;
}

export interface RegisterFacts {
  coverage: { source: string; symbol: string; from: string; to: string; rows: number }[];
  yahooOverlap: { symbol: string; overlapping: number; mismatched: number; maxDiff: number }[];
  signals: { total: number; withOutcome: number; net: number; first: string | null; last: string | null; firstCreated: string | null };
  shadows: { total: number; withOutcome: number; net: number; first: string | null; last: string | null };
  experimentDecisions: number;
  research: Record<string, number>;
  firstEngineRun: string | null;
  firstExperimentDecision: string | null;
  observationLag: { medianSec: number; p25Sec: number; p75Sec: number; n: number };
  contextCoverage: { from: string | null; to: string | null };
}

export interface HistoryStore {
  latestStudy(version: string): Promise<StudyRow | null>;
  registerStudy(row: Omit<StudyRow, "status" | "statusReason" | "split" | "dataset" | "datasetHash" | "finalAccessedAt" | "budget" | "registeredAt">): Promise<void>;
  updateStudy(id: string, patch: Partial<Pick<StudyRow, "status" | "statusReason" | "split" | "dataset" | "datasetHash" | "finalAccessedAt" | "budget">>): Promise<void>;
  registerFacts(): Promise<RegisterFacts>;
  beginRun(studyId: string, stage: HistStage, invocationId: string): Promise<{ runId: number; replayed: boolean }>;
  finishRun(runId: number, r: { status: "ok" | "partial" | "skipped" | "error"; durationMs: number; bytesRead: number; counts: Record<string, unknown>; message: string | null }): Promise<void>;
  acquireLease(studyId: string, holder: string, ttlSec: number): Promise<boolean>;
  releaseLease(studyId: string, holder: string): Promise<void>;
  chunks(studyId: string): Promise<ChunkRow[]>;
  readBars(symbol: "MES" | "MNQ", source: string, fromSec: number, toSec: number, limit: number): Promise<Bar[]>;
  contextRows(): Promise<ContextRowLike[]>;
  saveChunk(studyId: string, chunk: ChunkRow, examples: ReplayExample[]): Promise<void>;
  examples(studyId: string): Promise<ReplayExample[]>;
  trials(studyId: string): Promise<TrialRow[]>;
  insertTrials(studyId: string, trials: TrialRow[]): Promise<void>;
  updateTrial(studyId: string, ordinal: number, patch: Partial<Pick<TrialRow, "status" | "folds" | "development" | "validation" | "reason">>): Promise<void>;
  final(studyId: string): Promise<(FinalRow & { trialOrdinal: number }) | null>;
  insertFinal(studyId: string, f: FinalRow): Promise<void>;
  setShadow(studyId: string, versionId: string, at: number): Promise<void>;
  /** Keys of legacy signal and shadow rows inside [fromSec, toSec), for the opportunity-family audit. */
  legacyKeys(fromSec: number, toSec: number): Promise<{ signals: string[]; shadows: string[] }>;
  /** Wall-clock milliseconds of every finished replay run of the study (the active-time budget's source of truth). */
  replayRunMs(studyId: string): Promise<number>;
  quotaInputs(): Promise<{ dbBytes: number | null; monthStudyBytes: number | null; monthRunSec: number | null; readAt: number }>;
}
