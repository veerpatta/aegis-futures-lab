-- ============================================================
-- Trading Bot Aegis — paper-trading signal engine schema
-- ============================================================

create table if not exists public.zones (
    id bigint generated always as identity primary key,
    symbol text not null,
    timeframe text not null,
    zone_type text not null check (zone_type in ('demand','supply')),
    price_high numeric not null,
    price_low numeric not null,
    status text not null default 'fresh' check (status in ('fresh','tested','broken')),
    source_candle_ts timestamptz,
    touches int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (symbol, timeframe, zone_type, price_high, price_low)
);
create index if not exists zones_symbol_tf_idx on public.zones (symbol, timeframe, status);

create table if not exists public.signals (
    id bigint generated always as identity primary key,
    symbol text not null,
    timeframe text not null default '15m',
    direction text not null check (direction in ('long','short')),
    entry_price numeric not null,
    stop_price numeric not null,
    target_price numeric not null,
    rr numeric,
    zone_id bigint references public.zones(id) on delete set null,
    status text not null default 'pending'
      check (status in ('pending','triggered','hit_target','hit_stop','expired','cancelled')),
    reason text,
    signal_ts timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (symbol, direction, zone_id, signal_ts)
);
create index if not exists signals_symbol_status_idx
  on public.signals (symbol, status, created_at desc);

create table if not exists public.trades (
    id bigint generated always as identity primary key,
    symbol text not null,
    direction text check (direction in ('long','short')),
    qty numeric,
    entry_ts timestamptz,
    entry_price numeric,
    exit_ts timestamptz,
    exit_price numeric,
    pnl numeric,
    fees numeric,
    source text default 'manual',
    signal_id bigint references public.signals(id) on delete set null,
    notes text,
    raw jsonb,
    created_at timestamptz not null default now()
);
create index if not exists trades_symbol_entry_idx on public.trades (symbol, entry_ts desc);

create table if not exists public.engine_runs (
    id bigint generated always as identity primary key,
    ran_at timestamptz not null default now(),
    status text not null default 'ok' check (status in ('ok','error','skipped')),
    symbols text[],
    zones_upserted int default 0,
    signals_created int default 0,
    duration_ms int,
    message text
);
create index if not exists engine_runs_ran_at_idx on public.engine_runs (ran_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger zones_touch before update on public.zones
  for each row execute function public.touch_updated_at();
create trigger signals_touch before update on public.signals
  for each row execute function public.touch_updated_at();
