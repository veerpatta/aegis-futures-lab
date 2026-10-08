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

CREATE SCHEMA IF NOT EXISTS private_research;
REVOKE ALL ON SCHEMA private_research FROM PUBLIC,anonymous,authenticated;
CREATE TABLE IF NOT EXISTS private_research.data_purchases (
 id text PRIMARY KEY, request jsonb NOT NULL, quoted_usd numeric NOT NULL CHECK(quoted_usd>=0),
 reserved_usd numeric NOT NULL CHECK(reserved_usd>=quoted_usd), status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), downloaded_at timestamptz,
 compressed bytea, content_hash text, report jsonb,
 budget_source text NOT NULL DEFAULT 'User-attested 102.76 USD on 2026-09-25; expires 2027-02-01'
);
CREATE TABLE IF NOT EXISTS public.research_measurements (
 id text PRIMARY KEY,candidate_key text NOT NULL,measured_at timestamptz NOT NULL DEFAULT now(),
 code_hash text NOT NULL,config_hash text NOT NULL,outcome jsonb NOT NULL
);
ALTER TABLE public.research_measurements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.research_measurements TO anonymous,authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='research_measurements' AND policyname='research_measurements_read') THEN
 CREATE POLICY research_measurements_read ON public.research_measurements FOR SELECT TO anonymous,authenticated USING(true);
END IF; END $$;
DROP TRIGGER IF EXISTS protect_measurements ON public.research_measurements;
CREATE TRIGGER protect_measurements BEFORE UPDATE OR DELETE ON public.research_measurements FOR EACH ROW EXECUTE FUNCTION public.guard_paper_evaluation();
-- Public read models contain only already-public paper/research data.
CREATE OR REPLACE VIEW public.bot_overview WITH (security_invoker=true) AS
SELECT
 (SELECT to_jsonb(a) FROM public.paper_account a WHERE id=1) AS account,
 (SELECT to_jsonb(r) FROM public.paper_releases r ORDER BY (status IN ('active','probation')) DESC, activated_at DESC LIMIT 1) AS release,
 coalesce((SELECT jsonb_agg(p ORDER BY p.opened_at DESC) FROM (SELECT * FROM public.paper_positions ORDER BY (closed_at IS NULL) DESC,opened_at DESC LIMIT 30) p),'[]'::jsonb) AS positions,
 (SELECT to_jsonb(l) FROM public.learning_runs l ORDER BY started_at DESC LIMIT 1) AS learning,
 (SELECT jsonb_build_object('status',m.status,'train_n',m.train_n,'oos_brier',m.oos_brier,'baseline_brier',m.baseline_brier) FROM public.model_registry m ORDER BY trained_at DESC LIMIT 1) AS model;

CREATE OR REPLACE VIEW public.candidate_progress WITH (security_invoker=true) AS
SELECT t.trial_key AS candidate_key,h.outcome AS historical,c.outcome AS confirmation,
 coalesce(f.closed,0)::integer AS forward_closed,coalesce(f.days,0)::integer AS forward_days,
 coalesce(f.net,0) AS forward_net,coalesce(w.passes,0)::integer AS weekly_passes
-- One trial per candidate, the latest (db/migrations/20261003_candidate_progress_latest_trial.sql).
FROM (SELECT DISTINCT ON (trial_key) * FROM public.research_trials
      WHERE trial_key LIKE '2026-09-25.%:%' ORDER BY trial_key, registered_at DESC, id DESC) t
LEFT JOIN LATERAL (SELECT coalesce((SELECT outcome FROM public.research_measurements m WHERE m.candidate_key=t.trial_key ORDER BY measured_at DESC LIMIT 1),t.outcome) outcome) h ON true
LEFT JOIN LATERAL (SELECT outcome FROM public.research_confirmations c WHERE c.candidate_key=t.trial_key
 AND c.code_hash=h.outcome->>'codeHash' AND c.config_hash=h.outcome->>'configHash' ORDER BY measured_at DESC LIMIT 1) c ON true
LEFT JOIN LATERAL (SELECT count(*) closed,count(DISTINCT (signal_ts AT TIME ZONE 'America/New_York')::date) days,sum((payload->>'pnl')::numeric) net
 FROM public.research_observations o WHERE o.candidate_key=t.trial_key AND provenance='forward' AND exit_ts<=now()
 AND intent IS NOT NULL AND jsonb_typeof(payload->'pnl')='number' AND code_hash=h.outcome->>'codeHash' AND config_hash=h.outcome->>'configHash') f ON true
LEFT JOIN LATERAL (SELECT count(*) passes FROM public.paper_evaluations e WHERE e.candidate_key=t.trial_key
 AND e.code_hash=h.outcome->>'codeHash' AND e.config_hash=h.outcome->>'configHash' AND e.evidence->>'pass'='true') w ON true;

CREATE OR REPLACE VIEW public.bot_activity WITH (security_invoker=true) AS
SELECT 'training:'||id::text id,coalesce(finished_at,started_at) AS at,'Training'::text kind,status,
 CASE WHEN status='ok' THEN 'Training finished. Model qualification is checked separately.' WHEN status='running' THEN 'Training is running.' ELSE 'Training needs attention. Previous results remain recorded.' END detail,NULL::text candidate_key
FROM (SELECT * FROM public.learning_runs ORDER BY started_at DESC LIMIT 20) l
UNION ALL SELECT 'release:'||id,activated_at,'Paper account',status,reason,candidate_key FROM public.paper_releases
UNION ALL SELECT 'decision:'||observation_key,decided_at,'Trade decision','recorded',reason,split_part(observation_key,':',1)||':'||split_part(observation_key,':',2)||':'||split_part(observation_key,':',3) FROM (SELECT * FROM public.paper_entry_decisions ORDER BY decided_at DESC LIMIT 20) d
UNION ALL SELECT 'research:'||id,coalesce(decided_at,registered_at),'Research',status,
 CASE WHEN outcome IS NULL THEN 'A fixed hypothesis was registered before testing.' WHEN outcome->'gate'->>'promote'='true' THEN 'Historical checks passed. Separate confirmation and forward evidence are still required.' ELSE 'Historical research finished. This result does not qualify for activation.' END,trial_key FROM public.research_trials
UNION ALL SELECT 'measurement:'||id,measured_at,'Research','complete','A frozen strategy was remeasured. Open its progress card for the current evidence.',candidate_key FROM public.research_measurements
UNION ALL SELECT 'confirmation:'||id,measured_at,'Confirmation','complete',
 CASE WHEN outcome->'dataQuality'->>'ready'='false' THEN 'Missing session bars block qualification. Confirmation results are provisional.' WHEN outcome->'gate'->>'promote'='true' THEN 'Separate confirmation passed. New observations and weekly reviews are still required.' ELSE 'Separate confirmation did not qualify.' END,candidate_key FROM public.research_confirmations;
GRANT SELECT ON public.bot_overview,public.candidate_progress,public.bot_activity TO anonymous,authenticated;
NOTIFY pgrst, 'reload schema';

-- 2026-10-07: the experimental learner — a virtual-only $10,000 account that
-- takes trade ideas on its own, records every take and every skip, simulates
-- its own fills on delayed bars and learns in batches under preregistered
-- rules (lib/experiment/*, docs/research/2026-10-07-experiment-preregistration.md).
--
-- It replaces the trial account (20261005_trial_account.sql, never applied):
-- the trial's "copy every idea" rule is this experiment's frozen control model
-- v1. Nothing here touches the practice account (paper_*), the legacy signal
-- record or the journal, and there is no broker and no real-money path.
--
-- Every table is scoped by experiment_id. History is never rewritten: the
-- append-only and write-once rules are TRIGGERS, not policies, because the
-- engine writes over a privileged connection that bypasses RLS. A status change
-- or a model switch must point at a matching change row, so neither can happen
-- silently.

CREATE TABLE IF NOT EXISTS public.experiments (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  lineage text NOT NULL,
  campaign integer NOT NULL CHECK (campaign >= 1),
  mode text NOT NULL CHECK (mode IN ('live','synthetic')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','locked','stopped')),
  status_reason text,
  last_change_id bigint,
  capital numeric NOT NULL CHECK (capital > 0),
  risk jsonb NOT NULL,
  prereg jsonb NOT NULL,
  prereg_hash text NOT NULL,
  data_label text NOT NULL CHECK (data_label IN ('delayed','synthetic')),
  seed bigint NOT NULL,
  started_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lineage, campaign),
  CHECK ((mode = 'synthetic') = (data_label = 'synthetic'))
);
CREATE UNIQUE INDEX IF NOT EXISTS experiments_one_running ON public.experiments(lineage) WHERE status IN ('active','paused');

CREATE TABLE IF NOT EXISTS public.experiment_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  kind text NOT NULL CHECK (kind IN ('created','campaign_started','paused','resumed','locked','stopped','day_halted',
    'challenger_registered','challenger_invalid','adopted','rejected','inconclusive','retired','rolled_back','quota_level','rules_amended')), -- rules_amended: db/migrations/20261007_experiment_lifecycle_amendment.sql
  from_status text,
  to_status text,
  from_version text,
  to_version text,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'system' CHECK (actor IN ('system','owner')),
  event_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_changes_recent ON public.experiment_changes(experiment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.experiment_account (
  experiment_id text PRIMARY KEY REFERENCES public.experiments(id),
  equity numeric NOT NULL,
  realized numeric NOT NULL DEFAULT 0,
  unrealized numeric NOT NULL DEFAULT 0,
  unpriced_positions integer NOT NULL DEFAULT 0,
  peak numeric NOT NULL,
  day_key text NOT NULL DEFAULT '',
  day_start_equity numeric NOT NULL,
  daily_pnl numeric NOT NULL DEFAULT 0,
  open_risk numeric NOT NULL DEFAULT 0 CHECK (open_risk >= 0),
  day_halted boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  stale_symbols text[] NOT NULL DEFAULT '{}',
  last_ok_tick_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experiment_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  job text NOT NULL CHECK (job IN ('tick','learn','review')),
  invocation_id text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('neon','github','manual','test')),
  scheduled_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','skipped','partial','error')),
  duration_ms integer,
  db_bytes bigint,
  quota_level text,
  code_sha text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text,
  UNIQUE (experiment_id, job, invocation_id)
);
CREATE INDEX IF NOT EXISTS experiment_runs_recent ON public.experiment_runs(experiment_id, job, started_at DESC);

CREATE TABLE IF NOT EXISTS public.experiment_leases (
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  job text NOT NULL,
  holder text NOT NULL,
  run_id bigint,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (experiment_id, job)
);

CREATE TABLE IF NOT EXISTS public.experiment_model_versions (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  kind text NOT NULL CHECK (kind IN ('take_all','logit')),
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  spec_hash text NOT NULL,
  week_key text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  dataset_id text,
  artifact jsonb,
  artifact_hash text,
  trained_at timestamptz,
  train_cutoff timestamptz,
  status text NOT NULL CHECK (status IN ('registered','shadowing','adopted','rejected','inconclusive','invalid','retired','rolled_back')),
  status_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, spec_hash)
);

CREATE TABLE IF NOT EXISTS public.experiment_pointer (
  experiment_id text PRIMARY KEY REFERENCES public.experiments(id),
  model_version_id text NOT NULL REFERENCES public.experiment_model_versions(id),
  previous_version_id text REFERENCES public.experiment_model_versions(id),
  change_id bigint NOT NULL REFERENCES public.experiment_changes(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experiment_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_key text NOT NULL UNIQUE,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  opportunity_key text NOT NULL,
  signal_id bigint,
  symbol text NOT NULL CHECK (symbol IN ('MES','MNQ')),
  side text NOT NULL CHECK (side IN ('LONG','SHORT')),
  session_key text NOT NULL,
  seen_at timestamptz NOT NULL,
  info_cutoff timestamptz NOT NULL,
  decided_at timestamptz NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('prospective','late','replay','synthetic')),
  model_version_id text NOT NULL REFERENCES public.experiment_model_versions(id),
  p_win numeric CHECK (p_win IS NULL OR (p_win >= 0 AND p_win <= 1)),
  threshold numeric,
  action text NOT NULL CHECK (action IN ('take','skip')),
  reason text NOT NULL CHECK (reason IN ('taken','model-skip','risk-budget','open-risk','daily-loss','locked','paused','stale-data',
    'stop-too-small','stop-breached','target-passed','idea-closed','session-over','no-risk','model-invalid','quota')),
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  est_risk numeric,
  ref_price numeric,
  idea jsonb NOT NULL,
  features jsonb,
  feature_version text NOT NULL,
  snapshot_hash text NOT NULL,
  run_id bigint REFERENCES public.experiment_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, opportunity_key),
  CHECK ((action = 'skip') = (qty = 0)),
  CHECK ((action = 'take') = (reason = 'taken')),
  CHECK (decided_at >= info_cutoff)
);
CREATE INDEX IF NOT EXISTS experiment_decisions_recent ON public.experiment_decisions(experiment_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS public.experiment_shadow_scores (
  decision_key text NOT NULL REFERENCES public.experiment_decisions(decision_key),
  model_version_id text NOT NULL REFERENCES public.experiment_model_versions(id),
  p_win numeric,
  would_take boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_key, model_version_id)
);

-- The simulated trade, shared by positions (the ledger) and outcomes (the
-- one-contract shadow every decision gets).
CREATE TABLE IF NOT EXISTS public.experiment_positions (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  decision_key text NOT NULL UNIQUE REFERENCES public.experiment_decisions(decision_key),
  symbol text NOT NULL CHECK (symbol IN ('MES','MNQ')),
  side text NOT NULL CHECK (side IN ('LONG','SHORT')),
  qty integer NOT NULL CHECK (qty > 0),
  stop numeric NOT NULL,
  target numeric,
  decided_at timestamptz NOT NULL,
  session_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_fill','open','closed','cancelled')),
  cancel_reason text,
  fill_ts timestamptz,
  fill_price numeric,
  entry_slip numeric,
  risk numeric,
  mark numeric,
  mark_ts timestamptz,
  stale boolean NOT NULL DEFAULT false,
  exit_ts timestamptz,
  exit_price numeric,
  exit_slip numeric,
  exit_reason text CHECK (exit_reason IN ('stop','target','session','session-late','daily-loss','drawdown','campaign-end')),
  ambiguous boolean NOT NULL DEFAULT false,
  gross numeric,
  fees numeric,
  net numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_positions_live ON public.experiment_positions(experiment_id) WHERE status IN ('pending_fill','open');

CREATE TABLE IF NOT EXISTS public.experiment_outcomes (
  decision_key text PRIMARY KEY REFERENCES public.experiment_decisions(decision_key),
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  outcome_status text NOT NULL CHECK (outcome_status IN ('pending','open','closed','void')),
  void_reason text,
  standalone_qty integer NOT NULL DEFAULT 0,
  symbol text NOT NULL,
  side text NOT NULL,
  stop numeric NOT NULL,
  target numeric,
  decided_at timestamptz NOT NULL,
  session_key text NOT NULL,
  status text NOT NULL,
  cancel_reason text,
  fill_ts timestamptz,
  fill_price numeric,
  entry_slip numeric,
  risk numeric,
  mark numeric,
  mark_ts timestamptz,
  exit_ts timestamptz,
  exit_price numeric,
  exit_slip numeric,
  exit_reason text,
  ambiguous boolean NOT NULL DEFAULT false,
  gross numeric,
  fees numeric,
  net numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_outcomes_live ON public.experiment_outcomes(experiment_id) WHERE outcome_status IN ('pending','open');

CREATE TABLE IF NOT EXISTS public.experiment_fills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fill_key text NOT NULL UNIQUE,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  position_id text NOT NULL REFERENCES public.experiment_positions(id),
  kind text NOT NULL CHECK (kind IN ('entry','exit')),
  bar_time timestamptz NOT NULL,
  raw_price numeric NOT NULL,
  slippage_points numeric NOT NULL,
  price numeric NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  commission numeric NOT NULL,
  cost_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experiment_equity (
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  kind text NOT NULL CHECK (kind IN ('tick','eod')),
  as_of timestamptz NOT NULL,
  equity numeric NOT NULL,
  realized numeric NOT NULL,
  unrealized numeric NOT NULL,
  unpriced_positions integer NOT NULL,
  open_risk numeric NOT NULL,
  peak numeric NOT NULL,
  drawdown numeric NOT NULL,
  daily_pnl numeric NOT NULL,
  run_id bigint REFERENCES public.experiment_runs(id),
  PRIMARY KEY (experiment_id, kind, as_of)
);

CREATE TABLE IF NOT EXISTS public.experiment_datasets (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  built_at timestamptz NOT NULL DEFAULT now(),
  cutoff timestamptz NOT NULL,
  feature_version text NOT NULL,
  row_count integer NOT NULL,
  decision_keys text[] NOT NULL,
  rows_hash text NOT NULL,
  filters jsonb NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_id bigint REFERENCES public.experiment_runs(id)
);

CREATE TABLE IF NOT EXISTS public.experiment_evaluations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES public.experiments(id),
  run_id bigint REFERENCES public.experiment_runs(id),
  model_version_id text NOT NULL REFERENCES public.experiment_model_versions(id),
  incumbent_version_id text REFERENCES public.experiment_model_versions(id),
  dataset_id text REFERENCES public.experiment_datasets(id),
  kind text NOT NULL CHECK (kind IN ('walk_forward','monitor')),
  window_from timestamptz,
  window_to timestamptz,
  n_oos integer NOT NULL,
  n_sessions integer NOT NULL,
  total_outcomes integer NOT NULL,
  metrics jsonb NOT NULL,
  seeds jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict text NOT NULL CHECK (verdict IN ('pass','fail','inconclusive','invalid')),
  reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_evaluations_recent ON public.experiment_evaluations(experiment_id, created_at DESC);

-- ── Guards ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_experiment_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['experiment_changes','experiment_decisions','experiment_shadow_scores','experiment_fills',
    'experiment_equity','experiment_datasets','experiment_evaluations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS protect_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER protect_%1$s BEFORE UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_append_only()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_experiment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Experiments cannot be deleted'; END IF;
  IF NEW.id <> OLD.id OR NEW.lineage <> OLD.lineage OR NEW.campaign <> OLD.campaign OR NEW.mode <> OLD.mode
    OR NEW.capital <> OLD.capital OR NEW.risk <> OLD.risk OR NEW.prereg <> OLD.prereg OR NEW.prereg_hash <> OLD.prereg_hash
    OR NEW.seed <> OLD.seed OR NEW.started_at <> OLD.started_at OR NEW.data_label <> OLD.data_label
  THEN RAISE EXCEPTION 'An experiment''s registration is write-once'; END IF;
  IF OLD.status = 'stopped' THEN RAISE EXCEPTION 'A stopped experiment is write-once'; END IF;
  IF OLD.status = 'locked' AND NEW.status <> 'locked' AND NEW.status <> 'stopped' THEN
    RAISE EXCEPTION 'A locked campaign never reopens; preregister a new campaign';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.last_change_id IS NULL OR NEW.last_change_id IS NOT DISTINCT FROM OLD.last_change_id THEN
      RAISE EXCEPTION 'A status change needs its own change record';
    END IF;
    SELECT * INTO c FROM public.experiment_changes WHERE id = NEW.last_change_id;
    IF c IS NULL OR c.experiment_id <> NEW.id OR c.to_status IS DISTINCT FROM NEW.status THEN
      RAISE EXCEPTION 'The change record does not match this status change';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiments ON public.experiments;
CREATE TRIGGER protect_experiments BEFORE UPDATE OR DELETE ON public.experiments FOR EACH ROW EXECUTE FUNCTION public.guard_experiment();

CREATE OR REPLACE FUNCTION public.guard_experiment_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An experiment account cannot be deleted'; END IF;
  IF NEW.experiment_id <> OLD.experiment_id THEN RAISE EXCEPTION 'An account belongs to one experiment'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Account updates must advance the version by one'; END IF;
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN RAISE EXCEPTION 'A drawdown lock is permanent'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_account ON public.experiment_account;
CREATE TRIGGER protect_experiment_account BEFORE UPDATE OR DELETE ON public.experiment_account FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_account();

CREATE OR REPLACE FUNCTION public.guard_experiment_trade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE done boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME; END IF;
  IF TG_TABLE_NAME = 'experiment_positions' THEN
    done := OLD.status IN ('closed','cancelled');
    IF NEW.id <> OLD.id OR NEW.decision_key <> OLD.decision_key THEN RAISE EXCEPTION 'A position''s identity is write-once'; END IF;
  ELSE
    done := OLD.outcome_status IN ('closed','void');
    IF NEW.decision_key <> OLD.decision_key OR NEW.standalone_qty <> OLD.standalone_qty THEN RAISE EXCEPTION 'An outcome''s identity is write-once'; END IF;
  END IF;
  IF done THEN RAISE EXCEPTION 'A finished % row is write-once', TG_TABLE_NAME; END IF;
  IF NEW.symbol <> OLD.symbol OR NEW.side <> OLD.side OR NEW.stop <> OLD.stop OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.decided_at <> OLD.decided_at OR NEW.session_key <> OLD.session_key
  THEN RAISE EXCEPTION 'A trade''s plan is write-once'; END IF;
  IF OLD.fill_ts IS NOT NULL AND (NEW.fill_ts IS DISTINCT FROM OLD.fill_ts OR NEW.fill_price IS DISTINCT FROM OLD.fill_price)
  THEN RAISE EXCEPTION 'A fill is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_positions ON public.experiment_positions;
CREATE TRIGGER protect_experiment_positions BEFORE UPDATE OR DELETE ON public.experiment_positions FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_trade();
DROP TRIGGER IF EXISTS protect_experiment_outcomes ON public.experiment_outcomes;
CREATE TRIGGER protect_experiment_outcomes BEFORE UPDATE OR DELETE ON public.experiment_outcomes FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_trade();

CREATE OR REPLACE FUNCTION public.guard_experiment_model_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE weekly integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'logit' THEN
      SELECT count(*) INTO weekly FROM public.experiment_model_versions
        WHERE experiment_id = NEW.experiment_id AND week_key = NEW.week_key AND kind = 'logit';
      IF weekly >= 3 THEN RAISE EXCEPTION 'At most three challengers a week'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Model versions cannot be deleted'; END IF;
  IF NEW.id <> OLD.id OR NEW.experiment_id <> OLD.experiment_id OR NEW.kind <> OLD.kind OR NEW.spec <> OLD.spec
    OR NEW.spec_hash <> OLD.spec_hash OR NEW.week_key <> OLD.week_key OR NEW.registered_at <> OLD.registered_at
  THEN RAISE EXCEPTION 'A model version''s registration is write-once'; END IF;
  IF OLD.artifact IS NOT NULL AND (NEW.artifact IS DISTINCT FROM OLD.artifact OR NEW.artifact_hash IS DISTINCT FROM OLD.artifact_hash)
  THEN RAISE EXCEPTION 'A trained model is write-once'; END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'registered' AND NEW.status IN ('shadowing','invalid'))
    OR (OLD.status = 'shadowing' AND NEW.status IN ('adopted','rejected','inconclusive','retired','invalid'))
    OR (OLD.status = 'inconclusive' AND NEW.status IN ('shadowing','retired'))
    OR (OLD.status = 'adopted' AND NEW.status IN ('retired','rolled_back'))
    OR (OLD.status = 'retired' AND NEW.status = 'adopted')
  ) THEN RAISE EXCEPTION 'Model status cannot move from % to %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_model_versions ON public.experiment_model_versions;
CREATE TRIGGER protect_experiment_model_versions BEFORE INSERT OR UPDATE OR DELETE ON public.experiment_model_versions FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_model_version();

CREATE OR REPLACE FUNCTION public.guard_experiment_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; v record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The model pointer cannot be deleted'; END IF;
  SELECT * INTO v FROM public.experiment_model_versions WHERE id = NEW.model_version_id;
  IF v.experiment_id <> NEW.experiment_id THEN RAISE EXCEPTION 'A model can only run inside its own experiment'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.experiment_id <> OLD.experiment_id THEN RAISE EXCEPTION 'A pointer belongs to one experiment'; END IF;
    IF NEW.model_version_id <> OLD.model_version_id THEN
      SELECT * INTO c FROM public.experiment_changes WHERE id = NEW.change_id;
      IF NEW.change_id = OLD.change_id OR c IS NULL OR c.experiment_id <> NEW.experiment_id OR c.kind NOT IN ('adopted','rolled_back')
        OR c.from_version IS DISTINCT FROM OLD.model_version_id OR c.to_version IS DISTINCT FROM NEW.model_version_id
      THEN RAISE EXCEPTION 'A model switch needs a matching adopted or rolled_back change'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_pointer ON public.experiment_pointer;
CREATE TRIGGER protect_experiment_pointer BEFORE INSERT OR UPDATE OR DELETE ON public.experiment_pointer FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_pointer();

CREATE OR REPLACE FUNCTION public.guard_experiment_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Run records cannot be deleted'; END IF;
  IF OLD.finished_at IS NOT NULL THEN RAISE EXCEPTION 'A finished run is write-once'; END IF;
  IF NEW.experiment_id <> OLD.experiment_id OR NEW.job <> OLD.job OR NEW.invocation_id <> OLD.invocation_id
  THEN RAISE EXCEPTION 'A run''s identity is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_runs ON public.experiment_runs;
CREATE TRIGGER protect_experiment_runs BEFORE UPDATE OR DELETE ON public.experiment_runs FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_run();

-- ── Public read access (simulation data only; nothing private lives here) ──

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['experiments','experiment_changes','experiment_account','experiment_runs','experiment_model_versions',
    'experiment_pointer','experiment_decisions','experiment_shadow_scores','experiment_positions','experiment_outcomes',
    'experiment_fills','experiment_equity','experiment_datasets','experiment_evaluations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anonymous, authenticated', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_read') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anonymous, authenticated USING (true)', t || '_read', t);
    END IF;
  END LOOP;
END $$;
-- Leases are operational, not shown.
ALTER TABLE public.experiment_leases ENABLE ROW LEVEL SECURITY;

-- ── Read models ─────────────────────────────────────────────────────────

-- Today: the running (or latest) campaign of each lineage, its account, open
-- trades, the active model, today's decisions by reason, the latest runs per
-- job and lifetime totals across every campaign of the lineage — a new
-- campaign never hides earlier losses.
CREATE OR REPLACE VIEW public.experiment_overview WITH (security_invoker = true) AS
WITH cur AS (
  SELECT DISTINCT ON (lineage) * FROM public.experiments
  ORDER BY lineage, (status IN ('active','paused')) DESC, campaign DESC
)
SELECT
  e.lineage,
  to_jsonb(e) - 'prereg' - 'risk' AS experiment,
  e.risk,
  (SELECT to_jsonb(a) FROM public.experiment_account a WHERE a.experiment_id = e.id) AS account,
  (SELECT jsonb_build_object('version_id', p.model_version_id, 'previous_version_id', p.previous_version_id, 'since', p.updated_at,
     'kind', v.kind, 'spec', v.spec, 'status', v.status)
   FROM public.experiment_pointer p JOIN public.experiment_model_versions v ON v.id = p.model_version_id WHERE p.experiment_id = e.id) AS model,
  coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.decided_at DESC) FROM (
    SELECT p.*, d.id AS decision_id, d.opportunity_key, d.idea, d.provenance, d.model_version_id FROM public.experiment_positions p
    JOIN public.experiment_decisions d ON d.decision_key = p.decision_key
    WHERE p.experiment_id = e.id AND p.status IN ('pending_fill','open')) x), '[]'::jsonb) AS open_positions,
  (SELECT to_jsonb(x) FROM (
    SELECT p.*, d.id AS decision_id, d.opportunity_key, d.idea, d.provenance, d.model_version_id FROM public.experiment_positions p
    JOIN public.experiment_decisions d ON d.decision_key = p.decision_key
    WHERE p.experiment_id = e.id AND p.status = 'closed' ORDER BY p.exit_ts DESC LIMIT 1) x) AS latest_trade,
  coalesce((SELECT jsonb_object_agg(reason, n) FROM (
    SELECT reason, count(*)::integer n FROM public.experiment_decisions
    WHERE experiment_id = e.id AND session_key = (SELECT day_key FROM public.experiment_account WHERE experiment_id = e.id)
    GROUP BY reason) r), '{}'::jsonb) AS today_reasons,
  (SELECT jsonb_build_object('closed', count(*), 'net', coalesce(sum(net), 0), 'wins', count(*) FILTER (WHERE net > 0))
   FROM public.experiment_positions WHERE experiment_id = e.id AND status = 'closed' AND session_key = (SELECT day_key FROM public.experiment_account WHERE experiment_id = e.id)) AS today,
  (SELECT jsonb_build_object('closed', count(*), 'net', coalesce(sum(net), 0), 'wins', count(*) FILTER (WHERE net > 0),
     'fees', coalesce(sum(fees), 0))
   FROM public.experiment_positions WHERE experiment_id = e.id AND status = 'closed') AS campaign_totals,
  (SELECT jsonb_build_object('campaigns', count(DISTINCT x.id), 'closed', count(p.id), 'net', coalesce(sum(p.net), 0), 'first_start', min(x.started_at))
   FROM public.experiments x LEFT JOIN public.experiment_positions p ON p.experiment_id = x.id AND p.status = 'closed'
   WHERE x.lineage = e.lineage AND x.mode = e.mode) AS lifetime,
  (SELECT to_jsonb(c) FROM (SELECT id, kind, from_version, to_version, reason, created_at FROM public.experiment_changes
    WHERE experiment_id = e.id AND kind IN ('adopted','rejected','inconclusive','rolled_back','challenger_registered','challenger_invalid','retired')
    ORDER BY created_at DESC LIMIT 1) c) AS latest_learning,
  coalesce((SELECT jsonb_object_agg(job, r) FROM (
    SELECT DISTINCT ON (job) job, jsonb_build_object('status', status, 'started_at', started_at, 'finished_at', finished_at, 'message', message,
      'quota_level', quota_level, 'counts', counts) r
    FROM public.experiment_runs WHERE experiment_id = e.id ORDER BY job, started_at DESC) j), '{}'::jsonb) AS last_runs,
  coalesce((SELECT jsonb_object_agg(job, t) FROM (
    SELECT job, max(finished_at) t FROM public.experiment_runs WHERE experiment_id = e.id AND status IN ('ok','skipped') GROUP BY job) j), '{}'::jsonb) AS last_success,
  (SELECT quota_level FROM public.experiment_runs WHERE experiment_id = e.id AND quota_level IS NOT NULL ORDER BY started_at DESC LIMIT 1) AS quota_level,
  coalesce((SELECT jsonb_agg(x ORDER BY x.as_of) FROM (
    SELECT as_of, equity, realized FROM public.experiment_equity WHERE experiment_id = e.id AND kind = 'eod' ORDER BY as_of DESC LIMIT 90) x), '[]'::jsonb) AS equity_eod,
  coalesce((SELECT jsonb_agg(x ORDER BY x.decided_at DESC) FROM (
    SELECT d.id, d.opportunity_key, d.action, d.reason, d.qty, d.decided_at, p.status AS position_status, p.net
    FROM public.experiment_decisions d LEFT JOIN public.experiment_positions p ON p.decision_key = d.decision_key
    WHERE d.experiment_id = e.id AND d.decided_at > now() - interval '30 days' ORDER BY d.decided_at DESC LIMIT 300) x), '[]'::jsonb) AS recent_decisions
FROM cur e;

-- Trades: every decision with its trade (if taken) and its shadow outcome.
CREATE OR REPLACE VIEW public.experiment_trades WITH (security_invoker = true) AS
SELECT
  d.id, d.decision_key, d.experiment_id, d.opportunity_key, d.signal_id, d.symbol, d.side, d.session_key,
  d.seen_at, d.info_cutoff, d.decided_at, d.provenance, d.model_version_id, d.p_win, d.threshold, d.action, d.reason,
  d.qty, d.est_risk, d.ref_price, d.idea, d.features, d.feature_version, d.snapshot_hash,
  p.id AS position_id, p.status AS position_status, p.cancel_reason, p.fill_ts, p.fill_price, p.entry_slip, p.risk,
  p.mark, p.mark_ts, p.stale, p.exit_ts, p.exit_price, p.exit_slip, p.exit_reason, p.ambiguous, p.gross, p.fees, p.net,
  o.outcome_status AS shadow_status, o.void_reason AS shadow_void_reason, o.standalone_qty AS shadow_qty,
  o.exit_reason AS shadow_exit_reason, o.net AS shadow_net_per_contract, o.ambiguous AS shadow_ambiguous,
  e.mode, e.data_label, e.campaign, e.lineage
FROM public.experiment_decisions d
JOIN public.experiments e ON e.id = d.experiment_id
LEFT JOIN public.experiment_positions p ON p.decision_key = d.decision_key
LEFT JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key;

-- Learn: model versions, evaluations, the full change timeline and the
-- adoption floors each with its count.
CREATE OR REPLACE VIEW public.experiment_learning WITH (security_invoker = true) AS
WITH cur AS (
  SELECT DISTINCT ON (lineage) * FROM public.experiments
  ORDER BY lineage, (status IN ('active','paused')) DESC, campaign DESC
)
SELECT
  e.lineage, e.id AS experiment_id, e.mode, e.prereg,
  (SELECT model_version_id FROM public.experiment_pointer WHERE experiment_id = e.id) AS active_version_id,
  coalesce((SELECT jsonb_agg(to_jsonb(v) - 'artifact' || jsonb_build_object(
      'threshold', v.artifact -> 'threshold', 'train', v.artifact -> 'train')
    ORDER BY v.registered_at DESC) FROM public.experiment_model_versions v WHERE v.experiment_id = e.id), '[]'::jsonb) AS versions,
  coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
    SELECT id, model_version_id, incumbent_version_id, dataset_id, kind, window_from, window_to, n_oos, n_sessions, total_outcomes,
      metrics, verdict, reasons, created_at
    FROM public.experiment_evaluations WHERE experiment_id = e.id ORDER BY created_at DESC LIMIT 60) x), '[]'::jsonb) AS evaluations,
  coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
    SELECT id, kind, from_status, to_status, from_version, to_version, reason, evidence, actor, created_at
    FROM public.experiment_changes WHERE experiment_id = e.id ORDER BY created_at DESC LIMIT 200) x), '[]'::jsonb) AS changes,
  (SELECT jsonb_build_object(
     'closed_outcomes', count(*) FILTER (WHERE o.outcome_status = 'closed'),
     'closed_prospective', count(*) FILTER (WHERE o.outcome_status = 'closed' AND d.provenance = 'prospective'),
     'sessions_prospective', count(DISTINCT d.session_key) FILTER (WHERE o.outcome_status = 'closed' AND d.provenance = 'prospective'),
     'decisions', count(*),
     'taken', count(*) FILTER (WHERE d.action = 'take'))
   FROM public.experiment_decisions d LEFT JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key
   WHERE d.experiment_id = e.id) AS progress,
  (SELECT to_jsonb(x) FROM (SELECT id, built_at, cutoff, row_count, rows_hash FROM public.experiment_datasets
    WHERE experiment_id = e.id ORDER BY built_at DESC LIMIT 1) x) AS latest_dataset
FROM cur e;

-- Health: the last run of each job and recent errors.
CREATE OR REPLACE VIEW public.experiment_health WITH (security_invoker = true) AS
SELECT e.lineage, e.id AS experiment_id, e.status,
  (SELECT last_ok_tick_at FROM public.experiment_account WHERE experiment_id = e.id) AS last_ok_tick_at,
  coalesce((SELECT jsonb_agg(x ORDER BY x.started_at DESC) FROM (
    SELECT job, status, started_at, finished_at, duration_ms, quota_level, db_bytes, message FROM public.experiment_runs
    WHERE experiment_id = e.id ORDER BY started_at DESC LIMIT 30) x), '[]'::jsonb) AS runs,
  (SELECT count(*)::integer FROM public.experiment_runs WHERE experiment_id = e.id AND status = 'error' AND started_at > now() - interval '24 hours') AS errors_24h
FROM public.experiments e WHERE e.status IN ('active','paused','locked');

GRANT SELECT ON public.experiment_overview, public.experiment_trades, public.experiment_learning, public.experiment_health TO anonymous, authenticated;

-- 2026-10-07: the historical study — a separate, reproducible study lineage
-- built from the retained archive (lib/history/*, docs/research/
-- 2026-10-07-historical-study-preregistration.md).
--
-- It never touches the live experiment's ledger, the practice account, the
-- legacy signal record or the journal. It writes only these tables. A selected
-- candidate reaches the live experiment solely as a new SHADOW model version,
-- registered at its real time, through the experiment's own guarded tables.
--
-- Privacy: these tables hold rows derived from licensed archive bars, so they
-- get NO public grants. The only public surface is the aggregate view
-- history_overview at the bottom (definer rights, totals only).
--
-- History is never rewritten: registration fields are write-once, finished
-- chunks and examples are append-only, a trial's measured results are
-- write-once, and the final period can be opened once.

CREATE TABLE IF NOT EXISTS public.history_studies (
  id text PRIMARY KEY CHECK (id ~ '^hist-[a-z0-9-]{3,60}$'),
  version text NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','replaying','replayed','evaluated','partial','failed')),
  status_reason text,
  rules jsonb NOT NULL,
  rules_hash text NOT NULL,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL,
  code_sha text,
  research_code_hash text NOT NULL,
  observation_lag_sec integer NOT NULL CHECK (observation_lag_sec >= 300),
  trials jsonb NOT NULL,
  split jsonb,
  dataset jsonb,
  dataset_hash text,
  final_accessed_at timestamptz,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.history_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  study_id text NOT NULL REFERENCES public.history_studies(id),
  stage text NOT NULL CHECK (stage IN ('register','replay','study','shadow')),
  invocation_id text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','partial','skipped','error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  bytes_read bigint NOT NULL DEFAULT 0,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text,
  UNIQUE (study_id, stage, invocation_id)
);

CREATE TABLE IF NOT EXISTS public.history_leases (
  study_id text PRIMARY KEY REFERENCES public.history_studies(id),
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.history_chunks (
  study_id text NOT NULL REFERENCES public.history_studies(id),
  symbol text NOT NULL CHECK (symbol IN ('MES','MNQ')),
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  status text NOT NULL CHECK (status IN ('done','failed')),
  bars_read integer NOT NULL DEFAULT 0,
  bytes_read bigint NOT NULL DEFAULT 0,
  bars_hash text,
  first_bar bigint,
  last_bar bigint,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  ideas integer NOT NULL DEFAULT 0,
  examples integer NOT NULL DEFAULT 0,
  runtime_ms integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 1,
  error text,
  finished_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (study_id, symbol, month)
);

CREATE TABLE IF NOT EXISTS public.history_examples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  study_id text NOT NULL REFERENCES public.history_studies(id),
  mode text NOT NULL CHECK (mode IN ('observation','strategy')),
  family_id text NOT NULL,
  month text NOT NULL,
  symbol text NOT NULL CHECK (symbol IN ('MES','MNQ')),
  side text NOT NULL CHECK (side IN ('LONG','SHORT')),
  strategy text NOT NULL,
  tier text NOT NULL,
  signal_ts timestamptz NOT NULL,
  seen_at timestamptz NOT NULL,
  decided_at timestamptz NOT NULL,
  info_cutoff timestamptz NOT NULL,
  label_ready_at timestamptz,
  features jsonb,
  reason text NOT NULL,
  outcome_status text NOT NULL CHECK (outcome_status IN ('closed','void','open')),
  void_reason text,
  standalone_qty integer NOT NULL DEFAULT 0,
  fill_ts timestamptz,
  fill_price numeric,
  exit_ts timestamptz,
  exit_price numeric,
  exit_reason text,
  ambiguous boolean NOT NULL DEFAULT false,
  gross_pc numeric,
  fees_pc numeric,
  slip_pc numeric,
  net_pc numeric,
  risk_pc numeric,
  quality text[] NOT NULL DEFAULT '{}',
  quarantined boolean NOT NULL DEFAULT false,
  snapshot_hash text NOT NULL,
  idea_exit_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, mode, family_id),
  CHECK (decided_at >= info_cutoff),
  CHECK (label_ready_at IS NULL OR label_ready_at >= decided_at)
);
CREATE INDEX IF NOT EXISTS history_examples_study ON public.history_examples(study_id, mode, decided_at);

CREATE TABLE IF NOT EXISTS public.history_trials (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  study_id text NOT NULL REFERENCES public.history_studies(id),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  spec jsonb NOT NULL,
  spec_hash text NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','evaluated','failed_coverage','invalid','selected')),
  folds jsonb,
  development jsonb,
  validation jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  UNIQUE (study_id, spec_hash),
  UNIQUE (study_id, ordinal)
);

CREATE TABLE IF NOT EXISTS public.history_finals (
  study_id text PRIMARY KEY REFERENCES public.history_studies(id),
  trial_id bigint NOT NULL REFERENCES public.history_trials(id),
  artifact jsonb NOT NULL,
  artifact_hash text NOT NULL,
  train_cutoff timestamptz NOT NULL,
  train_rows integer NOT NULL,
  metrics jsonb NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass','fail','inconclusive','invalid')),
  reasons text[] NOT NULL DEFAULT '{}',
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  development_exposed boolean NOT NULL,
  shadow_eligible boolean NOT NULL,
  shadow_version_id text,
  shadow_registered_at timestamptz,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Guards ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_history_study() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Studies cannot be deleted'; END IF;
  IF NEW.id <> OLD.id OR NEW.version <> OLD.version OR NEW.rules <> OLD.rules OR NEW.rules_hash <> OLD.rules_hash
    OR NEW.manifest <> OLD.manifest OR NEW.manifest_hash <> OLD.manifest_hash OR NEW.research_code_hash <> OLD.research_code_hash
    OR NEW.observation_lag_sec <> OLD.observation_lag_sec OR NEW.trials <> OLD.trials OR NEW.registered_at <> OLD.registered_at
  THEN RAISE EXCEPTION 'A study''s registration is write-once'; END IF;
  IF OLD.split IS NOT NULL AND NEW.split IS DISTINCT FROM OLD.split THEN RAISE EXCEPTION 'A study''s split is fixed once'; END IF;
  IF OLD.dataset_hash IS NOT NULL AND (NEW.dataset_hash IS DISTINCT FROM OLD.dataset_hash OR NEW.dataset IS DISTINCT FROM OLD.dataset)
  THEN RAISE EXCEPTION 'A study''s dataset is frozen once built'; END IF;
  IF OLD.final_accessed_at IS NOT NULL AND NEW.final_accessed_at IS DISTINCT FROM OLD.final_accessed_at
  THEN RAISE EXCEPTION 'The final period is opened once'; END IF;
  IF OLD.status = 'evaluated' AND NEW.status <> 'evaluated' THEN RAISE EXCEPTION 'An evaluated study is final'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_history_studies ON public.history_studies;
CREATE TRIGGER protect_history_studies BEFORE UPDATE OR DELETE ON public.history_studies FOR EACH ROW EXECUTE FUNCTION public.guard_history_study();

CREATE OR REPLACE FUNCTION public.guard_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS protect_history_examples ON public.history_examples;
CREATE TRIGGER protect_history_examples BEFORE UPDATE OR DELETE ON public.history_examples FOR EACH ROW EXECUTE FUNCTION public.guard_history_append_only();

CREATE OR REPLACE FUNCTION public.guard_history_chunk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Chunk records cannot be deleted'; END IF;
  IF OLD.status = 'done' THEN RAISE EXCEPTION 'A finished chunk is write-once'; END IF;
  IF NEW.study_id <> OLD.study_id OR NEW.symbol <> OLD.symbol OR NEW.month <> OLD.month THEN RAISE EXCEPTION 'A chunk''s identity is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_history_chunks ON public.history_chunks;
CREATE TRIGGER protect_history_chunks BEFORE UPDATE OR DELETE ON public.history_chunks FOR EACH ROW EXECUTE FUNCTION public.guard_history_chunk();

CREATE OR REPLACE FUNCTION public.guard_history_trial() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO n FROM public.history_trials WHERE study_id = NEW.study_id;
    IF n >= 3 THEN RAISE EXCEPTION 'A study registers at most three trials'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Trials cannot be deleted'; END IF;
  IF NEW.spec <> OLD.spec OR NEW.spec_hash <> OLD.spec_hash OR NEW.ordinal <> OLD.ordinal OR NEW.study_id <> OLD.study_id
  THEN RAISE EXCEPTION 'A trial''s registration is write-once'; END IF;
  IF OLD.status <> 'registered' THEN
    IF NOT (OLD.status = 'evaluated' AND NEW.status = 'selected') OR NEW.folds IS DISTINCT FROM OLD.folds
      OR NEW.development IS DISTINCT FROM OLD.development OR NEW.validation IS DISTINCT FROM OLD.validation
    THEN RAISE EXCEPTION 'A measured trial is write-once'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_history_trials ON public.history_trials;
CREATE TRIGGER protect_history_trials BEFORE INSERT OR UPDATE OR DELETE ON public.history_trials FOR EACH ROW EXECUTE FUNCTION public.guard_history_trial();

CREATE OR REPLACE FUNCTION public.guard_history_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A final result cannot be deleted'; END IF;
  IF NEW.study_id <> OLD.study_id OR NEW.trial_id <> OLD.trial_id OR NEW.artifact <> OLD.artifact OR NEW.artifact_hash <> OLD.artifact_hash
    OR NEW.train_cutoff <> OLD.train_cutoff OR NEW.metrics <> OLD.metrics OR NEW.verdict <> OLD.verdict OR NEW.reasons <> OLD.reasons
    OR NEW.development_exposed <> OLD.development_exposed OR NEW.shadow_eligible <> OLD.shadow_eligible OR NEW.evaluated_at <> OLD.evaluated_at
  THEN RAISE EXCEPTION 'A final result is write-once'; END IF;
  IF OLD.shadow_version_id IS NOT NULL AND (NEW.shadow_version_id IS DISTINCT FROM OLD.shadow_version_id OR NEW.shadow_registered_at IS DISTINCT FROM OLD.shadow_registered_at)
  THEN RAISE EXCEPTION 'A shadow registration is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_history_finals ON public.history_finals;
CREATE TRIGGER protect_history_finals BEFORE UPDATE OR DELETE ON public.history_finals FOR EACH ROW EXECUTE FUNCTION public.guard_history_final();

CREATE OR REPLACE FUNCTION public.guard_history_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Run records cannot be deleted'; END IF;
  IF OLD.finished_at IS NOT NULL THEN RAISE EXCEPTION 'A finished run is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_history_runs ON public.history_runs;
CREATE TRIGGER protect_history_runs BEFORE UPDATE OR DELETE ON public.history_runs FOR EACH ROW EXECUTE FUNCTION public.guard_history_run();

-- Private: RLS on, no policies, no public grants.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['history_studies','history_runs','history_leases','history_chunks','history_examples','history_trials','history_finals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anonymous, authenticated', t);
  END LOOP;
END $$;

-- ── The one public surface: totals only (definer rights) ───────────────────
CREATE OR REPLACE VIEW public.history_overview AS
SELECT
  s.id, s.version, s.status, s.status_reason, s.registered_at, s.updated_at, s.observation_lag_sec, s.research_code_hash, s.code_sha,
  s.rules -> 'scope' AS scope,
  s.rules -> 'priorUse' AS prior_use,
  s.rules -> 'permissions' AS permissions,
  s.rules -> 'beginnings' AS beginnings,
  s.rules -> 'controls' AS controls,
  s.rules -> 'budget' AS budget_caps,
  s.manifest -> 'register' AS register,
  (s.manifest ->> 'plannedChunks')::integer AS planned_chunks,
  s.trials AS registered_trials,
  s.split, s.dataset, s.dataset_hash, s.final_accessed_at, s.budget,
  (SELECT jsonb_build_object(
     'done', count(*) FILTER (WHERE c.status = 'done'),
     'failed', count(*) FILTER (WHERE c.status = 'failed'),
     'bars', coalesce(sum(c.bars_read), 0),
     'bytes', coalesce(sum(c.bytes_read), 0),
     'runtime_ms', coalesce(sum(c.runtime_ms), 0),
     'ideas', coalesce(sum(c.ideas), 0),
     'gaps', coalesce(sum((c.quality ->> 'gaps')::integer), 0),
     'missing_bars', coalesce(sum((c.quality ->> 'missingBars')::integer), 0),
     'discontinuities', coalesce(sum((c.quality ->> 'discontinuities')::integer), 0),
     'ohlc_bad', coalesce(sum((c.quality ->> 'ohlcBad')::integer), 0),
     'duplicates', coalesce(sum((c.quality ->> 'duplicates')::integer), 0),
     'first_month', min(c.month) FILTER (WHERE c.status = 'done'),
     'last_month', max(c.month) FILTER (WHERE c.status = 'done'))
   FROM public.history_chunks c WHERE c.study_id = s.id) AS chunks,
  (SELECT jsonb_build_object(
     'total', count(*),
     'observation', count(*) FILTER (WHERE e.mode = 'observation'),
     'closed', count(*) FILTER (WHERE e.mode = 'observation' AND e.outcome_status = 'closed'),
     'quarantined', count(*) FILTER (WHERE e.mode = 'observation' AND e.quarantined),
     'by_reason', (SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*)::integer n FROM public.history_examples x
        WHERE x.study_id = s.id AND x.mode = 'observation' GROUP BY reason) r),
     'take_all_net_observation', coalesce(sum(e.net_pc * e.standalone_qty) FILTER (WHERE e.mode = 'observation' AND e.outcome_status = 'closed' AND NOT e.quarantined AND e.standalone_qty > 0), 0),
     'take_all_net_strategy', coalesce(sum(e.net_pc * e.standalone_qty) FILTER (WHERE e.mode = 'strategy' AND e.outcome_status = 'closed' AND NOT e.quarantined AND e.standalone_qty > 0), 0),
     'first_signal', min(e.signal_ts), 'last_signal', max(e.signal_ts))
   FROM public.history_examples e WHERE e.study_id = s.id) AS examples,
  coalesce((SELECT jsonb_agg(jsonb_build_object('ordinal', t.ordinal, 'spec', t.spec, 'status', t.status, 'reason', t.reason,
      'folds', t.folds,
      'development', CASE WHEN t.development IS NULL THEN NULL ELSE t.development - 'reliability' END,
      'validation', CASE WHEN t.validation IS NULL THEN NULL ELSE t.validation - 'reliability' END) ORDER BY t.ordinal)
   FROM public.history_trials t WHERE t.study_id = s.id), '[]'::jsonb) AS trials,
  (SELECT jsonb_build_object('trial_ordinal', t.ordinal, 'spec', t.spec, 'artifact_id', f.artifact ->> 'id', 'artifact_hash', f.artifact_hash,
      'train_cutoff', f.train_cutoff, 'train_rows', f.train_rows, 'metrics', f.metrics, 'verdict', f.verdict, 'reasons', f.reasons,
      'checks', f.checks, 'development_exposed', f.development_exposed, 'shadow_eligible', f.shadow_eligible,
      'shadow_version_id', f.shadow_version_id, 'shadow_registered_at', f.shadow_registered_at, 'evaluated_at', f.evaluated_at)
   FROM public.history_finals f JOIN public.history_trials t ON t.id = f.trial_id WHERE f.study_id = s.id) AS final,
  (SELECT jsonb_build_object('version_id', v.id, 'status', v.status, 'status_reason', v.status_reason, 'registered_at', v.registered_at,
      'scored', (SELECT count(*) FROM public.experiment_shadow_scores sc WHERE sc.model_version_id = v.id),
      'fresh_closed', (SELECT count(*) FROM public.experiment_shadow_scores sc
         JOIN public.experiment_decisions d ON d.decision_key = sc.decision_key
         JOIN public.experiment_outcomes o ON o.decision_key = sc.decision_key
         WHERE sc.model_version_id = v.id AND d.provenance = 'prospective' AND o.outcome_status = 'closed' AND o.standalone_qty > 0),
      'fresh_sessions', (SELECT count(DISTINCT d.session_key) FROM public.experiment_shadow_scores sc
         JOIN public.experiment_decisions d ON d.decision_key = sc.decision_key
         JOIN public.experiment_outcomes o ON o.decision_key = sc.decision_key
         WHERE sc.model_version_id = v.id AND d.provenance = 'prospective' AND o.outcome_status = 'closed' AND o.standalone_qty > 0),
      'reviews_passed', (SELECT count(*) FROM public.experiment_evaluations ev WHERE ev.model_version_id = v.id AND ev.kind = 'walk_forward' AND ev.verdict = 'pass'))
   FROM public.history_finals f JOIN public.experiment_model_versions v ON v.id = f.shadow_version_id WHERE f.study_id = s.id) AS shadow,
  (SELECT jsonb_build_object('signals', count(*), 'signals_closed', count(pnl_usd), 'signals_net', coalesce(sum(pnl_usd), 0),
      'first_signal', min(signal_ts), 'last_signal', max(signal_ts)) FROM public.signals) AS legacy_signals,
  (SELECT jsonb_build_object('shadows', count(*), 'shadows_closed', count(pnl_usd), 'shadows_net', coalesce(sum(pnl_usd), 0)) FROM public.shadow_signals) AS legacy_shadows,
  (SELECT jsonb_build_object('status', status, 'stage', stage, 'started_at', started_at, 'finished_at', finished_at, 'message', message)
   FROM public.history_runs r WHERE r.study_id = s.id ORDER BY started_at DESC LIMIT 1) AS last_run
FROM public.history_studies s;

GRANT SELECT ON public.history_overview TO anonymous, authenticated;
NOTIFY pgrst, 'reload schema';

-- 2026-10-08: delayed virtual account execution
-- Versioned delayed-market execution; registrations and earlier attempts stay frozen.
ALTER TABLE public.experiments ADD COLUMN IF NOT EXISTS execution_clock text NOT NULL DEFAULT 'wall_clock'
  CHECK (execution_clock IN ('wall_clock','delayed_market'));
ALTER TABLE public.experiments ADD COLUMN IF NOT EXISTS execution_version text NOT NULL DEFAULT 'wall-clock-v1';
ALTER TABLE public.experiments ADD COLUMN IF NOT EXISTS simulation_from timestamptz;
ALTER TABLE public.experiment_decisions ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE public.experiment_account ADD COLUMN IF NOT EXISTS data_as_of timestamptz;
ALTER TABLE public.experiment_account ADD COLUMN IF NOT EXISTS backlog_count integer NOT NULL DEFAULT 0 CHECK (backlog_count >= 0);
ALTER TABLE public.experiment_decisions DROP CONSTRAINT IF EXISTS experiment_decisions_reason_check;
ALTER TABLE public.experiment_decisions ADD CONSTRAINT experiment_decisions_reason_check CHECK
  (reason IN ('taken','model-skip','risk-budget','open-risk','daily-loss','locked','paused','stale-data',
   'stop-too-small','stop-breached','target-passed','idea-closed','session-over','no-risk','model-invalid','quota','late-source'));

CREATE TABLE IF NOT EXISTS public.experiment_source_batches (
  id text PRIMARY KEY,
  watermarks jsonb NOT NULL,
  source_sha text,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.experiment_source_ideas (
  opportunity_key text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES public.experiment_source_batches(id),
  signal_ts timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  signal_row jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS experiment_source_ideas_time ON public.experiment_source_ideas(signal_ts);
CREATE INDEX IF NOT EXISTS experiment_source_batches_time ON public.experiment_source_batches(published_at DESC);
ALTER TABLE public.experiment_source_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_source_ideas ENABLE ROW LEVEL SECURITY;
-- Setup snapshots are backend-only. Batch timestamps are public health data.
DROP POLICY IF EXISTS public_read ON public.experiment_source_batches;
CREATE POLICY public_read ON public.experiment_source_batches FOR SELECT TO anonymous, authenticated USING (true);
GRANT SELECT ON public.experiment_source_batches TO anonymous, authenticated;
DROP TRIGGER IF EXISTS protect_experiment_source_batches ON public.experiment_source_batches;
CREATE TRIGGER protect_experiment_source_batches BEFORE UPDATE OR DELETE ON public.experiment_source_batches
  FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_append_only();
DROP TRIGGER IF EXISTS protect_experiment_source_ideas ON public.experiment_source_ideas;
CREATE TRIGGER protect_experiment_source_ideas BEFORE UPDATE OR DELETE ON public.experiment_source_ideas
  FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_append_only();

CREATE OR REPLACE FUNCTION public.guard_experiment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Experiments cannot be deleted'; END IF;
  IF NEW.id <> OLD.id OR NEW.lineage <> OLD.lineage OR NEW.campaign <> OLD.campaign OR NEW.mode <> OLD.mode
    OR NEW.capital <> OLD.capital OR NEW.risk <> OLD.risk OR NEW.prereg <> OLD.prereg OR NEW.prereg_hash <> OLD.prereg_hash
    OR NEW.execution_clock <> OLD.execution_clock OR NEW.execution_version <> OLD.execution_version
    OR NEW.simulation_from IS DISTINCT FROM OLD.simulation_from
    OR NEW.seed <> OLD.seed OR NEW.started_at <> OLD.started_at OR NEW.data_label <> OLD.data_label
  THEN RAISE EXCEPTION 'An experiment''s registration is write-once'; END IF;
  IF OLD.status = 'stopped' THEN RAISE EXCEPTION 'A stopped experiment is write-once'; END IF;
  IF OLD.status = 'locked' AND NEW.status <> 'locked' AND NEW.status <> 'stopped' THEN
    RAISE EXCEPTION 'A locked campaign never reopens; preregister a new campaign';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.last_change_id IS NULL OR NEW.last_change_id IS NOT DISTINCT FROM OLD.last_change_id THEN
      RAISE EXCEPTION 'A status change needs its own change record';
    END IF;
    SELECT * INTO c FROM public.experiment_changes WHERE id = NEW.last_change_id;
    IF c IS NULL OR c.experiment_id <> NEW.id OR c.to_status IS DISTINCT FROM NEW.status THEN
      RAISE EXCEPTION 'The change record does not match this status change';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiments ON public.experiments;
CREATE TRIGGER protect_experiments BEFORE UPDATE OR DELETE ON public.experiments FOR EACH ROW EXECUTE FUNCTION public.guard_experiment();

CREATE OR REPLACE FUNCTION public.guard_experiment_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An experiment account cannot be deleted'; END IF;
  IF NEW.experiment_id <> OLD.experiment_id THEN RAISE EXCEPTION 'An account belongs to one experiment'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Account updates must advance the version by one'; END IF;
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN RAISE EXCEPTION 'A drawdown lock is permanent'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_account ON public.experiment_account;
CREATE TRIGGER protect_experiment_account BEFORE UPDATE OR DELETE ON public.experiment_account FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_account();

CREATE OR REPLACE FUNCTION public.guard_experiment_trade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE done boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME; END IF;
  IF TG_TABLE_NAME = 'experiment_positions' THEN
    done := OLD.status IN ('closed','cancelled');
    IF NEW.id <> OLD.id OR NEW.decision_key <> OLD.decision_key THEN RAISE EXCEPTION 'A position''s identity is write-once'; END IF;
  ELSE
    done := OLD.outcome_status IN ('closed','void');
    IF NEW.decision_key <> OLD.decision_key THEN RAISE EXCEPTION 'An outcome''s identity is write-once'; END IF;
    IF NEW.standalone_qty <> OLD.standalone_qty AND NOT (OLD.fill_ts IS NULL AND NEW.fill_ts IS NOT NULL AND OLD.outcome_status = 'pending')
    THEN RAISE EXCEPTION 'An outcome size can only be set at its first fill'; END IF;
  END IF;
  IF done THEN RAISE EXCEPTION 'A finished % row is write-once', TG_TABLE_NAME; END IF;
  IF NEW.symbol <> OLD.symbol OR NEW.side <> OLD.side OR NEW.stop <> OLD.stop OR NEW.target IS DISTINCT FROM OLD.target
    OR NEW.decided_at <> OLD.decided_at OR NEW.session_key <> OLD.session_key
  THEN RAISE EXCEPTION 'A trade''s plan is write-once'; END IF;
  IF OLD.fill_ts IS NOT NULL AND (NEW.fill_ts IS DISTINCT FROM OLD.fill_ts OR NEW.fill_price IS DISTINCT FROM OLD.fill_price)
  THEN RAISE EXCEPTION 'A fill is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_experiment_positions ON public.experiment_positions;
CREATE TRIGGER protect_experiment_positions BEFORE UPDATE OR DELETE ON public.experiment_positions FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_trade();
DROP TRIGGER IF EXISTS protect_experiment_outcomes ON public.experiment_outcomes;
CREATE TRIGGER protect_experiment_outcomes BEFORE UPDATE OR DELETE ON public.experiment_outcomes FOR EACH ROW EXECUTE FUNCTION public.guard_experiment_trade();


CREATE OR REPLACE VIEW public.experiment_trades WITH (security_invoker = true) AS
SELECT
  d.id, d.decision_key, d.experiment_id, d.opportunity_key, d.signal_id, d.symbol, d.side, d.session_key,
  d.seen_at, d.info_cutoff, d.decided_at, d.provenance, d.model_version_id, d.p_win, d.threshold, d.action, d.reason,
  coalesce(p.qty,d.qty) AS qty, d.est_risk, d.ref_price, d.idea, d.features, d.feature_version, d.snapshot_hash,
  p.id AS position_id, p.status AS position_status, p.cancel_reason, p.fill_ts, p.fill_price, p.entry_slip, p.risk,
  p.mark, p.mark_ts, p.stale, p.exit_ts, p.exit_price, p.exit_slip, p.exit_reason, p.ambiguous, p.gross, p.fees, p.net,
  o.outcome_status AS shadow_status, o.void_reason AS shadow_void_reason, o.standalone_qty AS shadow_qty,
  o.exit_reason AS shadow_exit_reason, o.net AS shadow_net_per_contract, o.ambiguous AS shadow_ambiguous,
  e.mode, e.data_label, e.campaign, e.lineage, e.execution_clock, e.execution_version,
  d.observed_at, d.created_at AS recorded_at,
  CASE WHEN e.execution_clock = 'delayed_market' THEN d.decided_at END AS market_decided_at
FROM public.experiment_decisions d
JOIN public.experiments e ON e.id = d.experiment_id
LEFT JOIN public.experiment_positions p ON p.decision_key = d.decision_key
LEFT JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key;


CREATE OR REPLACE VIEW public.experiment_health WITH (security_invoker = true) AS
SELECT e.lineage, e.id AS experiment_id, e.status,
  (SELECT last_ok_tick_at FROM public.experiment_account WHERE experiment_id = e.id) AS last_ok_tick_at,
  coalesce((SELECT jsonb_agg(x ORDER BY x.started_at DESC) FROM (
    SELECT job, status, started_at, finished_at, duration_ms, quota_level, db_bytes, message FROM public.experiment_runs
    WHERE experiment_id = e.id ORDER BY started_at DESC LIMIT 30) x), '[]'::jsonb) AS runs,
  (SELECT count(*)::integer FROM public.experiment_runs WHERE experiment_id = e.id AND status = 'error' AND started_at > now() - interval '24 hours') AS errors_24h,
  (SELECT data_as_of FROM public.experiment_account WHERE experiment_id=e.id) AS data_as_of,
  (SELECT backlog_count FROM public.experiment_account WHERE experiment_id=e.id) AS backlog_count,
  (SELECT count(*) FROM public.experiment_positions WHERE experiment_id=e.id AND status='pending_fill' AND updated_at<now()-interval '60 minutes') AS stuck_orders,
  e.execution_clock, e.started_at AS registered_at,
  (SELECT to_timestamp(least((watermarks->>'MES')::double precision,(watermarks->>'MNQ')::double precision)) FROM public.experiment_source_batches ORDER BY published_at DESC LIMIT 1) AS source_data_as_of
FROM public.experiments e WHERE e.status IN ('active','paused','locked');


NOTIFY pgrst, 'reload schema';

-- Display the actual filled size; frozen decision sizes remain audit inputs.
CREATE OR REPLACE VIEW public.experiment_overview WITH (security_invoker = true) AS
WITH cur AS (
  SELECT DISTINCT ON (lineage) * FROM public.experiments
  ORDER BY lineage, (status IN ('active','paused')) DESC, campaign DESC
)
SELECT
  e.lineage,
  to_jsonb(e) - 'prereg' - 'risk' AS experiment,
  e.risk,
  (SELECT to_jsonb(a) FROM public.experiment_account a WHERE a.experiment_id = e.id) AS account,
  (SELECT jsonb_build_object('version_id', p.model_version_id, 'previous_version_id', p.previous_version_id, 'since', p.updated_at,
     'kind', v.kind, 'spec', v.spec, 'status', v.status)
   FROM public.experiment_pointer p JOIN public.experiment_model_versions v ON v.id = p.model_version_id WHERE p.experiment_id = e.id) AS model,
  coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.decided_at DESC) FROM (
    SELECT p.*, d.id AS decision_id, d.opportunity_key, d.idea, d.provenance, d.model_version_id FROM public.experiment_positions p
    JOIN public.experiment_decisions d ON d.decision_key = p.decision_key
    WHERE p.experiment_id = e.id AND p.status IN ('pending_fill','open')) x), '[]'::jsonb) AS open_positions,
  (SELECT to_jsonb(x) FROM (
    SELECT p.*, d.id AS decision_id, d.opportunity_key, d.idea, d.provenance, d.model_version_id FROM public.experiment_positions p
    JOIN public.experiment_decisions d ON d.decision_key = p.decision_key
    WHERE p.experiment_id = e.id AND p.status = 'closed' ORDER BY p.exit_ts DESC LIMIT 1) x) AS latest_trade,
  coalesce((SELECT jsonb_object_agg(reason, n) FROM (
    SELECT reason, count(*)::integer n FROM public.experiment_decisions
    WHERE experiment_id = e.id AND session_key = (SELECT day_key FROM public.experiment_account WHERE experiment_id = e.id)
    GROUP BY reason) r), '{}'::jsonb) AS today_reasons,
  (SELECT jsonb_build_object('closed', count(*), 'net', coalesce(sum(net), 0), 'wins', count(*) FILTER (WHERE net > 0))
   FROM public.experiment_positions WHERE experiment_id = e.id AND status = 'closed' AND session_key = (SELECT day_key FROM public.experiment_account WHERE experiment_id = e.id)) AS today,
  (SELECT jsonb_build_object('closed', count(*), 'net', coalesce(sum(net), 0), 'wins', count(*) FILTER (WHERE net > 0),
     'fees', coalesce(sum(fees), 0))
   FROM public.experiment_positions WHERE experiment_id = e.id AND status = 'closed') AS campaign_totals,
  (SELECT jsonb_build_object('campaigns', count(DISTINCT x.id), 'closed', count(p.id), 'net', coalesce(sum(p.net), 0), 'first_start', min(x.started_at))
   FROM public.experiments x LEFT JOIN public.experiment_positions p ON p.experiment_id = x.id AND p.status = 'closed'
   WHERE x.lineage = e.lineage AND x.mode = e.mode) AS lifetime,
  (SELECT to_jsonb(c) FROM (SELECT id, kind, from_version, to_version, reason, created_at FROM public.experiment_changes
    WHERE experiment_id = e.id AND kind IN ('adopted','rejected','inconclusive','rolled_back','challenger_registered','challenger_invalid','retired')
    ORDER BY created_at DESC LIMIT 1) c) AS latest_learning,
  coalesce((SELECT jsonb_object_agg(job, r) FROM (
    SELECT DISTINCT ON (job) job, jsonb_build_object('status', status, 'started_at', started_at, 'finished_at', finished_at, 'message', message,
      'quota_level', quota_level, 'counts', counts) r
    FROM public.experiment_runs WHERE experiment_id = e.id ORDER BY job, started_at DESC) j), '{}'::jsonb) AS last_runs,
  coalesce((SELECT jsonb_object_agg(job, t) FROM (
    SELECT job, max(finished_at) t FROM public.experiment_runs WHERE experiment_id = e.id AND status IN ('ok','skipped') GROUP BY job) j), '{}'::jsonb) AS last_success,
  (SELECT quota_level FROM public.experiment_runs WHERE experiment_id = e.id AND quota_level IS NOT NULL ORDER BY started_at DESC LIMIT 1) AS quota_level,
  coalesce((SELECT jsonb_agg(x ORDER BY x.as_of) FROM (
    SELECT as_of, equity, realized FROM public.experiment_equity WHERE experiment_id = e.id AND kind = 'eod' ORDER BY as_of DESC LIMIT 90) x), '[]'::jsonb) AS equity_eod,
  coalesce((SELECT jsonb_agg(x ORDER BY x.decided_at DESC) FROM (
    SELECT d.id, d.opportunity_key, d.action, d.reason, coalesce(p.qty,d.qty) AS qty, d.decided_at, p.status AS position_status, p.net
    FROM public.experiment_decisions d LEFT JOIN public.experiment_positions p ON p.decision_key = d.decision_key
    WHERE d.experiment_id = e.id AND d.decided_at > now() - interval '30 days' ORDER BY d.decided_at DESC LIMIT 300) x), '[]'::jsonb) AS recent_decisions
FROM cur e;


NOTIFY pgrst, 'reload schema';
