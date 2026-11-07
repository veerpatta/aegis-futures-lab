-- DeepSeek V4.1 Flash for the free AI helper (docs/AI-HELPER.md), and a shared
-- record of which free models are answering.
--
-- 1. ai_model_health: one row per model, written by the AI server role after
--    every attempt (lib/ai-free/health.ts). A model whose last attempts failed
--    rests before it is asked again (15 minutes, doubling, at most six hours),
--    and a model on probation (DeepSeek V4.1 Flash) is asked by no chain until
--    it has answered once. Operational state, not evidence: rows change, no
--    AI text is stored, and the browser roles get nothing.
-- 2. Registers the DeepSeek V4.1 Flash second-opinion study, waiting for the
--    model's first answer, with the same frozen rules as the other two
--    (lib/ai-judge/studies.ts, whose hash tests/ai-judge-studies.test.ts pins,
--    and docs/research/2026-11-07-ai-second-opinion-deepseek-addendum.md).
--
-- Additive and idempotent. No function bodies, so each statement survives the
-- Neon MCP statement splitter. Apply with the owner role in one transaction.

CREATE TABLE IF NOT EXISTS public.ai_model_health (
  model text PRIMARY KEY CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'),
  ok_at timestamptz,
  fail_at timestamptz,
  fails integer NOT NULL DEFAULT 0 CHECK (fails BETWEEN 0 AND 1000),
  fail_code text CHECK (fail_code IS NULL OR fail_code ~ '^[a-z-]{1,32}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_model_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_model_health FROM PUBLIC, anonymous, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_model_health TO aegis_ai;
DROP POLICY IF EXISTS ai_model_health_read ON public.ai_model_health;
CREATE POLICY ai_model_health_read ON public.ai_model_health FOR SELECT TO aegis_ai USING (true);
DROP POLICY IF EXISTS ai_model_health_add ON public.ai_model_health;
CREATE POLICY ai_model_health_add ON public.ai_model_health FOR INSERT TO aegis_ai WITH CHECK (true);
DROP POLICY IF EXISTS ai_model_health_change ON public.ai_model_health;
CREATE POLICY ai_model_health_change ON public.ai_model_health FOR UPDATE TO aegis_ai USING (true) WITH CHECK (true);

-- Registration: waits for DeepSeek V4.1 Flash's first answer on NVIDIA's API
-- (on 2026-11-06 every request ended with a 502 after about 30 s).
INSERT INTO public.ai_judge_studies (id, label, model, prompt_version, feature_version, config, config_hash, status, registered_at, started_at)
VALUES ('ai-judge-deepseek-v4.1-flash-v1', 'DeepSeek V4.1 Flash', 'deepseek-ai/deepseek-v4.1-flash', 'ai-judge-prompt-v1', 'ai-judge-features-v1',
  '{"id":"ai-judge-deepseek-v4.1-flash-v1","label":"DeepSeek V4.1 Flash","model":"deepseek-ai/deepseek-v4.1-flash","promptVersion":"ai-judge-prompt-v1","featureVersion":"ai-judge-features-v1","initialStatus":"waiting-for-model","rules":{"population":"Every decision (take or skip, paused methods included) of the active learner campaign recorded at or after the study start.","freshnessSeconds":7200,"freshness":"A decision is asked, and its answer recorded, within two hours of the decision being recorded. The database refuses an answer recorded later.","inputs":"The idea, the learner''s saved features and context from bars_5m bars that ended at or before the decision''s information cutoff. Nothing later.","output":"One JSON object: decision take|skip, confidence 0-100 (rounded to a whole number) and a plain-English reason (asked for at most 60 words). An answer without a usable decision, confidence and reason, including an empty answer, is recorded as invalid and never re-asked. A provider failure (no answer seen) may be retried while the two-hour window is open, at most three attempts. An attempt left without an answer or an error for over 3 minutes (a crash or a failed save) counts as one of the three.","outcome":"The learner''s one-contract shadow result for the decision, after modelled costs (experiment_outcomes.net). Excluded, as in the learner''s own dataset: void outcomes (no fill was possible, including cancelled simulations) and ideas the account could not take even one contract of.","controls":["take-all","no-trade","matched-random"],"bootstrap":{"iterations":2000,"random":2000},"looks":[{"resolved":60,"sessions":15,"alpha":0.01,"percentile":99},{"resolved":150,"sessions":15,"alpha":0.05,"percentile":95}],"lookTiming":"Calls are ordered by when their decision was recorded. A look''s window is the shortest prefix of that order with its minimum resolved calls and sessions (excluded calls are skipped). The look is taken only when every call in the window is final and two hours have passed since the window''s last decision, so the window can never change. Its result is stored once and never recomputed. A pass or a fail at a look is final. Otherwise the next look follows. The running totals shown between looks are information, not a verdict.","takeRate":{"min":0.1,"max":0.9},"pass":"At a look: the per-idea delta (AI picks minus take-all) has its interval''s lower bound above 0, the matched-random percentile is at least the look''s, the AI''s own picks made money after costs, and it took between 10% and 90% of ideas.","fail":"At a look: the delta''s upper bound is below 0, or the AI''s picks made less than take-all while the matched-random percentile is below 50.","consequence":"A pass only makes an AI filter eligible for a future campaign that the owner starts under its own preregistered rules. Nothing changes automatically."}}'::jsonb,
  '0f6364f6512b1d128d86b9d2c65f9fedd53a0e881dc838ec8d11e5144ac117e8', 'waiting-for-model', now(), NULL)
ON CONFLICT (id) DO NOTHING;
