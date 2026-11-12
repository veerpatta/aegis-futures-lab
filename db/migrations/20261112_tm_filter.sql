-- Time machine filter test (tm-filter-v1):
-- docs/research/2026-11-12-time-machine-filter-preregistration.md.
--
-- Three write-once tables. Studies are registered once, each per-decision call
-- is stored once, and each look is stored once and never recomputed. Nothing
-- here touches the learner, the account or any trading table. All three hold
-- numbers only, so the browser may read them.
--
-- Apply with the owner role in one transaction. Trigger bodies escape their
-- semicolons (\073) so the Neon MCP statement splitter cannot cut them, as in
-- 20261107_ai_helper.sql. Re-applying is harmless.

CREATE TABLE IF NOT EXISTS public.tm_filter_studies (
  id text PRIMARY KEY,
  version text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('historical', 'forward')),
  rules jsonb NOT NULL,
  rules_hash text NOT NULL CHECK (rules_hash ~ '^[0-9a-f]{64}$'),
  code_sha text,
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tm_filter_calls (
  study_id text NOT NULL REFERENCES public.tm_filter_studies(id),
  decision_key text NOT NULL CHECK (length(decision_key) BETWEEN 1 AND 256),
  decided_at timestamptz NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  skip boolean NOT NULL,
  edge_r numeric,
  avg_r numeric,
  cost_r numeric,
  target_first numeric,
  stop_first numeric,
  neither numeric,
  sessions integer,
  refusal text CHECK (refusal IS NULL OR length(refusal) <= 60),
  PRIMARY KEY (study_id, decision_key),
  CHECK (ok OR NOT skip)
);

CREATE TABLE IF NOT EXISTS public.tm_filter_looks (
  study_id text NOT NULL REFERENCES public.tm_filter_studies(id),
  look smallint NOT NULL CHECK (look IN (0, 1, 2)),
  taken_at timestamptz NOT NULL DEFAULT now(),
  window_size integer NOT NULL CHECK (window_size > 0),
  last_decision_key text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass', 'fail', 'inconclusive')),
  result jsonb NOT NULL,
  PRIMARY KEY (study_id, look)
);

CREATE OR REPLACE FUNCTION public.tm_filter_append_only() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 RAISE EXCEPTION ''Time machine filter evidence is write-once: %'', TG_TABLE_NAME\073
END ';

-- A forward call must be stored within 24 hours of its decision (the historical study has no clock).
CREATE OR REPLACE FUNCTION public.tm_filter_call_guard() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF (SELECT kind FROM public.tm_filter_studies s WHERE s.id = NEW.study_id) = ''forward''
  AND now() > NEW.decided_at + interval ''24 hours'' THEN
  RAISE EXCEPTION ''A forward time machine call must be stored within 24 hours of its decision: %'', NEW.decision_key\073
 END IF\073
 NEW.computed_at := now()\073
 RETURN NEW\073
END ';

DROP TRIGGER IF EXISTS protect_tm_filter_studies ON public.tm_filter_studies;
CREATE TRIGGER protect_tm_filter_studies BEFORE UPDATE OR DELETE ON public.tm_filter_studies FOR EACH ROW EXECUTE FUNCTION public.tm_filter_append_only();
DROP TRIGGER IF EXISTS protect_tm_filter_calls ON public.tm_filter_calls;
CREATE TRIGGER protect_tm_filter_calls BEFORE UPDATE OR DELETE ON public.tm_filter_calls FOR EACH ROW EXECUTE FUNCTION public.tm_filter_append_only();
DROP TRIGGER IF EXISTS guard_tm_filter_calls ON public.tm_filter_calls;
CREATE TRIGGER guard_tm_filter_calls BEFORE INSERT ON public.tm_filter_calls FOR EACH ROW EXECUTE FUNCTION public.tm_filter_call_guard();
DROP TRIGGER IF EXISTS protect_tm_filter_looks ON public.tm_filter_looks;
CREATE TRIGGER protect_tm_filter_looks BEFORE UPDATE OR DELETE ON public.tm_filter_looks FOR EACH ROW EXECUTE FUNCTION public.tm_filter_append_only();
DROP TRIGGER IF EXISTS no_truncate_tm_filter_studies ON public.tm_filter_studies;
CREATE TRIGGER no_truncate_tm_filter_studies BEFORE TRUNCATE ON public.tm_filter_studies FOR EACH STATEMENT EXECUTE FUNCTION public.tm_filter_append_only();
DROP TRIGGER IF EXISTS no_truncate_tm_filter_calls ON public.tm_filter_calls;
CREATE TRIGGER no_truncate_tm_filter_calls BEFORE TRUNCATE ON public.tm_filter_calls FOR EACH STATEMENT EXECUTE FUNCTION public.tm_filter_append_only();
DROP TRIGGER IF EXISTS no_truncate_tm_filter_looks ON public.tm_filter_looks;
CREATE TRIGGER no_truncate_tm_filter_looks BEFORE TRUNCATE ON public.tm_filter_looks FOR EACH STATEMENT EXECUTE FUNCTION public.tm_filter_append_only();

ALTER TABLE public.tm_filter_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tm_filter_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tm_filter_looks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tm_filter_studies_public_read ON public.tm_filter_studies;
CREATE POLICY tm_filter_studies_public_read ON public.tm_filter_studies FOR SELECT TO anonymous, authenticated USING (true);
DROP POLICY IF EXISTS tm_filter_calls_public_read ON public.tm_filter_calls;
CREATE POLICY tm_filter_calls_public_read ON public.tm_filter_calls FOR SELECT TO anonymous, authenticated USING (true);
DROP POLICY IF EXISTS tm_filter_looks_public_read ON public.tm_filter_looks;
CREATE POLICY tm_filter_looks_public_read ON public.tm_filter_looks FOR SELECT TO anonymous, authenticated USING (true);
GRANT SELECT ON public.tm_filter_studies, public.tm_filter_calls, public.tm_filter_looks TO anonymous, authenticated;
