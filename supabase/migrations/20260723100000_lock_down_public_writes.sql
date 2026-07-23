-- Lock down public writes (2026-07-23).
--
-- The publishable key ships in the client by design, so RLS policies are the
-- only write gate. Until now every table allowed anonymous INSERT/UPDATE/
-- DELETE — anyone with the repo URL could wipe or poison the signal log.
-- After this migration only the service-role key (GitHub Actions secret) can
-- write engine data. Public SELECT stays: the dashboard reads anonymously.
--
-- The one intentional exception: the journal UI inserts/deletes rows in
-- `trades` from the browser (lib/journal/cloud.ts, always source='journal').
-- Those two policies are kept but scoped to source='journal' rows, so the
-- journal keeps working while engine-owned rows stay untouchable.

-- engine_runs: engine-only writes.
drop policy if exists "public write engine_runs" on public.engine_runs;

-- signals: engine-only writes.
drop policy if exists "public write signals" on public.signals;
drop policy if exists "public update signals" on public.signals;

-- zones: engine-only writes.
drop policy if exists "public write zones" on public.zones;
drop policy if exists "public update zones" on public.zones;
drop policy if exists "public delete zones" on public.zones;

-- trades: replace blanket write access with journal-scoped insert/delete.
-- (The journal never updates rows — it inserts and deletes to mirror
-- localStorage — so UPDATE is dropped outright.)
drop policy if exists "public insert trades" on public.trades;
drop policy if exists "public update trades" on public.trades;
drop policy if exists "public delete trades" on public.trades;

create policy "journal insert trades" on public.trades
  for insert to public
  with check (source = 'journal');

create policy "journal delete trades" on public.trades
  for delete to public
  using (source = 'journal');
