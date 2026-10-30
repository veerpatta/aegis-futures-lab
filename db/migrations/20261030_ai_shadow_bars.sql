-- Prospective Yahoo feed evidence for the separate AI paper study. Historical
-- archive rows have no receipt time and cannot be substituted for these rows.
CREATE TABLE IF NOT EXISTS public.ai_shadow_bars (
  study_id text NOT NULL REFERENCES public.ai_shadow_studies(id),
  symbol text NOT NULL CHECK (symbol IN ('MES', 'MNQ')),
  bar_time bigint NOT NULL,
  source text NOT NULL DEFAULT 'yahoo' CHECK (source = 'yahoo'),
  open double precision NOT NULL CHECK (open > 0),
  high double precision NOT NULL CHECK (high > 0),
  low double precision NOT NULL CHECK (low > 0),
  close double precision NOT NULL CHECK (close > 0),
  source_received_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (study_id, symbol, bar_time),
  CHECK (high >= greatest(open, close, low) AND low <= least(open, close, high)),
  CHECK (to_timestamp(bar_time + 300) <= source_received_at AND source_received_at <= observed_at)
);

-- Preserve the first value while exposing subsequent corrections. A consumer
-- must invalidate any result depending on a bar with a revision.
CREATE TABLE IF NOT EXISTS public.ai_shadow_bar_revisions (
  study_id text NOT NULL,
  symbol text NOT NULL,
  bar_time bigint NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (study_id, symbol, bar_time, open, high, low, close),
  FOREIGN KEY (study_id, symbol, bar_time) REFERENCES public.ai_shadow_bars(study_id, symbol, bar_time)
);

DROP TRIGGER IF EXISTS protect_ai_shadow_bars ON public.ai_shadow_bars;
CREATE TRIGGER protect_ai_shadow_bars BEFORE UPDATE OR DELETE ON public.ai_shadow_bars FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
DROP TRIGGER IF EXISTS protect_ai_shadow_bar_revisions ON public.ai_shadow_bar_revisions;
CREATE TRIGGER protect_ai_shadow_bar_revisions BEFORE UPDATE OR DELETE ON public.ai_shadow_bar_revisions FOR EACH ROW EXECUTE FUNCTION public.ai_research_append_only();
ALTER TABLE public.ai_shadow_bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_shadow_bar_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_shadow_bars, public.ai_shadow_bar_revisions FROM PUBLIC, anonymous, authenticated;
