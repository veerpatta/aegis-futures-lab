-- 2026-10-07: Amendment 1 to exp-prereg-2026-10-07 — the challenger lifecycle only.
--
-- A campaign's stored rules (experiments.prereg) are write-once, so a
-- correction is recorded as an AMENDMENT: a `rules_amended` row in the
-- campaign's append-only change history. lib/experiment/prereg.ts declares the
-- amendment (AMENDMENTS); the jobs apply it only when this record exists, only
-- to challengers registered after it, and refuse a record whose rules differ
-- from the declaration. Every evidence floor, the search grid, the rollback rule
-- and the risk limits are unchanged.
--
-- Why: at the measured idea rate a native challenger was always retired after
-- 6 weeks / 6 inconclusive reviews, before the 150 out-of-sample and the fresh
-- 20-session / 60-decision floors are reachable, and the 18-spec grid was used
-- up within 6 weeks — so the learner could never adopt anything. No native
-- challenger existed when this was recorded.
--
-- New rule: up to 52 weeks of shadowing; only inconclusive reviews that already
-- had the minimum out-of-sample outcomes count toward the 6-in-a-row retirement;
-- at most 3 native challengers shadow at once (a new one fills a free slot).
-- docs/research/2026-10-07-experiment-preregistration.md, "Amendment 1".

ALTER TABLE public.experiment_changes DROP CONSTRAINT IF EXISTS experiment_changes_kind_check;
ALTER TABLE public.experiment_changes ADD CONSTRAINT experiment_changes_kind_check CHECK (kind IN ('created','campaign_started','paused','resumed','locked','stopped','day_halted',
  'challenger_registered','challenger_invalid','adopted','rejected','inconclusive','retired','rolled_back','quota_level','rules_amended'));

INSERT INTO public.experiment_changes(experiment_id, kind, reason, evidence, actor, event_key)
SELECT e.id, 'rules_amended',
  'Amendment 1: a candidate may now be tested for up to 52 weeks, at most 3 at a time, so it can reach the fresh-results floors. Evidence floors unchanged; applies to candidates registered from now on.',
  jsonb_build_object(
    'amendment', 'exp-amend-2026-10-07-lifecycle',
    'section', 'lifecycle',
    'campaignPrereg', e.prereg ->> 'version',
    'campaignPreregHash', e.prereg_hash,
    'appliesTo', 'challengers registered after this record; search slots from this record on',
    'previous', e.prereg -> 'lifecycle',
    'rules', jsonb_build_object('maxInconclusive', 6, 'inconclusiveCounts', 'informative', 'shadowWeeks', 52, 'maxShadowing', 3),
    'nativeChallengersAtRecord', (SELECT count(*) FROM public.experiment_model_versions v WHERE v.experiment_id = e.id AND v.kind = 'logit')
  ),
  'owner',
  'amended:' || e.id || ':exp-amend-2026-10-07-lifecycle'
FROM public.experiments e
WHERE e.lineage = 'learner' AND e.status IN ('active','paused') AND e.prereg ->> 'version' = 'exp-prereg-2026-10-07'
ON CONFLICT (event_key) DO NOTHING;
