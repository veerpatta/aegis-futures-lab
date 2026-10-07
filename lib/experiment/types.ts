/* Shared shapes for the experimental learner.

   The experimental learner is a virtual-only $10,000 account that takes trade
   ideas on its own, records every take AND every skip, simulates its own fills
   on delayed bars, and learns in batches under fixed, preregistered rules. It
   is evidence collection, not a claim that any method works. It never touches
   the practice account (paper_*), the legacy signal record or the journal, and
   there is no broker and no real-money path anywhere in it.

   This folder is outside the research-code hash on purpose (see
   scripts/engine/research-code.ts): changing the experiment must never restart
   the forward evidence of the methods under test. */

export type ExpSymbol = "MES" | "MNQ";
export type ExpSide = "LONG" | "SHORT";
export const EXP_SYMBOLS: readonly ExpSymbol[] = ["MES", "MNQ"];

/** Where a decision's evidence came from. Only `prospective` rows count as
    fresh evidence; `late` (caught up after the fact), `replay` (archived bars
    fed in time order) and `synthetic` (generated prices) never do. */
export type Provenance = "prospective" | "late" | "replay" | "synthetic";

export type ExperimentMode = "live" | "synthetic";
export type ExperimentStatus = "active" | "paused" | "locked" | "stopped";

/** Why a decision was a skip. Stable codes stored in the database;
    lib/plain/experiment.ts has the words. */
export type SkipReason =
  | "model-skip"
  | "risk-budget"
  | "open-risk"
  | "daily-loss"
  | "locked"
  | "paused"
  | "stale-data"
  | "stop-too-small"
  | "stop-breached"
  | "target-passed"
  | "idea-closed"
  | "session-over"
  | "no-risk"
  | "model-invalid"
  | "quota";

export type DecisionReason = "taken" | SkipReason;

/** A trade idea the experiment may decide on, frozen from a `signals` row. */
export interface Opportunity {
  key: string;
  signalId: number | null;
  symbol: ExpSymbol;
  side: ExpSide;
  entry: number;
  stop: number;
  target: number | null;
  /** Unix seconds of the idea's entry bar. */
  signalTs: number;
  /** Unix seconds the idea first became visible to the experiment. */
  seenAt: number;
  exitTs: number | null;
  strategy: string;
  tier: string | null;
  regime: string | null;
  vixBucket: string | null;
  score: number | null;
  rr: number | null;
}

/** Inputs frozen at decision time. Same layout winprob's ModelRow reads. */
export interface FrozenFeatures {
  tier: string | null;
  regime: string | null;
  vix_bucket: string | null;
  score: number | null;
  rr: number | null;
  signal_ts: string;
  symbol: ExpSymbol;
  strategy: string;
  atr_pct: number | null;
  vwap_atr: number | null;
}

export interface Decision {
  key: string;
  opportunityKey: string;
  signalId: number | null;
  symbol: ExpSymbol;
  side: ExpSide;
  sessionKey: string;
  seenAt: number;
  infoCutoff: number;
  decidedAt: number;
  provenance: Provenance;
  modelVersionId: string;
  pWin: number | null;
  threshold: number | null;
  action: "take" | "skip";
  reason: DecisionReason;
  qty: number;
  estRisk: number | null;
  refPrice: number | null;
  idea: Opportunity;
  features: FrozenFeatures | null;
  featureVersion: string;
  snapshotHash: string;
}

export type PositionStatus = "pending_fill" | "open" | "closed" | "cancelled";
export type ExitReason = "stop" | "target" | "session" | "session-late" | "daily-loss" | "drawdown" | "campaign-end";
export type CancelReason = "stop-breached" | "target-passed" | "stop-too-small" | "session-over" | "risk-budget";

/** The simulated trade. Used for the real ledger (qty from sizing) and for the
    one-contract shadow outcome every decision gets. */
export interface SimTrade {
  symbol: ExpSymbol;
  side: ExpSide;
  qty: number;
  stop: number;
  target: number | null;
  decidedAt: number;
  /** Trading day whose flatten time closes the trade. */
  sessionKey: string;
  status: PositionStatus;
  cancelReason: CancelReason | null;
  fillTs: number | null;
  fillPrice: number | null;
  entrySlip: number | null;
  risk: number | null;
  mark: number | null;
  markTs: number | null;
  stale: boolean;
  exitTs: number | null;
  exitPrice: number | null;
  exitSlip: number | null;
  exitReason: ExitReason | null;
  ambiguous: boolean;
  gross: number | null;
  fees: number | null;
  net: number | null;
}

export interface Position extends SimTrade {
  id: string;
  decisionKey: string;
}

export interface Outcome {
  decisionKey: string;
  status: "pending" | "open" | "closed" | "void";
  voidReason: string | null;
  sim: SimTrade;
  /** Contracts $100 of risk would buy on its own, ignoring portfolio limits. */
  standaloneQty: number;
}

export interface Fill {
  key: string;
  positionId: string;
  kind: "entry" | "exit";
  barTime: number;
  rawPrice: number;
  slippagePoints: number;
  price: number;
  qty: number;
  commission: number;
}

export interface Account {
  equity: number;
  realized: number;
  unrealized: number;
  unpricedPositions: number;
  peak: number;
  dayKey: string;
  dayStartEquity: number;
  dailyPnl: number;
  openRisk: number;
  dayHalted: boolean;
  lockedAt: number | null;
  /** Bar end (unix s) up to which the ledger has been replayed, per symbol. */
  cursor: Partial<Record<ExpSymbol, number>>;
  staleSymbols: ExpSymbol[];
  lastOkTickAt: number | null;
}

/** A frozen decision rule. v1 takes every eligible idea; challengers are
    small logistic filters trained on the experiment's own outcomes. */
export interface TakeAllArtifact {
  schema: "aegis-exp-model/1";
  kind: "take_all";
  id: string;
  rule: string;
}

export interface LogitArtifact {
  schema: "aegis-exp-model/1";
  kind: "logit";
  id: string;
  featureSet: "v1" | "v2";
  featureNames: string[];
  coefficients: number[];
  normalizer: { scoreMean: number; scoreStd: number; rrMean: number; rrStd: number };
  l2: number;
  windowSessions: number | null;
  seed: number;
  threshold: { rule: "ev-breakeven"; tau: number; avgWin: number; avgLoss: number };
  train: { n: number; from: string | null; to: string | null; cutoff: string; datasetId: string | null; rowsHash: string };
}

export type ModelArtifact = TakeAllArtifact | LogitArtifact;

export interface ChallengerSpec {
  windowSessions: number | null;
  featureSet: "v1" | "v2";
  l2: number;
}

export interface ExperimentConfig {
  id: string;
  lineage: string;
  campaign: number;
  mode: ExperimentMode;
  status: ExperimentStatus;
  capital: number;
  /** Unix seconds; ideas before this belong to no campaign. */
  startedAt: number;
  seed: number;
}
