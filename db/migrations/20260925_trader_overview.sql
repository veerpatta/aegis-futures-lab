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
FROM public.research_trials t
LEFT JOIN LATERAL (SELECT coalesce((SELECT outcome FROM public.research_measurements m WHERE m.candidate_key=t.trial_key ORDER BY measured_at DESC LIMIT 1),t.outcome) outcome) h ON true
LEFT JOIN LATERAL (SELECT outcome FROM public.research_confirmations c WHERE c.candidate_key=t.trial_key
 AND c.code_hash=h.outcome->>'codeHash' AND c.config_hash=h.outcome->>'configHash' ORDER BY measured_at DESC LIMIT 1) c ON true
LEFT JOIN LATERAL (SELECT count(*) closed,count(DISTINCT (signal_ts AT TIME ZONE 'America/New_York')::date) days,sum((payload->>'pnl')::numeric) net
 FROM public.research_observations o WHERE o.candidate_key=t.trial_key AND provenance='forward' AND exit_ts<=now()
 AND intent IS NOT NULL AND jsonb_typeof(payload->'pnl')='number' AND code_hash=h.outcome->>'codeHash' AND config_hash=h.outcome->>'configHash') f ON true
LEFT JOIN LATERAL (SELECT count(*) passes FROM public.paper_evaluations e WHERE e.candidate_key=t.trial_key
 AND e.code_hash=h.outcome->>'codeHash' AND e.config_hash=h.outcome->>'configHash' AND e.evidence->>'pass'='true') w ON true
WHERE t.trial_key LIKE '2026-09-25.%:%';

CREATE OR REPLACE VIEW public.bot_activity WITH (security_invoker=true) AS
SELECT 'training:'||id::text id,coalesce(finished_at,started_at) AS at,'Training'::text kind,status,
 CASE WHEN status='ok' THEN 'Training finished. Model qualification is checked separately.' WHEN status='running' THEN 'Training is running.' ELSE 'Training needs attention. Previous results remain recorded.' END detail
FROM (SELECT * FROM public.learning_runs ORDER BY started_at DESC LIMIT 20) l
UNION ALL SELECT 'release:'||id,activated_at,'Paper account',status,reason FROM public.paper_releases
UNION ALL SELECT 'decision:'||observation_key,decided_at,'Trade decision','recorded',reason FROM (SELECT * FROM public.paper_entry_decisions ORDER BY decided_at DESC LIMIT 20) d
UNION ALL SELECT 'research:'||id,coalesce(decided_at,registered_at),'Research',status,
 CASE WHEN outcome IS NULL THEN 'A fixed hypothesis was registered before testing.' WHEN outcome->'gate'->>'promote'='true' THEN 'Historical checks passed. Separate confirmation and forward evidence are still required.' ELSE 'Historical research finished. This result does not qualify for activation.' END FROM public.research_trials;
GRANT SELECT ON public.bot_overview,public.candidate_progress,public.bot_activity TO anonymous,authenticated;
NOTIFY pgrst, 'reload schema';
