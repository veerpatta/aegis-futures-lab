-- 2026-10-05: the trial account — practice money that copies every trade idea.
--
-- The practice account (paper_*) only trades a method that has passed every
-- test, and none has, so it has never placed a trade. The trial account copies
-- every idea the Ideas tab shows, at the idea's own size, under the practice
-- account's protective limits ($400 daily loss, $2,000 drawdown stop). It is
-- labelled "not proven" everywhere it appears. Logic: lib/trial/engine.ts;
-- writer: scripts/engine/trial-broker.ts; new round: scripts/engine/trial-reset.ts.
--
-- History is never rewritten: a closed position, a decision and an ended round
-- are write-once, guarded by TRIGGERS for the same reason as the research
-- tables — the engine writes over a privileged connection that bypasses RLS.
-- Rounds restart only through the owner's trial-reset workflow, and every
-- earlier round stays visible.

CREATE TABLE IF NOT EXISTS public.trial_account (
  id integer PRIMARY KEY CHECK (id = 1),
  round integer NOT NULL DEFAULT 1 CHECK (round >= 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  risk_version text NOT NULL,
  equity numeric NOT NULL DEFAULT 10000,
  peak numeric NOT NULL DEFAULT 10000,
  day_key text NOT NULL DEFAULT '',
  day_start_equity numeric NOT NULL DEFAULT 10000,
  daily_pnl numeric NOT NULL DEFAULT 0,
  open_risk numeric NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  last_event_ts timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.trial_account(id, risk_version) VALUES (1, 'trial-risk-2026-10-05') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.trial_rounds (
  round integer PRIMARY KEY CHECK (round >= 1),
  started_at timestamptz NOT NULL,
  start_equity numeric NOT NULL,
  ended_at timestamptz,
  end_equity numeric,
  end_reason text
);
INSERT INTO public.trial_rounds(round, started_at, start_equity)
  SELECT round, started_at, 10000 FROM public.trial_account WHERE id = 1 ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.trial_positions (
  id text PRIMARY KEY,
  round integer NOT NULL REFERENCES public.trial_rounds(round),
  signal_key text NOT NULL,
  signal_id bigint,
  symbol text NOT NULL CHECK (symbol IN ('MES','MNQ')),
  side text NOT NULL CHECK (side IN ('LONG','SHORT')),
  qty integer NOT NULL CHECK (qty > 0),
  entry numeric NOT NULL,
  stop numeric NOT NULL,
  target numeric,
  risk numeric NOT NULL CHECK (risk > 0),
  mark numeric NOT NULL,
  opened_at timestamptz NOT NULL,
  last_mark_ts timestamptz,
  closed_at timestamptz,
  exit_price numeric,
  pnl numeric,
  exit_reason text CHECK (exit_reason IN ('idea','stop','target','session','daily-loss','drawdown','round-end')),
  UNIQUE (round, signal_key)
);
CREATE INDEX IF NOT EXISTS trial_positions_open ON public.trial_positions(round) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.trial_decisions (
  round integer NOT NULL REFERENCES public.trial_rounds(round),
  signal_key text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  taken boolean NOT NULL,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reason text NOT NULL CHECK (reason IN ('taken','daily-loss','open-risk','risk-budget','locked','no-risk')),
  PRIMARY KEY (round, signal_key)
);
CREATE INDEX IF NOT EXISTS trial_decisions_recent ON public.trial_decisions(decided_at DESC);

CREATE OR REPLACE FUNCTION public.guard_trial_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Trial positions cannot be deleted'; END IF;
  IF OLD.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Closed trial positions are write-once'; END IF;
  IF NEW.id <> OLD.id OR NEW.round <> OLD.round OR NEW.signal_key <> OLD.signal_key OR NEW.symbol <> OLD.symbol
    OR NEW.side <> OLD.side OR NEW.qty <> OLD.qty OR NEW.entry <> OLD.entry OR NEW.stop <> OLD.stop
    OR NEW.target IS DISTINCT FROM OLD.target OR NEW.risk <> OLD.risk OR NEW.opened_at <> OLD.opened_at
  THEN RAISE EXCEPTION 'A trial position''s entry is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_trial_positions ON public.trial_positions;
CREATE TRIGGER protect_trial_positions BEFORE UPDATE OR DELETE ON public.trial_positions FOR EACH ROW EXECUTE FUNCTION public.guard_trial_position();

CREATE OR REPLACE FUNCTION public.guard_trial_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Trial decisions are append-only'; END $$;
DROP TRIGGER IF EXISTS protect_trial_decisions ON public.trial_decisions;
CREATE TRIGGER protect_trial_decisions BEFORE UPDATE OR DELETE ON public.trial_decisions FOR EACH ROW EXECUTE FUNCTION public.guard_trial_decision();

CREATE OR REPLACE FUNCTION public.guard_trial_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Trial rounds cannot be deleted'; END IF;
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended trial round is write-once'; END IF;
  IF NEW.round <> OLD.round OR NEW.started_at <> OLD.started_at OR NEW.start_equity <> OLD.start_equity
  THEN RAISE EXCEPTION 'A trial round''s start is write-once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_trial_rounds ON public.trial_rounds;
CREATE TRIGGER protect_trial_rounds BEFORE UPDATE OR DELETE ON public.trial_rounds FOR EACH ROW EXECUTE FUNCTION public.guard_trial_round();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['trial_account','trial_rounds','trial_positions','trial_decisions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anonymous, authenticated', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_read') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anonymous, authenticated USING (true)', t || '_read', t);
    END IF;
  END LOOP;
END $$;

-- One read for every screen: the account, its rounds, the current round's
-- recent positions, the last 30 days of decisions (the Ideas tab's trial line)
-- and closed P&L per New York day (the balance chart).
CREATE OR REPLACE VIEW public.trial_overview WITH (security_invoker = true) AS
SELECT
  (SELECT to_jsonb(a) FROM public.trial_account a WHERE id = 1) AS account,
  coalesce((SELECT jsonb_agg(r ORDER BY r.round DESC) FROM public.trial_rounds r), '[]'::jsonb) AS rounds,
  coalesce((SELECT jsonb_agg(p ORDER BY p.opened_at DESC) FROM (
    SELECT * FROM public.trial_positions WHERE round = (SELECT round FROM public.trial_account WHERE id = 1)
    ORDER BY (closed_at IS NULL) DESC, opened_at DESC LIMIT 60) p), '[]'::jsonb) AS positions,
  coalesce((SELECT jsonb_agg(d ORDER BY d.decided_at DESC) FROM (
    SELECT d.round, d.signal_key, d.taken, d.qty, d.reason, d.decided_at, p.pnl, p.closed_at
    FROM public.trial_decisions d LEFT JOIN public.trial_positions p ON p.round = d.round AND p.signal_key = d.signal_key
    WHERE d.decided_at >= now() - interval '30 days' ORDER BY d.decided_at DESC LIMIT 400) d), '[]'::jsonb) AS decisions,
  coalesce((SELECT jsonb_agg(x ORDER BY x.round, x.day) FROM (
    SELECT round, to_char((closed_at AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS day, sum(pnl) AS pnl, count(*)::integer AS n,
      count(*) FILTER (WHERE pnl > 0)::integer AS wins
    FROM public.trial_positions WHERE closed_at IS NOT NULL GROUP BY round, 2) x), '[]'::jsonb) AS daily;
GRANT SELECT ON public.trial_overview TO anonymous, authenticated;
NOTIFY pgrst, 'reload schema';
