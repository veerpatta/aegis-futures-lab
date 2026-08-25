-- Yahoo can revise bars inside the engine's seven-day mirror window. When a
-- revised recompute no longer emits a previously stored trade, retain that row
-- as an audit record but exclude it from every live-performance consumer.
alter table public.signals
  add column if not exists orphaned boolean not null default false;

comment on column public.signals.orphaned is
  'True when the latest deterministic mirror recompute no longer emits this signal; retained for audit, excluded from live metrics.';

create index if not exists signals_orphaned_signal_ts_idx
  on public.signals (signal_ts desc)
  where orphaned = true;
