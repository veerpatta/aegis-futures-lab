-- Market-context daily table + VIX bucket (Month 2).
--
-- One row per NY trading day with the free context closes the engine can
-- fetch at zero cost: VIX (^VIX), dollar index (DX-Y.NYB), 10y yield
-- (^TNX). The engine upserts the trailing ~90 days on the first run of
-- each NY day (yesterday's close is final by then; today's provisional row
-- is corrected by tomorrow's upsert). Signals and shadow signals gain a
-- vix_bucket tag (low|high vs the trailing 20-day VIX median, prior-day
-- data only — no lookahead). Observation only; strategies read none of it.

create table if not exists public.context_daily (
  date_key text primary key, -- 'YYYY-MM-DD', New York date
  vix numeric,
  dxy numeric,
  tnx numeric,
  updated_at timestamptz not null default now()
);

alter table public.context_daily enable row level security;

drop policy if exists "public read context_daily" on public.context_daily;
create policy "public read context_daily" on public.context_daily
  for select to public
  using (true);

alter table public.signals add column if not exists vix_bucket text;
alter table public.shadow_signals add column if not exists vix_bucket text;
