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
