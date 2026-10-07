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
