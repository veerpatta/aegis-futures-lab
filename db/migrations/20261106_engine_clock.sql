-- Engine clock (lib/clock/handler.ts, functions/aegisclock, docs/ENGINE-CLOCK.md).
--
-- GitHub stopped firing this repository's schedules on time on 2026-11-02, so
-- a Neon Function on Neon's scheduler now asks GitHub to start the engine.
-- GitHub needs a key for that. The key lives in a PRIVATE schema that only the
-- database owner (the role Neon injects into its functions) can read: the
-- Data API never exposes it and the browser roles and aegis_ai get nothing.
-- The dispatch log holds no secrets and is public health data, like engine_runs.
--
-- Additive and idempotent. No function bodies, so each statement survives the
-- Neon MCP statement splitter.

CREATE SCHEMA IF NOT EXISTS aegis_private;
REVOKE ALL ON SCHEMA aegis_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS aegis_private.engine_clock_token (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text NOT NULL CHECK (token ~ '^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON aegis_private.engine_clock_token FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.engine_clock (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fired_at timestamptz NOT NULL DEFAULT now(),
  invocation_id text,
  trigger_name text NOT NULL,
  route text NOT NULL CHECK (route IN ('engine','learn','review')),
  scheduled_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('dispatched','not-configured','rejected','failed','stale-trigger')),
  http_status integer,
  message text CHECK (message IS NULL OR length(message) <= 300)
);
CREATE INDEX IF NOT EXISTS engine_clock_recent ON public.engine_clock(fired_at DESC);
ALTER TABLE public.engine_clock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS engine_clock_public_read ON public.engine_clock;
CREATE POLICY engine_clock_public_read ON public.engine_clock FOR SELECT TO anonymous, authenticated USING (true);
REVOKE ALL ON public.engine_clock FROM PUBLIC, anonymous, authenticated;
GRANT SELECT ON public.engine_clock TO anonymous, authenticated;
