import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

/* One shared browser client (no auth session — the app is anonymous). */
export function getSupabase(): SupabaseClient {
  if (!client)
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
  return client;
}

/* Row shapes for the tables the dashboard reads. */
export interface SignalRow {
  id: number;
  tier: "A" | "B";
  symbol: string;
  dedupe_key: string;
  timeframe: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  target_price: number | null;
  rr: number | null;
  qty: number | null;
  score: number | null;
  status: "pending" | "triggered" | "hit_target" | "hit_stop" | "expired" | "cancelled";
  reason: string | null;
  signal_ts: string;
  exit_ts: string | null;
  exit_price: number | null;
  pnl_usd: number | null;
  risk_usd: number | null;
  regime: string | null;
  fill_confidence: "clean" | "marginal" | "doubtful" | null;
  vix_bucket: "low" | "high" | null;
  /* Breaker-paused streams: the row still simulates but is hidden from headline
     stats and alerts (shown only in the "paused streams" drawer). Defaults
     false; may be absent on old rows read before the column existed. */
  suppressed?: boolean;
}

/* bot_policy: append-only audit of automatic policy actions (breaker pauses/
   resumes, model graduation/demotion). Current state of a stream = its latest
   row by changed_at. */
export interface BotPolicyRow {
  id: number;
  changed_at: string;
  actor: "breaker" | "model" | "human";
  stream: string;
  action: "paused" | "resumed" | "veto_enabled" | "veto_disabled" | "observe";
  reason: string | null;
  metrics: Record<string, unknown> | null;
}

/* model_registry: one row per nightly training of the win-probability model.
   Latest row = current model + lifecycle status. */
export interface ModelRegistryRow {
  id: number;
  trained_at: string;
  model: string;
  train_n: number | null;
  oos_brier: number | null;
  baseline_brier: number | null;
  calibration: { bin: number; meanPredicted: number; actual: number; n: number }[] | null;
  status: "observe" | "active" | "demoted";
}

/* learned_stats: one versioned row per stat_key per NY trading day, written
   by the nightly learn job (scripts/engine/learn.ts). payload is stat-shaped
   JSON — the /brain page narrows it per stat_key. */
export interface LearnedStatsRow {
  id: number;
  computed_at: string;
  stat_key: string;
  date_key: string;
  payload: unknown;
}

export interface ZoneRow {
  id: number;
  symbol: string;
  timeframe: string;
  zone_type: "demand" | "supply";
  price_high: number;
  price_low: number;
  status: "fresh" | "tested" | "broken";
  fresh: boolean | null;
  achieved: boolean | null;
  blocked80: boolean | null;
  source_candle_ts: string | null;
}

export interface EngineRunRow {
  id: number;
  ran_at: string;
  status: "ok" | "error" | "skipped";
  symbols: string[] | null;
  zones_upserted: number | null;
  signals_created: number | null;
  tier_a_signals: number | null;
  tier_b_signals: number | null;
  duration_ms: number | null;
  source: string | null;
  message: string | null;
}

export interface TradeRow {
  id: number;
  symbol: string;
  direction: "long" | "short" | null;
  qty: number | null;
  entry_ts: string | null;
  entry_price: number | null;
  exit_ts: string | null;
  exit_price: number | null;
  pnl: number | null;
  fees: number | null;
  source: string | null;
  signal_id: number | null;
  notes: string | null;
}
