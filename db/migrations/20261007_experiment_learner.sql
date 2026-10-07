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
    'challenger_registered','challenger_invalid','adopted','rejected','inconclusive','retired','rolled_back','quota_level')),
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
NOTIFY pgrst, 'reload schema';
