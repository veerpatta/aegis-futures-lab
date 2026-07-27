alter table public.signals
  add column if not exists stale_data boolean not null default false;

alter table public.shadow_signals
  add column if not exists stale_data boolean not null default false;

create index if not exists signals_stale_data_idx
  on public.signals (signal_ts desc)
  where stale_data;

create index if not exists shadow_signals_stale_data_idx
  on public.shadow_signals (signal_ts desc)
  where stale_data;
