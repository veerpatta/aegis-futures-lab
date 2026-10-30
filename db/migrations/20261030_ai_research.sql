-- Separate, private OpenAI research evidence. No existing learner, source,
-- promotion or paper-account table is modified. Apply with a migration role.
-- The browser has NO direct access: a verified server route enforces identity.

CREATE TABLE IF NOT EXISTS public.ai_budget_reservations (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
  actual_micros bigint CHECK (actual_micros IS NULL OR actual_micros >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled')),
  CHECK ((status = 'reserved' AND actual_micros IS NULL) OR (status = 'settled' AND actual_micros IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai_budget_reservations_created ON public.ai_budget_reservations(created_at);
CREATE INDEX IF NOT EXISTS ai_budget_reservations_user_created ON public.ai_budget_reservations(user_id, created_at);

CREATE TABLE IF NOT EXISTS public.ai_research_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  question text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS ai_research_requests_owner_created ON public.ai_research_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_research_results (
  request_id text PRIMARY KEY,
  user_id text NOT NULL,
  response jsonb NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('complete', 'invalid', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (request_id, user_id) REFERENCES public.ai_research_requests(id, user_id)
);

-- A new study is registered before observations. No pointer in the existing
-- account can adopt it; selection is explicit in the isolated collector.
CREATE TABLE IF NOT EXISTS public.ai_shadow_studies (
  id text PRIMARY KEY,
  model text NOT NULL,
  prompt_version text NOT NULL,
  feature_version text NOT NULL,
  config jsonb NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now()
);

-- A snapshot records actual receipt, not the time of a retrospective replay.
-- payload must contain only setup features: no source exit, outcome or P&L.
CREATE TABLE IF NOT EXISTS public.ai_shadow_snapshots (
  study_id text NOT NULL REFERENCES public.ai_shadow_studies(id),
  opportunity_key text NOT NULL,
  source_signal_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  symbol text NOT NULL CHECK (symbol IN ('MES', 'MNQ')),
  side text NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  source_paused boolean NOT NULL,
  source_fresh boolean NOT NULL,
  data_as_of timestamptz,
  eligibility text NOT NULL CHECK (eligibility IN ('eligible', 'rejected')),
  rejection_reason text,
  payload jsonb NOT NULL,
  source_code_sha text,
  PRIMARY KEY (study_id, opportunity_key),
  CHECK ((eligibility = 'rejected' AND rejection_reason IS NOT NULL AND length(rejection_reason) > 0)
      OR (eligibility = 'eligible' AND rejection_reason IS NULL)),
  CHECK (NOT (payload ?| ARRAY['exit_ts', 'exit_price', 'pnl_usd', 'outcome', 'net', 'exitTs', 'exitPrice', 'pnlUsd']))
);
CREATE INDEX IF NOT EXISTS ai_shadow_snapshots_observed ON public.ai_shadow_snapshots(study_id, observed_at);

-- Append an idempotent event for each decision, abstention, failure, revised
-- source or finalized result. Writes cannot change earlier observations.
CREATE TABLE IF NOT EXISTS public.ai_shadow_events (
  event_key text PRIMARY KEY,
  study_id text NOT NULL,
  opportunity_key text NOT NULL,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (study_id, opportunity_key) REFERENCES public.ai_shadow_snapshots(study_id, opportunity_key)
);
CREATE INDEX IF NOT EXISTS ai_shadow_events_opportunity ON public.ai_shadow_events(study_id, opportunity_key, created_at);

-- Owners and engine connections can bypass RLS. Triggers preserve the study's
-- evidence even for privileged writers. Changes are new rows, not edits.
CREATE OR REPLACE FUNCTION public.ai_research_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI research evidence is append-only: %', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS protect_ai_research_requests ON public.ai_research_requests;
CREATE TRIGGER protect_ai_research_requests BEFORE UPDATE OR DELETE ON public.ai_research_requests FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_research_results ON public.ai_research_results;
CREATE TRIGGER protect_ai_research_results BEFORE UPDATE OR DELETE ON public.ai_research_results FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_shadow_studies ON public.ai_shadow_studies;
CREATE TRIGGER protect_ai_shadow_studies BEFORE UPDATE OR DELETE ON public.ai_shadow_studies FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_shadow_snapshots ON public.ai_shadow_snapshots;
CREATE TRIGGER protect_ai_shadow_snapshots BEFORE UPDATE OR DELETE ON public.ai_shadow_snapshots FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_shadow_events ON public.ai_shadow_events;
CREATE TRIGGER protect_ai_shadow_events BEFORE UPDATE OR DELETE ON public.ai_shadow_events FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();

-- A reservation is durable through ambiguous provider timeouts. A successful
-- response may settle it once; actual usage can exceed the reservation so an
-- overrun cannot disappear from future budget calculations.
CREATE OR REPLACE FUNCTION public.ai_guard_budget_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AI reservations cannot be deleted'; END IF;
  IF OLD.status = 'settled' THEN RAISE EXCEPTION 'AI reservations can be settled only once'; END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.model IS DISTINCT FROM NEW.model OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.reserved_micros IS DISTINCT FROM NEW.reserved_micros THEN
    RAISE EXCEPTION 'AI reservation identity and amount are immutable';
  END IF;
  IF NEW.status <> 'settled' OR NEW.actual_micros IS NULL THEN
    RAISE EXCEPTION 'AI reservation may only transition to settled with actual usage';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_ai_budget_reservations ON public.ai_budget_reservations;
CREATE TRIGGER protect_ai_budget_reservations BEFORE UPDATE OR DELETE ON public.ai_budget_reservations FOR EACH ROW EXECUTE FUNCTION public.ai_guard_budget_reservation();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_budget_reservations','ai_research_requests','ai_research_results',
    'ai_shadow_studies','ai_shadow_snapshots','ai_shadow_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anonymous, authenticated', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
