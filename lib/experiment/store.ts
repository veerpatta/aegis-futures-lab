/* Persistence boundary for the experimental learner. jobs.ts talks only to
   this interface; store-pg.ts implements it over Neon Postgres (advisory lock,
   one transaction per batch, append-only tables) and store-memory.ts in memory
   for tests and synthetic runs. */

import type { Bar } from "@/lib/types";
import type { SignalRow } from "@/lib/neon/client";
import type { TickResult } from "./step";
import type { Metrics } from "./evaluate";
import type {
  Account, ChallengerSpec, Decision, ExperimentConfig, ExperimentStatus, ExpSymbol, ModelArtifact, Outcome, Position,
} from "./types";

export type JobName = "tick" | "learn" | "review";
export type Trigger = "neon" | "github" | "manual" | "test";
export type RunStatus = "running" | "ok" | "skipped" | "partial" | "error";
export type VersionStatus = "registered" | "shadowing" | "adopted" | "rejected" | "inconclusive" | "invalid" | "retired" | "rolled_back";

export interface VersionRecord {
  id: string;
  experimentId: string;
  kind: "take_all" | "logit";
  spec: ChallengerSpec | Record<string, never>;
  specHash: string;
  weekKey: string;
  registeredAt: number;
  datasetId: string | null;
  artifact: ModelArtifact | null;
  artifactHash: string | null;
  trainedAt: number | null;
  trainCutoff: number | null;
  status: VersionStatus;
  statusReason: string | null;
}

export interface EvaluationRecord {
  id?: number;
  versionId: string;
  incumbentVersionId: string | null;
  datasetId: string | null;
  kind: "walk_forward" | "monitor";
  windowFrom: number | null;
  windowTo: number | null;
  nOos: number;
  nSessions: number;
  totalOutcomes: number;
  metrics: Partial<Metrics> & Record<string, unknown>;
  seeds: Record<string, number>;
  verdict: "pass" | "fail" | "inconclusive" | "invalid";
  reasons: string[];
  createdAt: number;
}

export type ChangeKind =
  | "created" | "campaign_started" | "paused" | "resumed" | "locked" | "stopped" | "day_halted"
  | "challenger_registered" | "challenger_invalid" | "adopted" | "rejected" | "inconclusive" | "retired" | "rolled_back" | "quota_level";

export interface ChangeRecord {
  id?: number;
  kind: ChangeKind;
  fromStatus?: string | null;
  toStatus?: string | null;
  fromVersion?: string | null;
  toVersion?: string | null;
  reason: string;
  evidence?: Record<string, unknown>;
  actor?: "system" | "owner";
  eventKey: string;
  createdAt?: number;
}

export interface PointerRecord {
  versionId: string;
  previousVersionId: string | null;
  updatedAt: number;
}

export interface ShadowScoreRecord {
  decisionKey: string;
  versionId: string;
  p: number | null;
  wouldTake: boolean;
}

export interface DatasetRecord {
  id: string;
  cutoff: number;
  featureVersion: string;
  rowCount: number;
  decisionKeys: string[];
  rowsHash: string;
  filters: Record<string, unknown>;
  stats: Record<string, unknown>;
  builtAt?: number;
}

export interface TickState {
  exp: ExperimentConfig;
  account: Account;
  positions: Position[];
  outcomes: Outcome[];
  pointer: PointerRecord;
  versions: VersionRecord[];
}

export interface LearnState {
  exp: ExperimentConfig;
  account: Account;
  decisions: Decision[];
  outcomes: Outcome[];
  versions: VersionRecord[];
  evaluations: EvaluationRecord[];
  changes: ChangeRecord[];
  pointer: PointerRecord;
  shadowScores: ShadowScoreRecord[];
  latestDataset: DatasetRecord | null;
}

export interface TickTx {
  load(): Promise<TickState>;
  bars(symbol: ExpSymbol, fromSec: number, toSec: number): Promise<Bar[]>;
  signals(sinceSec: number): Promise<SignalRow[]>;
  decided(opportunityKeys: string[]): Promise<Set<string>>;
  persist(runId: number, state: TickState, result: TickResult, nowSec: number, writeEquity: boolean): Promise<void>;
  /** Swap the pointer back and record why (inside the same transaction). */
  rollback(change: ChangeRecord, toVersion: string, nowSec: number): Promise<void>;
}

export interface LearnTx {
  load(): Promise<LearnState>;
  insertDataset(runId: number, d: DatasetRecord): Promise<void>;
  insertVersion(v: VersionRecord): Promise<void>;
  updateVersion(id: string, patch: Partial<Pick<VersionRecord, "artifact" | "artifactHash" | "trainedAt" | "trainCutoff" | "datasetId" | "status" | "statusReason">>): Promise<void>;
  insertEvaluation(runId: number, e: EvaluationRecord): Promise<void>;
  insertChange(c: ChangeRecord): Promise<number>;
  /** `previous` defaults to the model being replaced; a rollback passes null so
      the rolled-back version can never be restored. */
  swapPointer(toVersion: string, changeId: number, nowSec: number, previous?: string | null): Promise<void>;
  insertEquity(runId: number, kind: "tick" | "eod", asOf: number, account: Account): Promise<void>;
}

export interface ExperimentStore {
  activeExperiment(lineage: string): Promise<ExperimentConfig | null>;
  beginRun(r: { experimentId: string; job: JobName; invocationId: string; trigger: Trigger; scheduledAt: number | null; codeSha: string | null }):
    Promise<{ runId: number; replay: { status: RunStatus; counts: Record<string, unknown>; message: string | null } | null }>;
  finishRun(runId: number, r: { status: RunStatus; counts: Record<string, unknown>; message: string | null; durationMs: number; quotaLevel: string | null; dbBytes: number | null }): Promise<void>;
  quotaInputs(): Promise<{ dbBytes: number | null; monthRunSec: number | null }>;
  tick<T>(experimentId: string, work: (tx: TickTx) => Promise<T>): Promise<T | "busy">;
  learner<T>(experimentId: string, holder: string, work: (tx: LearnTx) => Promise<T>): Promise<T | "busy">;
  setStatus(experimentId: string, to: ExperimentStatus, change: ChangeRecord): Promise<void>;
  /** Register a campaign: experiment, account, the v1 control and the pointer, atomically. */
  createExperiment(input: { exp: ExperimentConfig; risk: Record<string, unknown>; prereg: Record<string, unknown>; preregHash: string; v1: VersionRecord; reason: string }): Promise<void>;
}
