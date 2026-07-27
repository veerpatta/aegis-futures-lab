-- Private journal sync and append-only learning audit.
--
-- The public dashboard remains anonymously readable. Personal journal rows
-- require a Supabase Auth session and are isolated by auth.uid(). Engine and
-- learning writes continue to use the service-role key in GitHub Actions.

-- Remove the old anonymous browser-write exception from the shared trade log.
drop policy if exists "journal insert trades" on public.trades;
drop policy if exists "journal delete trades" on public.trades;
revoke insert, update, delete on public.trades from anon, authenticated;

create table if not exists public.journal_entries (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  journal_id text not null,
  symbol text not null check (symbol in ('MES', 'MNQ')),
  direction text not null check (direction in ('long', 'short')),
  qty integer not null check (qty > 0),
  entry_ts timestamptz not null,
  entry_price numeric not null check (entry_price > 0),
  exit_ts timestamptz not null,
  exit_price numeric not null check (exit_price > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_exit_after_entry check (exit_ts >= entry_ts),
  constraint journal_owner_entry_unique unique (owner_id, journal_id)
);

alter table public.journal_entries enable row level security;

revoke all on public.journal_entries from anon;
grant select, insert, update, delete on public.journal_entries to authenticated;
grant all on public.journal_entries to service_role;
grant usage, select on sequence public.journal_entries_id_seq to authenticated, service_role;

drop policy if exists "journal owners select" on public.journal_entries;
create policy "journal owners select" on public.journal_entries
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "journal owners insert" on public.journal_entries;
create policy "journal owners insert" on public.journal_entries
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "journal owners update" on public.journal_entries;
create policy "journal owners update" on public.journal_entries
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "journal owners delete" on public.journal_entries;
create policy "journal owners delete" on public.journal_entries
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

create index if not exists journal_entries_owner_entry_idx
  on public.journal_entries (owner_id, entry_ts desc);

-- Every automated learning run is reproducible and inspectable from /brain.
create table if not exists public.learning_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  status text not null check (status in ('running', 'ok', 'blocked', 'error')),
  code_sha text,
  data_cutoff timestamptz,
  feature_version text,
  dataset_hash text,
  artifact_hash text,
  metrics jsonb not null default '{}'::jsonb,
  gate_results jsonb not null default '{}'::jsonb,
  message text
);

alter table public.learning_runs enable row level security;
revoke insert, update, delete on public.learning_runs from anon, authenticated;
grant select on public.learning_runs to anon, authenticated;
grant all on public.learning_runs to service_role;

drop policy if exists "public read learning_runs" on public.learning_runs;
create policy "public read learning_runs" on public.learning_runs
  for select to anon, authenticated
  using (true);

create index if not exists learning_runs_started_idx
  on public.learning_runs (started_at desc);

create table if not exists public.promotion_decisions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  candidate_key text not null,
  learning_run_id bigint references public.learning_runs(id) on delete set null,
  decision text not null check (
    decision in ('observing', 'canary', 'active', 'rejected', 'rolled_back', 'paused')
  ),
  reason_codes text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  code_sha text
);

alter table public.promotion_decisions enable row level security;
revoke insert, update, delete on public.promotion_decisions from anon, authenticated;
grant select on public.promotion_decisions to anon, authenticated;
grant all on public.promotion_decisions to service_role;

drop policy if exists "public read promotion_decisions" on public.promotion_decisions;
create policy "public read promotion_decisions" on public.promotion_decisions
  for select to anon, authenticated
  using (true);

create index if not exists promotion_decisions_candidate_idx
  on public.promotion_decisions (candidate_key, created_at desc);

-- Candidate models can train daily without silently replacing the deployed
-- paper-veto model. Only the weekly learning run may move deployment.
alter table public.model_registry
  add column if not exists deployed boolean not null default false,
  add column if not exists feature_version text,
  add column if not exists code_sha text,
  add column if not exists data_cutoff timestamptz,
  add column if not exists dataset_hash text,
  add column if not exists artifact_hash text;

update public.model_registry
set deployed = true
where id = (
  select id
  from public.model_registry
  where status = 'active'
  order by trained_at desc
  limit 1
)
and not exists (select 1 from public.model_registry where deployed);

create unique index if not exists model_registry_one_deployed_idx
  on public.model_registry ((deployed))
  where deployed;

alter table public.challenger_history
  add column if not exists data_cutoff timestamptz,
  add column if not exists oos_trades integer;
