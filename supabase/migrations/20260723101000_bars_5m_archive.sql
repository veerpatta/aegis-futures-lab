-- 5-minute bar archive (2026-07-23).
--
-- Yahoo caps 5m history at a sliding 60-day window, so anything older was
-- lost forever and every backtest/tune was capped at 60d. The engine now
-- upserts each successful fetch here (service-role key; no public write
-- policy, so RLS blocks anonymous writes), the archive doubles as the
-- fallback feed when Yahoo is down, and the Lab can read history older
-- than 60d via /api/archive. Grows ~a few hundred rows per trading day.

create table if not exists public.bars_5m (
  symbol text not null,
  time bigint not null, -- unix seconds, bar open (same clock as the feed)
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume bigint not null default 0,
  primary key (symbol, time)
);

alter table public.bars_5m enable row level security;

drop policy if exists "public read bars_5m" on public.bars_5m;
create policy "public read bars_5m" on public.bars_5m
  for select to public
  using (true);

create index if not exists bars_5m_symbol_time_desc_idx
  on public.bars_5m (symbol, time desc);
