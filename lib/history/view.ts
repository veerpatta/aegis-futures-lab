/* Browser-side shape of the public `history_overview` view (db/migrations/
   20261007_historical_study.sql). Totals only: the raw archive bars and the
   per-idea replay rows stay private. Type-only on purpose, so the screens
   never pull the replay or training code into the browser bundle. */

export interface HistInterval {
  est: number;
  lo: number;
  hi: number;
}

export interface HistFold {
  fold: number;
  trainRows: number;
  purgedRows: number;
  testRows: number;
  trainSessions: number;
  testSessions: number;
  testFrom?: string;
  testTo?: string;
  valid: boolean;
}

export interface HistPeriodMetrics {
  nOos: number;
  nSessions: number;
  folds: number;
  delta: HistInterval;
  expectancy: HistInterval;
  randomPct: number;
  stressP95: number;
  costStressNet: number;
  brierC: number;
  brierInc: number;
  brierBase?: number;
  logLossC?: number;
  logLossBase?: number;
  takeRate: number;
  chalNet: number;
  incNet: number;
  maxDrawdown: number;
  selected?: number;
  costs?: number;
  reliability?: { bin: number; meanPredicted: number; actual: number; n: number }[];
  portfolio?: { candidate: { net: number; maxDrawdown: number; trades: number }; incumbent: { net: number; maxDrawdown: number; trades: number } };
}

export interface HistPeriod {
  from: string;
  to: string;
  sessions: number;
  rows: number;
}

export interface HistOverview {
  id: string;
  version: string;
  status: "registered" | "replaying" | "replayed" | "evaluated" | "partial" | "failed";
  status_reason: string | null;
  registered_at: string;
  updated_at: string;
  observation_lag_sec: number;
  research_code_hash: string;
  code_sha: string | null;
  scope: { source: string; symbols: string[]; from: string; to: string; excluded?: { what: string; why: string }[] } | null;
  prior_use: { from: string; to: string; use: string; by: string }[] | null;
  permissions: { source: string; status: string; handling: string; openQuestion?: string }[] | null;
  beginnings: Record<string, { date: string; evidence: string }> | null;
  controls: string[] | null;
  budget_caps: Record<string, number> | null;
  register: Record<string, unknown> | null;
  planned_chunks: number | null;
  registered_trials: { windowSessions: number | null; featureSet: string; l2: number }[];
  split: { development: HistPeriod; validation: HistPeriod; final: HistPeriod } | null;
  dataset: {
    rawExamples: number;
    families: number;
    rows: number;
    sessions: number;
    exclusions: Record<string, number>;
    byStrategy: Record<string, number>;
    bySymbol: Record<string, number>;
    familyAudit?: { legacySignalsInScope: number; legacySignalsMatched: number; shadowRowsInScope: number; shadowRowsMatched: number; note: string };
  } | null;
  dataset_hash: string | null;
  final_accessed_at: string | null;
  budget: { replayActiveMs?: number; lastJob?: { chunks: number; ms: number } } | null;
  chunks: {
    done: number; failed: number; bars: number; bytes: number; runtime_ms: number; ideas: number; gaps: number; missing_bars: number;
    discontinuities: number; ohlc_bad: number; duplicates: number; first_month: string | null; last_month: string | null;
  } | null;
  examples: {
    total: number; observation: number; closed: number; quarantined: number; by_reason: Record<string, number> | null;
    take_all_net_observation: number; take_all_net_strategy: number; first_signal: string | null; last_signal: string | null;
  } | null;
  trials: {
    ordinal: number;
    spec: { windowSessions: number | null; featureSet: string; l2: number };
    status: "registered" | "evaluated" | "failed_coverage" | "invalid" | "selected";
    reason: string | null;
    folds: HistFold[] | null;
    development: HistPeriodMetrics | null;
    validation: HistPeriodMetrics | null;
  }[];
  final: {
    trial_ordinal: number;
    spec: { windowSessions: number | null; featureSet: string; l2: number };
    artifact_id: string;
    artifact_hash: string;
    train_cutoff: string;
    train_rows: number;
    metrics: HistPeriodMetrics;
    verdict: "pass" | "fail" | "inconclusive" | "invalid";
    reasons: string[];
    checks: Record<string, boolean>;
    development_exposed: boolean;
    shadow_eligible: boolean;
    shadow_version_id: string | null;
    shadow_registered_at: string | null;
    evaluated_at: string;
  } | null;
  shadow: {
    version_id: string;
    status: string;
    status_reason: string | null;
    registered_at: string;
    scored: number;
    fresh_closed: number;
    fresh_sessions: number;
    reviews_passed: number;
  } | null;
  legacy_signals: { signals: number; signals_closed: number; signals_net: number; first_signal: string | null; last_signal: string | null } | null;
  legacy_shadows: { shadows: number; shadows_closed: number; shadows_net: number } | null;
  last_run: { status: string; stage: string; started_at: string; finished_at: string | null; message: string | null } | null;
}
