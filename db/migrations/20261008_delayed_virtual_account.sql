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
