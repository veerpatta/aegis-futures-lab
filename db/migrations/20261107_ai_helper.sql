-- Free AI helper (NVIDIA's free API): the AI second opinion study and the
-- owner-only coach notes. docs/AI-HELPER.md and
-- docs/research/2026-11-07-ai-second-opinion-preregistration.md.
--
-- Nothing here touches the learner, the account or any trading table: the
-- restricted aegis_ai role (the AI_DATABASE_URL login) gets read-only columns
-- of the learner's records and may only append to the new tables. The
-- browser roles get nothing: AI-written text is served to the owner by a
-- signed-in route, and the public scoreboard holds numbers only.
--
-- Apply with the owner role in one transaction. The one trigger function body
-- escapes its semicolons (\073) so the Neon MCP statement splitter cannot cut
-- it, as in 20261106_learner_v3_runner_fence.sql. Re-applying is harmless.

CREATE TABLE IF NOT EXISTS public.ai_judge_studies (
  id text PRIMARY KEY,
  label text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  feature_version text NOT NULL,
  config jsonb NOT NULL,
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'waiting-for-model')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  CHECK ((status = 'active') = (started_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.ai_judge_calls (
  event_key text PRIMARY KEY,
  study_id text NOT NULL REFERENCES public.ai_judge_studies(id),
  decision_key text NOT NULL CHECK (length(decision_key) BETWEEN 1 AND 256),
  kind text NOT NULL CHECK (kind IN ('claim', 'decision', 'invalid', 'error', 'probe')),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_judge_calls_study_decision ON public.ai_judge_calls (study_id, decision_key, kind);
CREATE INDEX IF NOT EXISTS ai_judge_calls_kind_time ON public.ai_judge_calls (kind, occurred_at DESC);
-- One final answer per study and decision, whatever wrote it.
CREATE UNIQUE INDEX IF NOT EXISTS ai_judge_calls_one_final ON public.ai_judge_calls (study_id, decision_key) WHERE kind IN ('decision', 'invalid');

CREATE TABLE IF NOT EXISTS public.ai_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('trade', 'day')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  facts_hash text NOT NULL CHECK (facts_hash ~ '^[0-9a-f]{64}$'),
  model text NOT NULL,
  prompt_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'rejected')),
  text text NOT NULL CHECK (length(text) <= 2000),
  reject_reason text,
  facts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, subject, facts_hash)
);
CREATE INDEX IF NOT EXISTS ai_notes_recent ON public.ai_notes (status, created_at DESC);

-- Calls and notes are append-only for every writer, owners included
-- (ai_research_append_only comes from 20261030_ai_research.sql).
DROP TRIGGER IF EXISTS protect_ai_judge_calls ON public.ai_judge_calls;
CREATE TRIGGER protect_ai_judge_calls BEFORE UPDATE OR DELETE ON public.ai_judge_calls FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_notes ON public.ai_notes;
CREATE TRIGGER protect_ai_notes BEFORE UPDATE OR DELETE ON public.ai_notes FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();

-- A study's registration is write-once. The single allowed change: a study
-- waiting for its model becomes active, once, when the model first answers.
CREATE OR REPLACE FUNCTION public.ai_judge_study_guard() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF TG_OP = ''UPDATE'' AND OLD.status = ''waiting-for-model'' AND NEW.status = ''active''
  AND OLD.started_at IS NULL AND NEW.started_at IS NOT NULL
  AND NEW.id = OLD.id AND NEW.label = OLD.label AND NEW.model = OLD.model
  AND NEW.prompt_version = OLD.prompt_version AND NEW.feature_version = OLD.feature_version
  AND NEW.config = OLD.config AND NEW.config_hash = OLD.config_hash AND NEW.registered_at = OLD.registered_at THEN
  RETURN NEW\073
 END IF\073
 RAISE EXCEPTION ''AI judge studies are write-once; only a waiting study may start: %'', OLD.id\073
END ';
DROP TRIGGER IF EXISTS protect_ai_judge_studies ON public.ai_judge_studies;
CREATE TRIGGER protect_ai_judge_studies BEFORE UPDATE OR DELETE ON public.ai_judge_studies FOR EACH ROW EXECUTE FUNCTION public.ai_judge_study_guard();

-- Private tables: no browser access at all.
ALTER TABLE public.ai_judge_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_judge_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_judge_studies, public.ai_judge_calls, public.ai_notes FROM PUBLIC, anonymous, authenticated;

-- The AI server role: read its own tables, append calls and notes, and make
-- the one allowed study transition.
GRANT SELECT ON public.ai_judge_studies TO aegis_ai;
GRANT UPDATE (status, started_at) ON public.ai_judge_studies TO aegis_ai;
GRANT SELECT, INSERT ON public.ai_judge_calls, public.ai_notes TO aegis_ai;
DROP POLICY IF EXISTS ai_judge_studies_read ON public.ai_judge_studies;
CREATE POLICY ai_judge_studies_read ON public.ai_judge_studies FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_judge_studies_start ON public.ai_judge_studies;
CREATE POLICY ai_judge_studies_start ON public.ai_judge_studies FOR UPDATE TO aegis_ai USING (status = 'waiting-for-model') WITH CHECK (status = 'active');
DROP POLICY IF EXISTS ai_judge_calls_read ON public.ai_judge_calls;
CREATE POLICY ai_judge_calls_read ON public.ai_judge_calls FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_judge_calls_append ON public.ai_judge_calls;
CREATE POLICY ai_judge_calls_append ON public.ai_judge_calls FOR INSERT TO aegis_ai WITH CHECK (true);
DROP POLICY IF EXISTS ai_notes_read ON public.ai_notes;
CREATE POLICY ai_notes_read ON public.ai_notes FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_notes_append ON public.ai_notes;
CREATE POLICY ai_notes_append ON public.ai_notes FOR INSERT TO aegis_ai WITH CHECK (true);

-- Read-only columns of the learner's records (all of them already public to
-- the browser roles) that the second opinion and the coach use.
GRANT SELECT (id, lineage, campaign, status) ON public.experiments TO aegis_ai;
GRANT SELECT (decision_key, experiment_id, symbol, side, session_key, info_cutoff, decided_at, created_at, action, reason, est_risk, idea, features)
  ON public.experiment_decisions TO aegis_ai;
GRANT SELECT (decision_key, outcome_status, status, net, standalone_qty, exit_reason, exit_price, exit_ts, fill_price, fill_ts)
  ON public.experiment_outcomes TO aegis_ai;
GRANT SELECT (decision_key, experiment_id, session_key, status, qty, fill_price, fill_ts, exit_price, exit_ts, exit_reason, net, cancel_reason)
  ON public.experiment_positions TO aegis_ai;
GRANT SELECT (experiment_id, equity) ON public.experiment_account TO aegis_ai;
GRANT SELECT (symbol, source, time, open, high, low, close) ON public.bars_5m TO aegis_ai;
DROP POLICY IF EXISTS ai_helper_read ON public.experiments;
CREATE POLICY ai_helper_read ON public.experiments FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_helper_read ON public.experiment_decisions;
CREATE POLICY ai_helper_read ON public.experiment_decisions FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_helper_read ON public.experiment_outcomes;
CREATE POLICY ai_helper_read ON public.experiment_outcomes FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_helper_read ON public.experiment_positions;
CREATE POLICY ai_helper_read ON public.experiment_positions FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_helper_read ON public.experiment_account;
CREATE POLICY ai_helper_read ON public.experiment_account FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_helper_read ON public.bars_5m;
CREATE POLICY ai_helper_read ON public.bars_5m FOR SELECT TO aegis_ai USING (true);

-- Registration (lib/ai-judge/studies.ts; tests/ai-judge-studies.test.ts pins
-- these hashes). Nemotron 3 Ultra starts now; Kimi K3.1 Pro waits for its
-- first answer on NVIDIA's API.
INSERT INTO public.ai_judge_studies (id, label, model, prompt_version, feature_version, config, config_hash, status, registered_at, started_at)
VALUES ('ai-judge-nemotron-ultra-v1', 'Nemotron 3 Ultra', 'nvidia/nemotron-3-ultra-550b-a55b', 'ai-judge-prompt-v1', 'ai-judge-features-v1',
  '{"id":"ai-judge-nemotron-ultra-v1","label":"Nemotron 3 Ultra","model":"nvidia/nemotron-3-ultra-550b-a55b","promptVersion":"ai-judge-prompt-v1","featureVersion":"ai-judge-features-v1","initialStatus":"active","rules":{"population":"Every decision (take or skip, paused methods included) of the active learner campaign recorded at or after the study start.","freshnessSeconds":7200,"inputs":"The idea, the learner''s saved features and context from bars_5m bars that ended at or before the decision''s information cutoff. Nothing later.","output":"One JSON object: decision take|skip, confidence 0-100 (rounded to a whole number) and a plain-English reason (asked for at most 60 words). An answer without a usable decision, confidence and reason is recorded as invalid and never re-asked. Provider failures (no answer seen) may be retried while the two-hour window is open, at most three attempts.","outcome":"The learner''s one-contract shadow result for the decision, after modelled costs (experiment_outcomes.net). Void outcomes and ideas the account could not take even one contract of are excluded.","controls":["take-all","no-trade","matched-random"],"bootstrap":{"iterations":2000,"random":2000},"looks":[{"resolved":60,"sessions":15,"alpha":0.01,"percentile":99},{"resolved":150,"sessions":15,"alpha":0.05,"percentile":95}],"lookTiming":"Each look is taken once, at the first moment its minimum resolved calls and sessions are both met, on the calls resolved up to then in decision order. A pass or a fail at a look is final. Otherwise the next look follows. The running totals shown between looks are information, not a verdict.","takeRate":{"min":0.1,"max":0.9},"pass":"At a look: the per-idea delta (AI picks minus take-all) has its interval''s lower bound above 0, the matched-random percentile is at least the look''s, the AI''s own picks made money after costs, and it took between 10% and 90% of ideas.","fail":"At a look: the delta''s upper bound is below 0, or the AI''s picks made less than take-all while the matched-random percentile is below 50.","consequence":"A pass only makes an AI filter eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes automatically."}}'::jsonb,
  '8c971da6e9cbd149cd9f953f92f3fe1f0eb6b148a018378f938b56b5fb124a68', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_judge_studies (id, label, model, prompt_version, feature_version, config, config_hash, status, registered_at, started_at)
VALUES ('ai-judge-kimi-k3.1-pro-v1', 'Kimi K3.1 Pro', 'moonshotai/kimi-k3.1-pro', 'ai-judge-prompt-v1', 'ai-judge-features-v1',
  '{"id":"ai-judge-kimi-k3.1-pro-v1","label":"Kimi K3.1 Pro","model":"moonshotai/kimi-k3.1-pro","promptVersion":"ai-judge-prompt-v1","featureVersion":"ai-judge-features-v1","initialStatus":"waiting-for-model","rules":{"population":"Every decision (take or skip, paused methods included) of the active learner campaign recorded at or after the study start.","freshnessSeconds":7200,"inputs":"The idea, the learner''s saved features and context from bars_5m bars that ended at or before the decision''s information cutoff. Nothing later.","output":"One JSON object: decision take|skip, confidence 0-100 (rounded to a whole number) and a plain-English reason (asked for at most 60 words). An answer without a usable decision, confidence and reason is recorded as invalid and never re-asked. Provider failures (no answer seen) may be retried while the two-hour window is open, at most three attempts.","outcome":"The learner''s one-contract shadow result for the decision, after modelled costs (experiment_outcomes.net). Void outcomes and ideas the account could not take even one contract of are excluded.","controls":["take-all","no-trade","matched-random"],"bootstrap":{"iterations":2000,"random":2000},"looks":[{"resolved":60,"sessions":15,"alpha":0.01,"percentile":99},{"resolved":150,"sessions":15,"alpha":0.05,"percentile":95}],"lookTiming":"Each look is taken once, at the first moment its minimum resolved calls and sessions are both met, on the calls resolved up to then in decision order. A pass or a fail at a look is final. Otherwise the next look follows. The running totals shown between looks are information, not a verdict.","takeRate":{"min":0.1,"max":0.9},"pass":"At a look: the per-idea delta (AI picks minus take-all) has its interval''s lower bound above 0, the matched-random percentile is at least the look''s, the AI''s own picks made money after costs, and it took between 10% and 90% of ideas.","fail":"At a look: the delta''s upper bound is below 0, or the AI''s picks made less than take-all while the matched-random percentile is below 50.","consequence":"A pass only makes an AI filter eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes automatically."}}'::jsonb,
  'ca0815c88b04c76fbc98f6d7ea3917a3e80e9713838efd88c759d46faaedffd3', 'waiting-for-model', now(), NULL)
ON CONFLICT (id) DO NOTHING;
