-- Learner v3 rules (docs/research/2026-11-06-learner-v3-preregistration.md).
--
-- The learner's Neon Function "aegisexp" reports build f194c9a (AEGIS_CODE_SHA) and
-- can only be redeployed with the owner's Neon API key. That build knows the v1/v2
-- rules only: its tick would decide a v3 campaign with the old idea filter and the
-- old limits, and its learn/review would stop on the unknown rules version.
--
-- This fence refuses any run of a campaign registered under rules newer than v2
-- when the run comes from that build, so it can never act for a v3 campaign even
-- if its triggers are switched back on. Runs from GitHub (main's code) pass, and so
-- does the function once it is redeployed with a new AEGIS_CODE_SHA. Campaigns
-- under v1/v2 rules are untouched. Apply at the v3 handover (docs/ENGINE-CLOCK.md).
-- The function body escapes semicolons (\073) so the Neon MCP statement splitter
-- cannot cut it, as in 20261030_owner_controls_reconstructed.sql.

CREATE OR REPLACE FUNCTION public.refuse_outdated_learner_run() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF NEW.trigger = ''neon'' AND NEW.code_sha = ''f194c9a99c5e9bd1131863897839d42d959403f8''
  AND EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = NEW.experiment_id
   AND coalesce(e.prereg->>''version'', '''') NOT IN (''exp-prereg-2026-10-07'', ''exp-prereg-2026-10-07-v2'')) THEN
  RAISE EXCEPTION ''Learner build f194c9a predates the rules of campaign %; redeploy it before it may run'', NEW.experiment_id\073
 END IF\073
 RETURN NEW\073
END ';
DROP TRIGGER IF EXISTS refuse_outdated_learner_run ON public.experiment_runs;
CREATE TRIGGER refuse_outdated_learner_run BEFORE INSERT ON public.experiment_runs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_outdated_learner_run();
