-- Generated from the live Aegis public schema on 2026-09-24.
-- Source: Supabase; target: Neon PostgreSQL 17. Preserve audit constraints and indexes.

CREATE TABLE IF NOT EXISTS public."bars_5m" (
  "symbol" text NOT NULL,
  "time" bigint NOT NULL,
  "open" numeric NOT NULL,
  "high" numeric NOT NULL,
  "low" numeric NOT NULL,
  "close" numeric NOT NULL,
  "volume" bigint DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'yahoo'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public."bot_policy" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor" text NOT NULL,
  "stream" text NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "metrics" jsonb
);

CREATE TABLE IF NOT EXISTS public."challenger_history" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "week_key" text NOT NULL,
  "stream" text NOT NULL,
  "params" jsonb,
  "oos_pf" numeric,
  "oos_net" numeric,
  "mc_p95_dd" numeric,
  "verdict" text NOT NULL,
  "data_cutoff" timestamp with time zone,
  "oos_trades" integer
);

CREATE TABLE IF NOT EXISTS public."context_daily" (
  "date_key" text NOT NULL,
  "vix" numeric,
  "dxy" numeric,
  "tnx" numeric,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."crm_snapshots" (
  "owner_id" text NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."engine_runs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'ok'::text NOT NULL,
  "symbols" text[],
  "zones_upserted" integer DEFAULT 0,
  "signals_created" integer DEFAULT 0,
  "duration_ms" integer,
  "message" text,
  "tier_a_signals" integer DEFAULT 0,
  "tier_b_signals" integer DEFAULT 0,
  "source" text DEFAULT 'github-actions'::text
);

CREATE TABLE IF NOT EXISTS public."journal_entries" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "owner_id" text DEFAULT auth.user_id() NOT NULL,
  "journal_id" text NOT NULL,
  "symbol" text NOT NULL,
  "direction" text NOT NULL,
  "qty" integer NOT NULL,
  "entry_ts" timestamp with time zone NOT NULL,
  "entry_price" numeric NOT NULL,
  "exit_ts" timestamp with time zone NOT NULL,
  "exit_price" numeric NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."learned_stats" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stat_key" text NOT NULL,
  "date_key" text NOT NULL,
  "payload" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public."learning_runs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "cadence" text NOT NULL,
  "status" text NOT NULL,
  "code_sha" text,
  "data_cutoff" timestamp with time zone,
  "feature_version" text,
  "dataset_hash" text,
  "artifact_hash" text,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "gate_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "message" text
);

CREATE TABLE IF NOT EXISTS public."model_registry" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "trained_at" timestamp with time zone DEFAULT now() NOT NULL,
  "model" text DEFAULT 'winprob-logit-v1'::text NOT NULL,
  "coefficients" jsonb,
  "features" jsonb,
  "train_n" integer,
  "oos_brier" numeric,
  "baseline_brier" numeric,
  "calibration" jsonb,
  "status" text DEFAULT 'observe'::text NOT NULL,
  "deployed" boolean DEFAULT false NOT NULL,
  "feature_version" text,
  "code_sha" text,
  "data_cutoff" timestamp with time zone,
  "dataset_hash" text,
  "artifact_hash" text
);

CREATE TABLE IF NOT EXISTS public."promotion_decisions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "candidate_key" text NOT NULL,
  "learning_run_id" bigint,
  "decision" text NOT NULL,
  "reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "code_sha" text
);

CREATE TABLE IF NOT EXISTS public."research_baselines" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "measured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "baseline_key" text NOT NULL,
  "config_hash" text NOT NULL,
  "code_sha" text,
  "bar_source" text NOT NULL,
  "symbol" text NOT NULL,
  "window_from" timestamp with time zone,
  "window_to" timestamp with time zone,
  "sessions" integer,
  "gross" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "net" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "excursion" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "random_entry" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provenance" text NOT NULL
);

CREATE TABLE IF NOT EXISTS public."research_trials" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "registered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "trial_key" text NOT NULL,
  "hypothesis" text NOT NULL,
  "prediction" text NOT NULL,
  "decision_rule" text NOT NULL,
  "config_hash" text NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dataset" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "code_sha" text,
  "status" text DEFAULT 'registered'::text NOT NULL,
  "outcome" jsonb,
  "decided_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public."shadow_signals" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "strategy" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "symbol" text NOT NULL,
  "timeframe" text DEFAULT '5m'::text NOT NULL,
  "direction" text,
  "entry_price" numeric NOT NULL,
  "stop_price" numeric NOT NULL,
  "target_price" numeric,
  "rr" numeric,
  "qty" integer,
  "score" numeric,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "reason" text,
  "signal_ts" timestamp with time zone NOT NULL,
  "exit_ts" timestamp with time zone,
  "exit_price" numeric,
  "pnl_usd" numeric,
  "risk_usd" numeric,
  "regime" text,
  "fill_confidence" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "vix_bucket" text,
  "win_prob" numeric,
  "model_veto" boolean DEFAULT false NOT NULL,
  "stale_data" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public."signal_excursion" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "signal_id" bigint NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "bar_source" text NOT NULL,
  "mae_points" numeric,
  "mfe_points" numeric,
  "atr_at_entry" numeric,
  "mae_atr" numeric,
  "mfe_atr" numeric,
  "mae_r" numeric,
  "mfe_r" numeric,
  "minutes_to_mae" numeric,
  "minutes_to_mfe" numeric,
  "bars_held" integer
);

CREATE TABLE IF NOT EXISTS public."signals" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "symbol" text NOT NULL,
  "timeframe" text DEFAULT '15m'::text NOT NULL,
  "direction" text NOT NULL,
  "entry_price" numeric NOT NULL,
  "stop_price" numeric NOT NULL,
  "target_price" numeric,
  "rr" numeric,
  "zone_id" bigint,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "reason" text,
  "signal_ts" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "tier" text DEFAULT 'A'::text NOT NULL,
  "score" numeric,
  "qty" integer,
  "risk_usd" numeric,
  "target_usd" numeric,
  "exit_ts" timestamp with time zone,
  "exit_price" numeric,
  "pnl_usd" numeric,
  "dedupe_key" text,
  "regime" text,
  "fill_confidence" text,
  "vix_bucket" text,
  "suppressed" boolean DEFAULT false NOT NULL,
  "win_prob" numeric,
  "model_veto" boolean DEFAULT false NOT NULL,
  "stale_data" boolean DEFAULT false NOT NULL,
  "orphaned" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public."trades" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "symbol" text NOT NULL,
  "direction" text,
  "qty" numeric,
  "entry_ts" timestamp with time zone,
  "entry_price" numeric,
  "exit_ts" timestamp with time zone,
  "exit_price" numeric,
  "pnl" numeric,
  "fees" numeric,
  "source" text DEFAULT 'manual'::text,
  "signal_id" bigint,
  "notes" text,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."zones" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "symbol" text NOT NULL,
  "timeframe" text NOT NULL,
  "zone_type" text NOT NULL,
  "price_high" numeric NOT NULL,
  "price_low" numeric NOT NULL,
  "status" text DEFAULT 'fresh'::text NOT NULL,
  "source_candle_ts" timestamp with time zone,
  "touches" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "fresh" boolean,
  "achieved" boolean,
  "blocked80" boolean,
  "score" numeric,
  "active" boolean DEFAULT true,
  "dedupe_key" text
);

ALTER TABLE public."bars_5m" ADD CONSTRAINT "bars_5m_pkey" PRIMARY KEY (symbol, source, "time");
ALTER TABLE public."bot_policy" ADD CONSTRAINT "bot_policy_pkey" PRIMARY KEY (id);
ALTER TABLE public."challenger_history" ADD CONSTRAINT "challenger_history_week_stream_key" UNIQUE (week_key, stream);
ALTER TABLE public."challenger_history" ADD CONSTRAINT "challenger_history_pkey" PRIMARY KEY (id);
ALTER TABLE public."context_daily" ADD CONSTRAINT "context_daily_pkey" PRIMARY KEY (date_key);
ALTER TABLE public."crm_snapshots" ADD CONSTRAINT "crm_snapshots_pkey" PRIMARY KEY (owner_id);
ALTER TABLE public."engine_runs" ADD CONSTRAINT "engine_runs_pkey" PRIMARY KEY (id);
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_owner_entry_unique" UNIQUE (owner_id, journal_id);
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_entries_pkey" PRIMARY KEY (id);
ALTER TABLE public."learned_stats" ADD CONSTRAINT "learned_stats_stat_key_date_key_key" UNIQUE (stat_key, date_key);
ALTER TABLE public."learned_stats" ADD CONSTRAINT "learned_stats_pkey" PRIMARY KEY (id);
ALTER TABLE public."learning_runs" ADD CONSTRAINT "learning_runs_pkey" PRIMARY KEY (id);
ALTER TABLE public."model_registry" ADD CONSTRAINT "model_registry_pkey" PRIMARY KEY (id);
ALTER TABLE public."promotion_decisions" ADD CONSTRAINT "promotion_decisions_pkey" PRIMARY KEY (id);
ALTER TABLE public."research_baselines" ADD CONSTRAINT "research_baselines_baseline_key_config_hash_key" UNIQUE (baseline_key, config_hash);
ALTER TABLE public."research_baselines" ADD CONSTRAINT "research_baselines_pkey" PRIMARY KEY (id);
ALTER TABLE public."research_trials" ADD CONSTRAINT "research_trials_config_hash_key" UNIQUE (config_hash);
ALTER TABLE public."research_trials" ADD CONSTRAINT "research_trials_pkey" PRIMARY KEY (id);
ALTER TABLE public."shadow_signals" ADD CONSTRAINT "shadow_signals_dedupe_key_key" UNIQUE (dedupe_key);
ALTER TABLE public."shadow_signals" ADD CONSTRAINT "shadow_signals_pkey" PRIMARY KEY (id);
ALTER TABLE public."signal_excursion" ADD CONSTRAINT "signal_excursion_signal_id_key" UNIQUE (signal_id);
ALTER TABLE public."signal_excursion" ADD CONSTRAINT "signal_excursion_pkey" PRIMARY KEY (id);
ALTER TABLE public."signals" ADD CONSTRAINT "signals_symbol_direction_zone_id_signal_ts_key" UNIQUE (symbol, direction, zone_id, signal_ts);
ALTER TABLE public."signals" ADD CONSTRAINT "signals_pkey" PRIMARY KEY (id);
ALTER TABLE public."trades" ADD CONSTRAINT "trades_pkey" PRIMARY KEY (id);
ALTER TABLE public."zones" ADD CONSTRAINT "zones_symbol_timeframe_zone_type_price_high_price_low_key" UNIQUE (symbol, timeframe, zone_type, price_high, price_low);
ALTER TABLE public."zones" ADD CONSTRAINT "zones_pkey" PRIMARY KEY (id);
ALTER TABLE public."bars_5m" ADD CONSTRAINT "bars_5m_source_check" CHECK (source = ANY (ARRAY['yahoo'::text, 'databento'::text]));
ALTER TABLE public."bot_policy" ADD CONSTRAINT "bot_policy_action_check" CHECK (action = ANY (ARRAY['paused'::text, 'resumed'::text, 'veto_enabled'::text, 'veto_disabled'::text, 'observe'::text]));
ALTER TABLE public."bot_policy" ADD CONSTRAINT "bot_policy_actor_check" CHECK (actor = ANY (ARRAY['breaker'::text, 'model'::text, 'human'::text]));
ALTER TABLE public."engine_runs" ADD CONSTRAINT "engine_runs_status_check" CHECK (status = ANY (ARRAY['ok'::text, 'error'::text, 'skipped'::text]));
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_entries_direction_check" CHECK (direction = ANY (ARRAY['long'::text, 'short'::text]));
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_entries_entry_price_check" CHECK (entry_price > 0::numeric);
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_entries_exit_price_check" CHECK (exit_price > 0::numeric);
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_entries_qty_check" CHECK (qty > 0);
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_entries_symbol_check" CHECK (symbol = ANY (ARRAY['MES'::text, 'MNQ'::text]));
ALTER TABLE public."journal_entries" ADD CONSTRAINT "journal_exit_after_entry" CHECK (exit_ts >= entry_ts);
ALTER TABLE public."learning_runs" ADD CONSTRAINT "learning_runs_cadence_check" CHECK (cadence = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]));
ALTER TABLE public."learning_runs" ADD CONSTRAINT "learning_runs_status_check" CHECK (status = ANY (ARRAY['running'::text, 'ok'::text, 'blocked'::text, 'error'::text]));
ALTER TABLE public."model_registry" ADD CONSTRAINT "model_registry_status_check" CHECK (status = ANY (ARRAY['observe'::text, 'active'::text, 'demoted'::text]));
ALTER TABLE public."promotion_decisions" ADD CONSTRAINT "promotion_decisions_decision_check" CHECK (decision = ANY (ARRAY['observing'::text, 'canary'::text, 'active'::text, 'rejected'::text, 'rolled_back'::text, 'paused'::text]));
ALTER TABLE public."research_trials" ADD CONSTRAINT "research_trials_status_check" CHECK (status = ANY (ARRAY['registered'::text, 'running'::text, 'complete'::text, 'abandoned'::text]));
ALTER TABLE public."shadow_signals" ADD CONSTRAINT "shadow_signals_direction_check" CHECK (direction = ANY (ARRAY['long'::text, 'short'::text]));
ALTER TABLE public."shadow_signals" ADD CONSTRAINT "shadow_signals_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'triggered'::text, 'hit_target'::text, 'hit_stop'::text, 'closed_win'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE public."signals" ADD CONSTRAINT "signals_direction_check" CHECK (direction = ANY (ARRAY['long'::text, 'short'::text]));
ALTER TABLE public."signals" ADD CONSTRAINT "signals_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'triggered'::text, 'hit_target'::text, 'hit_stop'::text, 'closed_win'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE public."signals" ADD CONSTRAINT "signals_tier_check" CHECK (tier = ANY (ARRAY['A'::text, 'B'::text]));
ALTER TABLE public."trades" ADD CONSTRAINT "trades_direction_check" CHECK (direction = ANY (ARRAY['long'::text, 'short'::text]));
ALTER TABLE public."zones" ADD CONSTRAINT "zones_status_check" CHECK (status = ANY (ARRAY['fresh'::text, 'tested'::text, 'broken'::text]));
ALTER TABLE public."zones" ADD CONSTRAINT "zones_zone_type_check" CHECK (zone_type = ANY (ARRAY['demand'::text, 'supply'::text]));
ALTER TABLE public."promotion_decisions" ADD CONSTRAINT "promotion_decisions_learning_run_id_fkey" FOREIGN KEY (learning_run_id) REFERENCES learning_runs(id) ON DELETE SET NULL;
ALTER TABLE public."signal_excursion" ADD CONSTRAINT "signal_excursion_signal_id_fkey" FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE;
ALTER TABLE public."signals" ADD CONSTRAINT "signals_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE public."trades" ADD CONSTRAINT "trades_signal_id_fkey" FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bot_policy_stream_idx ON public.bot_policy USING btree (stream, changed_at DESC);
CREATE INDEX IF NOT EXISTS challenger_history_stream_idx ON public.challenger_history USING btree (stream, week_key DESC);
CREATE INDEX IF NOT EXISTS engine_runs_ran_at_idx ON public.engine_runs USING btree (ran_at DESC);
CREATE INDEX IF NOT EXISTS journal_entries_owner_entry_idx ON public.journal_entries USING btree (owner_id, entry_ts DESC);
CREATE INDEX IF NOT EXISTS learned_stats_key_date_idx ON public.learned_stats USING btree (stat_key, date_key DESC);
CREATE INDEX IF NOT EXISTS learning_runs_started_idx ON public.learning_runs USING btree (started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS model_registry_one_deployed_idx ON public.model_registry USING btree (deployed) WHERE deployed;
CREATE INDEX IF NOT EXISTS model_registry_trained_idx ON public.model_registry USING btree (trained_at DESC);
CREATE INDEX IF NOT EXISTS promotion_decisions_candidate_idx ON public.promotion_decisions USING btree (candidate_key, created_at DESC);
CREATE INDEX IF NOT EXISTS research_baselines_key_idx ON public.research_baselines USING btree (baseline_key, measured_at DESC);
CREATE INDEX IF NOT EXISTS research_trials_key_idx ON public.research_trials USING btree (trial_key, registered_at DESC);
CREATE INDEX IF NOT EXISTS research_trials_status_idx ON public.research_trials USING btree (status);
CREATE INDEX IF NOT EXISTS shadow_signals_stale_data_idx ON public.shadow_signals USING btree (signal_ts DESC) WHERE stale_data;
CREATE INDEX IF NOT EXISTS shadow_signals_stream_idx ON public.shadow_signals USING btree (strategy, symbol);
CREATE INDEX IF NOT EXISTS shadow_signals_ts_idx ON public.shadow_signals USING btree (signal_ts DESC);
CREATE INDEX IF NOT EXISTS signal_excursion_computed_idx ON public.signal_excursion USING btree (computed_at DESC);
CREATE INDEX IF NOT EXISTS signal_excursion_signal_idx ON public.signal_excursion USING btree (signal_id);
CREATE UNIQUE INDEX IF NOT EXISTS signals_dedupe_key_uq ON public.signals USING btree (dedupe_key);
CREATE INDEX IF NOT EXISTS signals_orphaned_signal_ts_idx ON public.signals USING btree (signal_ts DESC) WHERE (orphaned = true);
CREATE INDEX IF NOT EXISTS signals_signal_ts_idx ON public.signals USING btree (signal_ts DESC);
CREATE INDEX IF NOT EXISTS signals_stale_data_idx ON public.signals USING btree (signal_ts DESC) WHERE stale_data;
CREATE INDEX IF NOT EXISTS signals_status_idx ON public.signals USING btree (status);
CREATE INDEX IF NOT EXISTS signals_symbol_status_idx ON public.signals USING btree (symbol, status, created_at DESC);
CREATE INDEX IF NOT EXISTS signals_zone_id_idx ON public.signals USING btree (zone_id);
CREATE INDEX IF NOT EXISTS trades_signal_id_idx ON public.trades USING btree (signal_id);
CREATE INDEX IF NOT EXISTS trades_symbol_entry_idx ON public.trades USING btree (symbol, entry_ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS zones_dedupe_key_uq ON public.zones USING btree (dedupe_key);
CREATE INDEX IF NOT EXISTS zones_symbol_tf_idx ON public.zones USING btree (symbol, timeframe, status);

CREATE OR REPLACE FUNCTION public.research_baselines_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception
    'research_baselines is append-only: the losing baseline is the control for every later comparison. Insert a new config_hash instead of editing %.',
    old.baseline_key;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.research_trials_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.hypothesis is distinct from old.hypothesis
     or new.prediction is distinct from old.prediction
     or new.decision_rule is distinct from old.decision_rule
     or new.config_hash is distinct from old.config_hash then
    raise exception
      'research_trials: hypothesis, prediction, decision_rule and config_hash are write-once. A prediction that can be edited after the result is not a prediction. Register a new trial instead.';
  end if;
  if old.outcome is not null and new.outcome is distinct from old.outcome then
    raise exception
      'research_trials: outcome is write-once (trial %). Re-running a trial is a new trial and must be counted as one.', old.trial_key;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$
;
CREATE TRIGGER research_baselines_no_edit BEFORE DELETE OR UPDATE ON research_baselines FOR EACH ROW EXECUTE FUNCTION research_baselines_immutable();
CREATE TRIGGER research_trials_write_once BEFORE UPDATE ON research_trials FOR EACH ROW EXECUTE FUNCTION research_trials_guard();
CREATE TRIGGER signals_touch BEFORE UPDATE ON signals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER zones_touch BEFORE UPDATE ON zones FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE public."bars_5m" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."bars_5m" TO anonymous, authenticated;
CREATE POLICY "bars_5m_public_read" ON public."bars_5m" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."bot_policy" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."bot_policy" TO anonymous, authenticated;
CREATE POLICY "bot_policy_public_read" ON public."bot_policy" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."challenger_history" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."challenger_history" TO anonymous, authenticated;
CREATE POLICY "challenger_history_public_read" ON public."challenger_history" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."context_daily" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."context_daily" TO anonymous, authenticated;
CREATE POLICY "context_daily_public_read" ON public."context_daily" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."crm_snapshots" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."crm_snapshots" TO authenticated;
CREATE POLICY "crm_snapshots_owner_select" ON public."crm_snapshots" FOR SELECT TO authenticated USING (auth.user_id() = owner_id);
CREATE POLICY "crm_snapshots_owner_insert" ON public."crm_snapshots" FOR INSERT TO authenticated WITH CHECK (auth.user_id() = owner_id);
CREATE POLICY "crm_snapshots_owner_update" ON public."crm_snapshots" FOR UPDATE TO authenticated USING (auth.user_id() = owner_id) WITH CHECK (auth.user_id() = owner_id);
CREATE POLICY "crm_snapshots_owner_delete" ON public."crm_snapshots" FOR DELETE TO authenticated USING (auth.user_id() = owner_id);
ALTER TABLE public."engine_runs" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."engine_runs" TO anonymous, authenticated;
CREATE POLICY "engine_runs_public_read" ON public."engine_runs" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."journal_entries" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."journal_entries" TO authenticated;
CREATE POLICY "journal_entries_owner_select" ON public."journal_entries" FOR SELECT TO authenticated USING (auth.user_id() = owner_id);
CREATE POLICY "journal_entries_owner_insert" ON public."journal_entries" FOR INSERT TO authenticated WITH CHECK (auth.user_id() = owner_id);
CREATE POLICY "journal_entries_owner_update" ON public."journal_entries" FOR UPDATE TO authenticated USING (auth.user_id() = owner_id) WITH CHECK (auth.user_id() = owner_id);
CREATE POLICY "journal_entries_owner_delete" ON public."journal_entries" FOR DELETE TO authenticated USING (auth.user_id() = owner_id);
ALTER TABLE public."learned_stats" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."learned_stats" TO anonymous, authenticated;
CREATE POLICY "learned_stats_public_read" ON public."learned_stats" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."learning_runs" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."learning_runs" TO anonymous, authenticated;
CREATE POLICY "learning_runs_public_read" ON public."learning_runs" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."model_registry" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."model_registry" TO anonymous, authenticated;
CREATE POLICY "model_registry_public_read" ON public."model_registry" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."promotion_decisions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."promotion_decisions" TO anonymous, authenticated;
CREATE POLICY "promotion_decisions_public_read" ON public."promotion_decisions" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."research_baselines" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."research_baselines" TO anonymous, authenticated;
CREATE POLICY "research_baselines_public_read" ON public."research_baselines" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."research_trials" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."research_trials" TO anonymous, authenticated;
CREATE POLICY "research_trials_public_read" ON public."research_trials" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."shadow_signals" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."shadow_signals" TO anonymous, authenticated;
CREATE POLICY "shadow_signals_public_read" ON public."shadow_signals" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."signal_excursion" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."signal_excursion" TO anonymous, authenticated;
CREATE POLICY "signal_excursion_public_read" ON public."signal_excursion" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."signals" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."signals" TO anonymous, authenticated;
CREATE POLICY "signals_public_read" ON public."signals" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."trades" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."trades" TO anonymous, authenticated;
CREATE POLICY "trades_public_read" ON public."trades" FOR SELECT TO anonymous, authenticated USING (true);
ALTER TABLE public."zones" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."zones" TO anonymous, authenticated;
CREATE POLICY "zones_public_read" ON public."zones" FOR SELECT TO anonymous, authenticated USING (true);
GRANT USAGE ON SCHEMA public TO anonymous, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Additive research and paper release ledger. All writes use the server role.
CREATE TABLE IF NOT EXISTS public.recovery_runs (
  id text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  from_ts timestamptz NOT NULL, as_of timestamptz NOT NULL, source text NOT NULL,
  status text NOT NULL CHECK(status IN ('running','ok','error')), report jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS public.research_observations (
  observation_key text PRIMARY KEY, candidate_key text NOT NULL, strategy_version text NOT NULL,
  source text NOT NULL CHECK(source IN ('yahoo','databento')), provenance text NOT NULL CHECK(provenance IN ('historical-replay','forward')),
  first_seen_at timestamptz NOT NULL DEFAULT now(), signal_ts timestamptz NOT NULL, exit_ts timestamptz,
  payload jsonb NOT NULL, recovery_id text REFERENCES public.recovery_runs(id)
);
CREATE INDEX IF NOT EXISTS research_observations_candidate ON public.research_observations(candidate_key, signal_ts);
ALTER TABLE public.research_observations ADD COLUMN IF NOT EXISTS code_hash text NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE public.research_observations ADD COLUMN IF NOT EXISTS config_hash text NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE public.research_observations ADD COLUMN IF NOT EXISTS intent jsonb;
CREATE TABLE IF NOT EXISTS public.paper_evaluations (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, candidate_key text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(), fingerprint text NOT NULL,
  code_hash text NOT NULL, config_hash text NOT NULL, evidence jsonb NOT NULL,
  UNIQUE(candidate_key, fingerprint)
);
CREATE TABLE IF NOT EXISTS public.paper_account (
  id integer PRIMARY KEY CHECK(id = 1), risk_version text NOT NULL,
  equity numeric NOT NULL DEFAULT 10000, peak numeric NOT NULL DEFAULT 10000,
  day_key text NOT NULL DEFAULT '', daily_pnl numeric NOT NULL DEFAULT 0,
  open_risk numeric NOT NULL DEFAULT 0, locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.paper_account(id, risk_version) VALUES(1, 'paper-risk-2026-09-25') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.paper_releases (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, candidate_key text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(), evaluation_id bigint NOT NULL REFERENCES public.paper_evaluations(id),
  code_hash text NOT NULL, config_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('probation','active','paused')),
  reason text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS paper_one_release ON public.paper_releases((true)) WHERE status IN ('probation','active');
CREATE TABLE IF NOT EXISTS public.paper_positions (
  id text PRIMARY KEY, release_id bigint NOT NULL REFERENCES public.paper_releases(id),
  opened_at timestamptz NOT NULL, closed_at timestamptz,
  symbol text NOT NULL CHECK(symbol IN ('MES','MNQ')), side text NOT NULL CHECK(side IN ('LONG','SHORT')),
  qty integer NOT NULL CHECK(qty > 0), entry numeric NOT NULL, stop numeric NOT NULL, target numeric NOT NULL,
  risk numeric NOT NULL CHECK(risk > 0), mark numeric NOT NULL, pnl numeric,
  reason text NOT NULL
);
ALTER TABLE public.paper_account ADD COLUMN IF NOT EXISTS day_start_equity numeric NOT NULL DEFAULT 10000;
ALTER TABLE public.paper_positions ADD COLUMN IF NOT EXISTS last_mark_ts timestamptz;
ALTER TABLE public.paper_account ADD COLUMN IF NOT EXISTS last_bar_ts timestamptz;
CREATE TABLE IF NOT EXISTS public.paper_entry_decisions (
  observation_key text PRIMARY KEY, decided_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.research_confirmations (
  id text PRIMARY KEY, candidate_key text NOT NULL, measured_at timestamptz NOT NULL DEFAULT now(),
  code_hash text NOT NULL, config_hash text NOT NULL, outcome jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION public.guard_research_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Research observations cannot be deleted'; END IF;
  IF NEW.observation_key <> OLD.observation_key OR NEW.candidate_key <> OLD.candidate_key
    OR NEW.strategy_version <> OLD.strategy_version OR NEW.source <> OLD.source
    OR NEW.provenance <> OLD.provenance OR NEW.first_seen_at <> OLD.first_seen_at
    OR NEW.code_hash <> OLD.code_hash OR NEW.config_hash <> OLD.config_hash OR NEW.intent IS DISTINCT FROM OLD.intent
    OR NEW.signal_ts <> OLD.signal_ts OR NEW.recovery_id IS DISTINCT FROM OLD.recovery_id
    OR (OLD.exit_ts IS NOT NULL AND (NEW.exit_ts IS DISTINCT FROM OLD.exit_ts OR NEW.payload <> OLD.payload))
  THEN RAISE EXCEPTION 'Research identity and closed outcomes are write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_observations ON public.research_observations;
CREATE TRIGGER protect_observations BEFORE UPDATE OR DELETE ON public.research_observations FOR EACH ROW EXECUTE FUNCTION public.guard_research_observation();
CREATE OR REPLACE FUNCTION public.guard_paper_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Paper evaluations are append-only'; END $$;
DROP TRIGGER IF EXISTS protect_paper_evaluations ON public.paper_evaluations;
CREATE TRIGGER protect_paper_evaluations BEFORE UPDATE OR DELETE ON public.paper_evaluations FOR EACH ROW EXECUTE FUNCTION public.guard_paper_evaluation();
DROP TRIGGER IF EXISTS protect_confirmations ON public.research_confirmations;
CREATE TRIGGER protect_confirmations BEFORE UPDATE OR DELETE ON public.research_confirmations FOR EACH ROW EXECUTE FUNCTION public.guard_paper_evaluation();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['recovery_runs','research_observations','paper_evaluations','paper_account','paper_releases','paper_positions','paper_entry_decisions','research_confirmations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO anonymous, authenticated',t);
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_read') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anonymous, authenticated USING(true)', t||'_read',t);
    END IF;
  END LOOP;
END $$;
