-- Shadow-mode strategy auditions (Month 2).
--
-- The four coded-but-unused strategies (vwap-reversion, orb,
-- bollinger-breakout, ema-cross) run alongside the live tiers and log their
-- simulated results HERE — never into signals, never onto the blotter,
-- never to Telegram. Same shape as signals plus a `strategy` column; same
-- honesty columns (fill_confidence, regime). Public SELECT only — writes
-- come from the engine's service key.

create table if not exists public.shadow_signals (
  id bigint generated always as identity primary key,
  strategy text not null,
  dedupe_key text not null unique,
  symbol text not null,
  timeframe text not null default '5m',
  direction text check (direction in ('long', 'short')),
  entry_price numeric not null,
  stop_price numeric not null,
  target_price numeric,
  rr numeric,
  qty integer,
  score numeric,
  status text not null default 'pending'
    check (status in ('pending', 'triggered', 'hit_target', 'hit_stop', 'expired', 'cancelled')),
  reason text,
  signal_ts timestamptz not null,
  exit_ts timestamptz,
  exit_price numeric,
  pnl_usd numeric,
  risk_usd numeric,
  regime text,
  fill_confidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shadow_signals enable row level security;

drop policy if exists "public read shadow_signals" on public.shadow_signals;
create policy "public read shadow_signals" on public.shadow_signals
  for select to public
  using (true);

create index if not exists shadow_signals_ts_idx on public.shadow_signals (signal_ts desc);
create index if not exists shadow_signals_stream_idx on public.shadow_signals (strategy, symbol);
