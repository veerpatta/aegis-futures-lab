-- 2026-10-03: candidate_progress reads ONE trial per candidate — the latest.
--
-- research_trials is keyed for uniqueness by config_hash, not trial_key. When
-- a candidate's research configuration changes (the 2026-10-03 risk-cap
-- change moves researchConfigHash), research-v2.ts registers a NEW trial row
-- under the same trial_key, as preregistration requires: a re-run is a new
-- trial and counts as one. Without this, the Bot screen would list every
-- candidate twice. Old trials stay in the table, in the multiple-testing count
-- and in bot_activity; only this progress view narrows to the latest.
--
-- Same output columns and types as before, so CREATE OR REPLACE is safe and the
-- existing grants are kept.

CREATE OR REPLACE VIEW public.candidate_progress WITH (security_invoker=true) AS
SELECT t.trial_key AS candidate_key,h.outcome AS historical,c.outcome AS confirmation,
 coalesce(f.closed,0)::integer AS forward_closed,coalesce(f.days,0)::integer AS forward_days,
 coalesce(f.net,0) AS forward_net,coalesce(w.passes,0)::integer AS weekly_passes
FROM (SELECT DISTINCT ON (trial_key) * FROM public.research_trials
      WHERE trial_key LIKE '2026-09-25.%:%' ORDER BY trial_key, registered_at DESC, id DESC) t
LEFT JOIN LATERAL (SELECT coalesce((SELECT outcome FROM public.research_measurements m WHERE m.candidate_key=t.trial_key ORDER BY measured_at DESC LIMIT 1),t.outcome) outcome) h ON true
LEFT JOIN LATERAL (SELECT outcome FROM public.research_confirmations c WHERE c.candidate_key=t.trial_key
 AND c.code_hash=h.outcome->>'codeHash' AND c.config_hash=h.outcome->>'configHash' ORDER BY measured_at DESC LIMIT 1) c ON true
LEFT JOIN LATERAL (SELECT count(*) closed,count(DISTINCT (signal_ts AT TIME ZONE 'America/New_York')::date) days,sum((payload->>'pnl')::numeric) net
 FROM public.research_observations o WHERE o.candidate_key=t.trial_key AND provenance='forward' AND exit_ts<=now()
 AND intent IS NOT NULL AND jsonb_typeof(payload->'pnl')='number' AND code_hash=h.outcome->>'codeHash' AND config_hash=h.outcome->>'configHash') f ON true
LEFT JOIN LATERAL (SELECT count(*) passes FROM public.paper_evaluations e WHERE e.candidate_key=t.trial_key
 AND e.code_hash=h.outcome->>'codeHash' AND e.config_hash=h.outcome->>'configHash' AND e.evidence->>'pass'='true') w ON true;

GRANT SELECT ON public.candidate_progress TO anonymous,authenticated;
NOTIFY pgrst, 'reload schema';
