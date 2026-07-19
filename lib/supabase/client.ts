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
