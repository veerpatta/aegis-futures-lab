-- Free AI helper (NVIDIA's free API): the AI second opinion study, the AI
-- research ideas, their frozen looks, and the owner-only notes.
-- docs/AI-HELPER.md, docs/research/2026-11-07-ai-second-opinion-preregistration.md,
-- docs/research/2026-11-07-ai-ideas-preregistration.md.
--
-- Nothing here touches the learner, the account or any trading table: the
-- restricted aegis_ai role (the AI_DATABASE_URL login) gets read-only columns
-- of the learner's records and may only append to the new tables (plus two
-- guarded transitions). The browser roles get nothing: AI-written text is
-- served to the owner by a signed-in route, and the public scoreboard holds
-- numbers only.
--
-- Apply with the owner role in one transaction. Trigger and DO bodies escape
-- their semicolons (\073) so the Neon MCP statement splitter cannot cut them,
-- as in 20261106_learner_v3_runner_fence.sql. Re-applying is harmless.

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

-- A look, once taken, is stored here and never recomputed (lib/ai-judge/looks.ts).
CREATE TABLE IF NOT EXISTS public.ai_looks (
  subject_kind text NOT NULL CHECK (subject_kind IN ('judge', 'idea')),
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 100),
  look smallint NOT NULL CHECK (look IN (1, 2)),
  taken_at timestamptz NOT NULL DEFAULT now(),
  window_size integer NOT NULL CHECK (window_size > 0),
  last_decision_key text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass', 'fail', 'inconclusive')),
  result jsonb NOT NULL,
  PRIMARY KEY (subject_kind, subject_id, look)
);

CREATE TABLE IF NOT EXISTS public.ai_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('trade', 'day', 'week')),
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

-- AI research ideas: skip rules the AI proposed, each tested only on
-- decisions recorded after it was proposed.
CREATE TABLE IF NOT EXISTS public.ai_hypotheses (
  id text PRIMARY KEY CHECK (id ~ '^idea-[0-9a-f]{12}$'),
  proposed_at timestamptz NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  rule jsonb NOT NULL,
  rule_hash text NOT NULL CHECK (rule_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('testing', 'retired')),
  retired_at timestamptz,
  retire_reason text CHECK (retire_reason IS NULL OR length(retire_reason) <= 200),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  CHECK ((status = 'retired') = (retire_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai_hypotheses_recent ON public.ai_hypotheses (proposed_at DESC);
-- The same rule is never tested twice at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS ai_hypotheses_one_testing ON public.ai_hypotheses (rule_hash) WHERE status = 'testing';

-- Calls, looks and notes are append-only for every writer, owners included
-- (ai_research_append_only comes from 20261030_ai_research.sql), and no table
-- here may be emptied with TRUNCATE.
DROP TRIGGER IF EXISTS protect_ai_judge_calls ON public.ai_judge_calls;
CREATE TRIGGER protect_ai_judge_calls BEFORE UPDATE OR DELETE ON public.ai_judge_calls FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_looks ON public.ai_looks;
CREATE TRIGGER protect_ai_looks BEFORE UPDATE OR DELETE ON public.ai_looks FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_notes ON public.ai_notes;
CREATE TRIGGER protect_ai_notes BEFORE UPDATE OR DELETE ON public.ai_notes FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS no_truncate_ai_judge_studies ON public.ai_judge_studies;
CREATE TRIGGER no_truncate_ai_judge_studies BEFORE TRUNCATE ON public.ai_judge_studies FOR EACH STATEMENT EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS no_truncate_ai_judge_calls ON public.ai_judge_calls;
CREATE TRIGGER no_truncate_ai_judge_calls BEFORE TRUNCATE ON public.ai_judge_calls FOR EACH STATEMENT EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS no_truncate_ai_looks ON public.ai_looks;
CREATE TRIGGER no_truncate_ai_looks BEFORE TRUNCATE ON public.ai_looks FOR EACH STATEMENT EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS no_truncate_ai_notes ON public.ai_notes;
CREATE TRIGGER no_truncate_ai_notes BEFORE TRUNCATE ON public.ai_notes FOR EACH STATEMENT EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS no_truncate_ai_hypotheses ON public.ai_hypotheses;
CREATE TRIGGER no_truncate_ai_hypotheses BEFORE TRUNCATE ON public.ai_hypotheses FOR EACH STATEMENT EXECUTE FUNCTION public.ai_research_append_only();

-- A study's registration is write-once. The single allowed change: a study
-- waiting for its model becomes active, once, when the model first answers,
-- with a start time of now (never backdated, which would pull earlier
-- decisions into its evidence).
CREATE OR REPLACE FUNCTION public.ai_judge_study_guard() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF TG_OP = ''UPDATE'' AND OLD.status = ''waiting-for-model'' AND NEW.status = ''active''
  AND OLD.started_at IS NULL AND NEW.started_at IS NOT NULL
  AND NEW.started_at BETWEEN now() - interval ''5 minutes'' AND now() + interval ''5 minutes''
  AND NEW.id = OLD.id AND NEW.label = OLD.label AND NEW.model = OLD.model
  AND NEW.prompt_version = OLD.prompt_version AND NEW.feature_version = OLD.feature_version
  AND NEW.config = OLD.config AND NEW.config_hash = OLD.config_hash AND NEW.registered_at = OLD.registered_at THEN
  RETURN NEW\073
 END IF\073
 RAISE EXCEPTION ''AI judge studies are write-once; only a waiting study may start, now: %'', OLD.id\073
END ';
DROP TRIGGER IF EXISTS protect_ai_judge_studies ON public.ai_judge_studies;
CREATE TRIGGER protect_ai_judge_studies BEFORE UPDATE OR DELETE ON public.ai_judge_studies FOR EACH ROW EXECUTE FUNCTION public.ai_judge_study_guard();

-- A final answer (decision or invalid) needs a claimed attempt and must be
-- recorded within two hours of its decision, whoever writes it.
CREATE OR REPLACE FUNCTION public.ai_judge_call_guard() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF NEW.kind IN (''decision'', ''invalid'') THEN
  IF NOT EXISTS (SELECT 1 FROM public.ai_judge_calls c WHERE c.study_id = NEW.study_id AND c.decision_key = NEW.decision_key AND c.kind = ''claim'') THEN
   RAISE EXCEPTION ''An AI answer needs a claimed attempt: %'', NEW.decision_key\073
  END IF\073
  IF NOT EXISTS (SELECT 1 FROM public.experiment_decisions d WHERE d.decision_key = NEW.decision_key AND now() <= d.created_at + interval ''2 hours'') THEN
   RAISE EXCEPTION ''An AI answer must be recorded within two hours of its decision: %'', NEW.decision_key\073
  END IF\073
 END IF\073
 RETURN NEW\073
END ';
DROP TRIGGER IF EXISTS guard_ai_judge_calls ON public.ai_judge_calls;
CREATE TRIGGER guard_ai_judge_calls BEFORE INSERT ON public.ai_judge_calls FOR EACH ROW EXECUTE FUNCTION public.ai_judge_call_guard();

-- A rule is proposed now (never backdated onto decisions it was fitted to),
-- at most three test at once, and the only change is testing -> retired, now.
CREATE OR REPLACE FUNCTION public.ai_hypothesis_guard() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF TG_OP = ''INSERT'' THEN
  IF NEW.status <> ''testing'' OR NEW.retired_at IS NOT NULL OR NEW.retire_reason IS NOT NULL
   OR NEW.proposed_at NOT BETWEEN now() - interval ''5 minutes'' AND now() + interval ''5 minutes'' THEN
   RAISE EXCEPTION ''A rule is proposed now, as testing: %'', NEW.id\073
  END IF\073
  IF (SELECT count(*) FROM public.ai_hypotheses h WHERE h.status = ''testing'') >= 3 THEN
   RAISE EXCEPTION ''At most three rules may be tested at once: %'', NEW.id\073
  END IF\073
  RETURN NEW\073
 END IF\073
 IF TG_OP = ''UPDATE'' AND OLD.status = ''testing'' AND NEW.status = ''retired''
  AND OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL AND NEW.retire_reason IS NOT NULL
  AND NEW.retired_at BETWEEN now() - interval ''5 minutes'' AND now() + interval ''5 minutes''
  AND NEW.id = OLD.id AND NEW.proposed_at = OLD.proposed_at AND NEW.model = OLD.model
  AND NEW.prompt_version = OLD.prompt_version AND NEW.rule = OLD.rule AND NEW.rule_hash = OLD.rule_hash THEN
  RETURN NEW\073
 END IF\073
 RAISE EXCEPTION ''AI hypotheses are write-once; only a testing rule may be retired, now: %'', OLD.id\073
END ';
DROP TRIGGER IF EXISTS protect_ai_hypotheses ON public.ai_hypotheses;
CREATE TRIGGER protect_ai_hypotheses BEFORE INSERT OR UPDATE OR DELETE ON public.ai_hypotheses FOR EACH ROW EXECUTE FUNCTION public.ai_hypothesis_guard();

-- Private tables: no browser access at all.
ALTER TABLE public.ai_judge_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_judge_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_looks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_hypotheses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_judge_studies, public.ai_judge_calls, public.ai_looks, public.ai_notes, public.ai_hypotheses FROM PUBLIC, anonymous, authenticated;

-- The AI server role: read its own tables, append calls, looks, notes and
-- rules, and make the two guarded transitions.
GRANT SELECT ON public.ai_judge_studies TO aegis_ai;
GRANT UPDATE (status, started_at) ON public.ai_judge_studies TO aegis_ai;
GRANT SELECT, INSERT ON public.ai_judge_calls, public.ai_looks, public.ai_notes, public.ai_hypotheses TO aegis_ai;
GRANT UPDATE (status, retired_at, retire_reason) ON public.ai_hypotheses TO aegis_ai;
DROP POLICY IF EXISTS ai_judge_studies_read ON public.ai_judge_studies;
CREATE POLICY ai_judge_studies_read ON public.ai_judge_studies FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_judge_studies_start ON public.ai_judge_studies;
CREATE POLICY ai_judge_studies_start ON public.ai_judge_studies FOR UPDATE TO aegis_ai USING (status = 'waiting-for-model') WITH CHECK (status = 'active');
DROP POLICY IF EXISTS ai_judge_calls_read ON public.ai_judge_calls;
CREATE POLICY ai_judge_calls_read ON public.ai_judge_calls FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_judge_calls_append ON public.ai_judge_calls;
CREATE POLICY ai_judge_calls_append ON public.ai_judge_calls FOR INSERT TO aegis_ai WITH CHECK (true);
DROP POLICY IF EXISTS ai_looks_read ON public.ai_looks;
CREATE POLICY ai_looks_read ON public.ai_looks FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_looks_append ON public.ai_looks;
CREATE POLICY ai_looks_append ON public.ai_looks FOR INSERT TO aegis_ai WITH CHECK (true);
DROP POLICY IF EXISTS ai_notes_read ON public.ai_notes;
CREATE POLICY ai_notes_read ON public.ai_notes FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_notes_append ON public.ai_notes;
CREATE POLICY ai_notes_append ON public.ai_notes FOR INSERT TO aegis_ai WITH CHECK (true);
DROP POLICY IF EXISTS ai_hypotheses_read ON public.ai_hypotheses;
CREATE POLICY ai_hypotheses_read ON public.ai_hypotheses FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_hypotheses_append ON public.ai_hypotheses;
CREATE POLICY ai_hypotheses_append ON public.ai_hypotheses FOR INSERT TO aegis_ai WITH CHECK (true);
DROP POLICY IF EXISTS ai_hypotheses_retire ON public.ai_hypotheses;
CREATE POLICY ai_hypotheses_retire ON public.ai_hypotheses FOR UPDATE TO aegis_ai USING (status = 'testing') WITH CHECK (status = 'retired');

-- Read-only columns of the learner's records (all of them already public to
-- the browser roles) that the second opinion, the coach and the ideas use.
GRANT SELECT (id, lineage, campaign, status) ON public.experiments TO aegis_ai;
GRANT SELECT (decision_key, experiment_id, opportunity_key, symbol, side, session_key, info_cutoff, decided_at, created_at, action, reason, est_risk, idea, features)
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

-- Server-side cap on every AI query (the app also caps each on the client).
-- Set on the login role, because Neon's connection pooler refuses a
-- statement_timeout startup parameter; skipped where that login does not exist.
DO E'
BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = ''aegis_ai_app'') THEN
  ALTER ROLE aegis_ai_app SET statement_timeout = ''10s''\073
 END IF\073
END ';

-- Registration (lib/ai-judge/studies.ts; tests/ai-judge-studies.test.ts pins
-- these hashes). Nemotron 3 Ultra starts now; Kimi K3.1 Pro waits for its
-- first answer on NVIDIA's API.
INSERT INTO public.ai_judge_studies (id, label, model, prompt_version, feature_version, config, config_hash, status, registered_at, started_at)
VALUES ('ai-judge-nemotron-ultra-v1', 'Nemotron 3 Ultra', 'nvidia/nemotron-3-ultra-550b-a55b', 'ai-judge-prompt-v1', 'ai-judge-features-v1',
  '{"id":"ai-judge-nemotron-ultra-v1","label":"Nemotron 3 Ultra","model":"nvidia/nemotron-3-ultra-550b-a55b","promptVersion":"ai-judge-prompt-v1","featureVersion":"ai-judge-features-v1","initialStatus":"active","rules":{"population":"Every decision (take or skip, paused methods included) of the active learner campaign recorded at or after the study start.","freshnessSeconds":7200,"freshness":"A decision is asked, and its answer recorded, within two hours of the decision being recorded. The database refuses an answer recorded later.","inputs":"The idea, the learner''s saved features and context from bars_5m bars that ended at or before the decision''s information cutoff. Nothing later.","output":"One JSON object: decision take|skip, confidence 0-100 (rounded to a whole number) and a plain-English reason (asked for at most 60 words). An answer without a usable decision, confidence and reason, including an empty answer, is recorded as invalid and never re-asked. A provider failure (no answer seen) may be retried while the two-hour window is open, at most three attempts. An attempt left without an answer or an error for over 3 minutes (a crash or a failed save) counts as one of the three.","outcome":"The learner''s one-contract shadow result for the decision, after modelled costs (experiment_outcomes.net). Excluded, as in the learner''s own dataset: void outcomes (no fill was possible, including cancelled simulations) and ideas the account could not take even one contract of.","controls":["take-all","no-trade","matched-random"],"bootstrap":{"iterations":2000,"random":2000},"looks":[{"resolved":60,"sessions":15,"alpha":0.01,"percentile":99},{"resolved":150,"sessions":15,"alpha":0.05,"percentile":95}],"lookTiming":"Calls are ordered by when their decision was recorded. A look''s window is the shortest prefix of that order with its minimum resolved calls and sessions (excluded calls are skipped). The look is taken only when every call in the window is final and two hours have passed since the window''s last decision, so the window can never change. Its result is stored once and never recomputed. A pass or a fail at a look is final. Otherwise the next look follows. The running totals shown between looks are information, not a verdict.","takeRate":{"min":0.1,"max":0.9},"pass":"At a look: the per-idea delta (AI picks minus take-all) has its interval''s lower bound above 0, the matched-random percentile is at least the look''s, the AI''s own picks made money after costs, and it took between 10% and 90% of ideas.","fail":"At a look: the delta''s upper bound is below 0, or the AI''s picks made less than take-all while the matched-random percentile is below 50.","consequence":"A pass only makes an AI filter eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes automatically."}}'::jsonb,
  'c16a838b9e272f406b09a56c2743c77b49f6df7c5795b3a8eda42156c6134b57', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_judge_studies (id, label, model, prompt_version, feature_version, config, config_hash, status, registered_at, started_at)
VALUES ('ai-judge-kimi-k3.1-pro-v1', 'Kimi K3.1 Pro', 'moonshotai/kimi-k3.1-pro', 'ai-judge-prompt-v1', 'ai-judge-features-v1',
  '{"id":"ai-judge-kimi-k3.1-pro-v1","label":"Kimi K3.1 Pro","model":"moonshotai/kimi-k3.1-pro","promptVersion":"ai-judge-prompt-v1","featureVersion":"ai-judge-features-v1","initialStatus":"waiting-for-model","rules":{"population":"Every decision (take or skip, paused methods included) of the active learner campaign recorded at or after the study start.","freshnessSeconds":7200,"freshness":"A decision is asked, and its answer recorded, within two hours of the decision being recorded. The database refuses an answer recorded later.","inputs":"The idea, the learner''s saved features and context from bars_5m bars that ended at or before the decision''s information cutoff. Nothing later.","output":"One JSON object: decision take|skip, confidence 0-100 (rounded to a whole number) and a plain-English reason (asked for at most 60 words). An answer without a usable decision, confidence and reason, including an empty answer, is recorded as invalid and never re-asked. A provider failure (no answer seen) may be retried while the two-hour window is open, at most three attempts. An attempt left without an answer or an error for over 3 minutes (a crash or a failed save) counts as one of the three.","outcome":"The learner''s one-contract shadow result for the decision, after modelled costs (experiment_outcomes.net). Excluded, as in the learner''s own dataset: void outcomes (no fill was possible, including cancelled simulations) and ideas the account could not take even one contract of.","controls":["take-all","no-trade","matched-random"],"bootstrap":{"iterations":2000,"random":2000},"looks":[{"resolved":60,"sessions":15,"alpha":0.01,"percentile":99},{"resolved":150,"sessions":15,"alpha":0.05,"percentile":95}],"lookTiming":"Calls are ordered by when their decision was recorded. A look''s window is the shortest prefix of that order with its minimum resolved calls and sessions (excluded calls are skipped). The look is taken only when every call in the window is final and two hours have passed since the window''s last decision, so the window can never change. Its result is stored once and never recomputed. A pass or a fail at a look is final. Otherwise the next look follows. The running totals shown between looks are information, not a verdict.","takeRate":{"min":0.1,"max":0.9},"pass":"At a look: the per-idea delta (AI picks minus take-all) has its interval''s lower bound above 0, the matched-random percentile is at least the look''s, the AI''s own picks made money after costs, and it took between 10% and 90% of ideas.","fail":"At a look: the delta''s upper bound is below 0, or the AI''s picks made less than take-all while the matched-random percentile is below 50.","consequence":"A pass only makes an AI filter eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes automatically."}}'::jsonb,
  'cf401d074f77dbf5905733f7845836f503d73a5985506cdcff326bf4d6b6afa3', 'waiting-for-model', now(), NULL)
ON CONFLICT (id) DO NOTHING;
