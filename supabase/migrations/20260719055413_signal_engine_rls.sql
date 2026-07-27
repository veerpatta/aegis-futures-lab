alter table public.zones enable row level security;
alter table public.signals enable row level security;
alter table public.trades enable row level security;
alter table public.engine_runs enable row level security;

create policy "public read zones" on public.zones for select using (true);
create policy "public read signals" on public.signals for select using (true);
create policy "public read trades" on public.trades for select using (true);
create policy "public read engine_runs" on public.engine_runs for select using (true);

create policy "public insert trades" on public.trades for insert with check (true);
create policy "public update trades" on public.trades
  for update using (true) with check (true);
create policy "public delete trades" on public.trades for delete using (true);
