-- Apply after the AI research and shadow-bar migrations as an administrative
-- role. Bind a separately provisioned LOGIN role to aegis_ai, then use that
-- login's private connection string as AI_DATABASE_URL. No password belongs in
-- this migration. Do not grant membership to anonymous/authenticated roles.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aegis_ai') THEN
    CREATE ROLE aegis_ai NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aegis_ai'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Existing aegis_ai role has unsafe attributes';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'aegis_ai') THEN
    RAISE EXCEPTION 'Existing aegis_ai role has inherited role memberships';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid JOIN pg_roles r ON r.oid=m.member
             WHERE g.rolname='aegis_ai' AND r.rolname IN ('anonymous','authenticated')) THEN
    RAISE EXCEPTION 'Existing aegis_ai role is granted to a browser role';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO aegis_ai;

-- The server needs only these learner summary fields, not positions, trades,
-- source bars or other experiment tables. The view is owned by its privileged
-- migration role; its owner must be able to read the underlying RLS tables.
CREATE OR REPLACE VIEW public.ai_research_evidence WITH (security_barrier=true) AS
SELECT e.id AS experiment_id,e.status AS campaign_status,a.updated_at,a.equity,a.data_as_of,a.last_ok_tick_at,v.kind AS model_kind
FROM (SELECT DISTINCT ON (lineage) id,status,lineage FROM public.experiments
      ORDER BY lineage,(status IN ('active','paused')) DESC,campaign DESC) e
LEFT JOIN public.experiment_account a ON a.experiment_id=e.id
LEFT JOIN public.experiment_pointer p ON p.experiment_id=e.id
LEFT JOIN public.experiment_model_versions v ON v.id=p.model_version_id
WHERE e.lineage='learner';
REVOKE ALL ON public.ai_research_evidence FROM PUBLIC, anonymous, authenticated;
GRANT SELECT ON public.ai_research_evidence TO aegis_ai;

-- Explicit bounded source columns for the heartbeat, aggregate evidence and
-- post-capture eligibility check. No UPDATE on source, learner, or account.
GRANT SELECT (id,ran_at,status,signals_created,message) ON public.engine_runs TO aegis_ai;
GRANT SELECT (id,registered_at,decided_at,status,outcome) ON public.research_trials TO aegis_ai;
GRANT SELECT (dedupe_key,status,stale_data,orphaned,suppressed,symbol,entry_price,stop_price,target_price,exit_ts,exit_price,pnl_usd) ON public.signals TO aegis_ai;
DROP POLICY IF EXISTS ai_engine_read ON public.engine_runs;
CREATE POLICY ai_engine_read ON public.engine_runs FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_trials_read ON public.research_trials;
CREATE POLICY ai_trials_read ON public.research_trials FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_signals_read ON public.signals;
CREATE POLICY ai_signals_read ON public.signals FOR SELECT TO aegis_ai USING (true);

GRANT SELECT, INSERT ON public.ai_budget_reservations TO aegis_ai;
GRANT UPDATE (status,actual_micros) ON public.ai_budget_reservations TO aegis_ai;
GRANT SELECT, INSERT ON public.ai_research_requests, public.ai_research_results TO aegis_ai;
GRANT SELECT ON public.ai_shadow_studies TO aegis_ai;
GRANT SELECT, INSERT ON public.ai_shadow_snapshots, public.ai_shadow_events, public.ai_shadow_bars, public.ai_shadow_bar_revisions TO aegis_ai;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_budget_reservations','ai_research_requests','ai_research_results','ai_shadow_studies',
    'ai_shadow_snapshots','ai_shadow_events','ai_shadow_bars','ai_shadow_bar_revisions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS ai_server_select ON public.%I',t);
    EXECUTE format('CREATE POLICY ai_server_select ON public.%I FOR SELECT TO aegis_ai USING (true)',t);
    IF t <> 'ai_shadow_studies' THEN
      EXECUTE format('DROP POLICY IF EXISTS ai_server_insert ON public.%I',t);
      EXECUTE format('CREATE POLICY ai_server_insert ON public.%I FOR INSERT TO aegis_ai WITH CHECK (true)',t);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS ai_budget_settle ON public.ai_budget_reservations;
CREATE POLICY ai_budget_settle ON public.ai_budget_reservations FOR UPDATE TO aegis_ai USING (status='reserved') WITH CHECK (status='settled');
NOTIFY pgrst, 'reload schema';
