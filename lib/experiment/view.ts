/* Browser-side shapes and the three state axes for the experimental learner.

   No Node or database imports: this file is read by the screens. The views it
   types are in db/migrations/20261007_experiment_learner.sql.

   Three separate axes, each with a reason, because one green dot cannot say
   "running but waiting for data" or "trading but learning nothing yet":
   - execution: starting · scanning · managing positions · waiting · paused · blocked · error · unknown
   - learning:  collecting · training · evaluating · candidate ready · accepted · rejected · inconclusive · failed
   - freshness: current · delayed · stale · offline · unavailable
   A missing heartbeat is "unknown", never "running". */

import { engineScheduled, inEntryWindow } from "@/lib/time/session";

export interface ExpPositionRow {
  id: string;
  decision_id: number;
  decision_key: string;
  opportunity_key: string;
  symbol: "MES" | "MNQ";
  side: "LONG" | "SHORT";
  qty: number;
  stop: number;
  target: number | null;
  status: "pending_fill" | "open" | "closed" | "cancelled";
  fill_ts: string | null;
  fill_price: number | null;
  mark: number | null;
  mark_ts: string | null;
  stale: boolean;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  net: number | null;
  risk: number | null;
  decided_at: string;
  provenance: string;
  model_version_id: string;
  idea?: { strategy?: string } | null;
}

export interface ExpOverview {
  lineage: string;
  experiment: { id: string; lineage: string; campaign: number; mode: "live" | "synthetic"; status: "active" | "paused" | "locked" | "stopped"; status_reason: string | null; capital: number; started_at: string; data_label: string };
  risk: { riskPerTrade: number; totalOpenRisk: number; dailyLoss: number; maxDrawdown: number; capital: number } | null;
  account: {
    equity: number; realized: number; unrealized: number; unpriced_positions: number; peak: number; day_key: string; day_start_equity: number;
    daily_pnl: number; open_risk: number; day_halted: boolean; locked_at: string | null; stale_symbols: string[]; last_ok_tick_at: string | null; updated_at: string;
  } | null;
  model: { version_id: string; previous_version_id: string | null; since: string; kind: "take_all" | "logit"; spec: Record<string, unknown>; status: string } | null;
  open_positions: ExpPositionRow[];
  latest_trade: ExpPositionRow | null;
  today_reasons: Record<string, number>;
  today: { closed: number; net: number; wins: number } | null;
  campaign_totals: { closed: number; net: number; wins: number; fees: number } | null;
  lifetime: { campaigns: number; closed: number; net: number; first_start: string | null } | null;
  latest_learning: { id: number; kind: string; from_version: string | null; to_version: string | null; reason: string; created_at: string } | null;
  last_runs: Partial<Record<"tick" | "learn" | "review", { status: string; started_at: string; finished_at: string | null; message: string | null; quota_level: string | null; counts: Record<string, unknown> }>>;
  last_success: Partial<Record<"tick" | "learn" | "review", string>>;
  quota_level: string | null;
  equity_eod: { as_of: string; equity: number; realized: number }[];
  recent_decisions: { id: number; opportunity_key: string; action: "take" | "skip"; reason: string; qty: number; decided_at: string; position_status: string | null; net: number | null }[];
}

export interface ExpTradeRow {
  id: number;
  decision_key: string;
  experiment_id: string;
  opportunity_key: string;
  signal_id: number | null;
  symbol: "MES" | "MNQ";
  side: "LONG" | "SHORT";
  session_key: string;
  seen_at: string;
  info_cutoff: string;
  decided_at: string;
  provenance: "prospective" | "late" | "replay" | "synthetic";
  model_version_id: string;
  p_win: number | null;
  threshold: number | null;
  action: "take" | "skip";
  reason: string;
  qty: number;
  est_risk: number | null;
  ref_price: number | null;
  idea: { entry: number; stop: number; target: number | null; strategy: string; signalTs: number; tier: string | null; regime: string | null; score: number | null; rr: number | null } | null;
  features: Record<string, unknown> | null;
  feature_version: string;
  snapshot_hash: string;
  position_id: string | null;
  position_status: "pending_fill" | "open" | "closed" | "cancelled" | null;
  cancel_reason: string | null;
  fill_ts: string | null;
  fill_price: number | null;
  entry_slip: number | null;
  risk: number | null;
  mark: number | null;
  mark_ts: string | null;
  stale: boolean | null;
  exit_ts: string | null;
  exit_price: number | null;
  exit_slip: number | null;
  exit_reason: string | null;
  ambiguous: boolean | null;
  gross: number | null;
  fees: number | null;
  net: number | null;
  shadow_status: string | null;
  shadow_void_reason: string | null;
  shadow_qty: number | null;
  shadow_exit_reason: string | null;
  shadow_net_per_contract: number | null;
  shadow_ambiguous: boolean | null;
  mode: "live" | "synthetic";
  data_label: string;
  campaign: number;
  lineage: string;
}

export interface ExpLearning {
  lineage: string;
  experiment_id: string;
  mode: "live" | "synthetic";
  prereg: { gates?: Record<string, number>; search?: Record<string, unknown> } | null;
  active_version_id: string | null;
  versions: {
    id: string; kind: "take_all" | "logit"; spec: { windowSessions?: number | null; featureSet?: "v1" | "v2"; l2?: number }; week_key: string; registered_at: string;
    status: string; status_reason: string | null; trained_at: string | null; threshold: { tau: number } | null; train: { n: number } | null;
  }[];
  evaluations: {
    id: number; model_version_id: string; incumbent_version_id: string | null; kind: "walk_forward" | "monitor"; n_oos: number; n_sessions: number; total_outcomes: number;
    metrics: Record<string, unknown>; verdict: "pass" | "fail" | "inconclusive" | "invalid"; reasons: string[]; created_at: string; window_from: string | null; window_to: string | null;
  }[];
  changes: { id: number; kind: string; from_status: string | null; to_status: string | null; from_version: string | null; to_version: string | null; reason: string; evidence: Record<string, unknown>; actor: string; created_at: string }[];
  progress: { closed_outcomes: number; closed_prospective: number; sessions_prospective: number; decisions: number; taken: number } | null;
  latest_dataset: { id: string; built_at: string; cutoff: string; row_count: number; rows_hash: string } | null;
}

export type ExecutionState = "starting" | "scanning" | "managing" | "waiting" | "paused" | "blocked" | "error" | "unknown";
export type LearningState = "collecting" | "training" | "evaluating" | "candidate-ready" | "accepted" | "rejected" | "inconclusive" | "failed";
export type FreshnessState = "current" | "delayed" | "stale" | "offline" | "unavailable";

export interface AxisState<S extends string> {
  state: S;
  reason: string;
}

const sec = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : null);

/** Ticks run at :07, :22, :37 and :52 through the futures week (UTC cron
    in scripts/experiment/triggers.json). Shown as "around", never promised. */
export const TICK_MINUTES = [7, 22, 37, 52];

export function nextTickSec(nowSec: number): number | null {
  for (let i = 1; i <= 4 * 24 * 8; i++) {
    const t = Math.floor(nowSec / 60) * 60 + i * 60;
    if (TICK_MINUTES.includes(new Date(t * 1000).getUTCMinutes()) && engineScheduled(t)) return t;
  }
  return null;
}

export function freshnessState(o: ExpOverview | null, nowSec: number, online: boolean, failed: boolean): AxisState<FreshnessState> {
  if (!online) return { state: "offline", reason: "This phone is offline. Showing the last saved figures, read-only." };
  if (!o || !o.account) return { state: "unavailable", reason: failed ? "The figures could not be read just now." : "Not set up yet." };
  if (o.experiment.mode === "synthetic") return { state: "current", reason: "Synthetic test prices." };
  if (o.account.stale_symbols?.length && inEntryWindow(nowSec))
    return { state: "stale", reason: `No fresh prices for ${o.account.stale_symbols.join(" and ")}. New trades wait for data.` };
  const last = sec(o.account.last_ok_tick_at);
  if (last !== null && engineScheduled(nowSec) && nowSec - last > 45 * 60) return { state: "stale", reason: "The last check is more than 45 minutes old." };
  if (last !== null && engineScheduled(nowSec) && nowSec - last > 20 * 60) return { state: "delayed", reason: "The last check is a little late." };
  return { state: "current", reason: "Prices are as fresh as the delayed feed allows (10–15 minutes old)." };
}

export function executionState(o: ExpOverview | null, nowSec: number): AxisState<ExecutionState> {
  if (!o || !o.account) return { state: "unknown", reason: "No record of the learner yet." };
  const tick = o.last_runs?.tick;
  const lastOk = sec(o.account.last_ok_tick_at);
  if (o.experiment.status === "paused") return { state: "paused", reason: "Paused by the owner. Open trades are still managed; no new ones." };
  if (o.experiment.status === "stopped") return { state: "paused", reason: "This campaign was stopped by the owner." };
  if (o.experiment.status === "locked" || o.account.locked_at) return { state: "blocked", reason: "Stopped for good after losing $2,000 from its best. A new campaign has to be registered." };
  if (o.quota_level === "essential") return { state: "blocked", reason: "Free service limits are nearly used. It waits for the monthly reset rather than spend money." };
  if (!tick) return { state: "starting", reason: "Registered. The first check runs at the next scheduled time." };
  if (tick.status === "error") return { state: "error", reason: "The last check failed. The next one retries from where it stopped." };
  if (engineScheduled(nowSec) && (lastOk === null || nowSec - lastOk > 2 * 3600)) return { state: "unknown", reason: "No check has reported in for over two hours." };
  if (o.open_positions.some((p) => p.status === "open" || p.status === "pending_fill")) return { state: "managing", reason: "Managing open virtual trades." };
  if (!engineScheduled(nowSec)) return { state: "waiting", reason: "Market closed. It wakes up when Globex reopens." };
  if (o.account.day_halted) return { state: "waiting", reason: "Daily loss limit reached. It starts again next session." };
  if (o.account.stale_symbols?.length && inEntryWindow(nowSec)) return { state: "waiting", reason: "No fresh data. New trades wait." };
  if (o.account.open_risk >= (o.risk?.totalOpenRisk ?? 200)) return { state: "waiting", reason: "Most risk allowed at once is already in use." };
  if (!inEntryWindow(nowSec)) return { state: "waiting", reason: "Outside the 02:00–15:25 New York entry window." };
  return { state: "scanning", reason: "Watching for a setup. Quiet hours are normal." };
}

export function learningState(o: ExpOverview | null, l?: ExpLearning | null): AxisState<LearningState> {
  const review = o?.last_runs?.review;
  if (review?.status === "running") return { state: "evaluating", reason: "The weekly review is running now." };
  if (review?.status === "error") return { state: "failed", reason: "The last review failed. The current model stays in charge." };
  if (l) {
    const shadowing = l.versions.filter((v) => v.status === "shadowing");
    const passed = shadowing.filter((v) => l.evaluations.find((e) => e.model_version_id === v.id && e.kind === "walk_forward")?.verdict === "pass");
    if (passed.length) return { state: "candidate-ready", reason: "A new version passed one review. It needs a second one before it can take over." };
  }
  const latest = o?.latest_learning;
  if (latest) {
    if (latest.kind === "adopted") return { state: "accepted", reason: "A tested change was adopted. The old version is kept for rollback." };
    if (latest.kind === "rolled_back") return { state: "failed", reason: "A change was rolled back to the previous version." };
    if (latest.kind === "rejected") return { state: "rejected", reason: "The latest candidate did not beat the current model." };
    if (latest.kind === "inconclusive") return { state: "inconclusive", reason: "Not enough evidence yet to tell. No change applied." };
    if (latest.kind === "challenger_invalid") return { state: "failed", reason: "A candidate failed its checks and was set aside." };
    if (latest.kind === "challenger_registered") return { state: "collecting", reason: "New versions are shadowing the current one on fresh ideas." };
  }
  return { state: "collecting", reason: "Collecting finished trades. Learning needs 50 before it can train anything." };
}

export const isSynthetic = (o: ExpOverview | null) => o?.experiment.mode === "synthetic";
