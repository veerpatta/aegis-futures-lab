-- ============================================================
-- Catch-up: schema that was applied to the live project but never committed
-- ============================================================
--
-- CLAUDE.md already warned that this folder is not a complete picture of the
-- live schema, naming `signals.dedupe_key`, `.qty` and `.score`. A column-level
-- diff of the live database against every committed migration puts the real
-- figure at 18 columns and 3 indexes across three tables.
--
-- Nothing here changes the live database. Every statement is `if not exists`
-- (or drop-then-add, for the check constraint Postgres gives no `if not exists`
-- form). This file exists so that a rebuild from `supabase/migrations/` alone
-- produces a database the engine can actually write to.
--
-- WHY THE INDEXES MATTER MORE THAN THE COLUMNS. `signals_dedupe_key_uq` and
-- `zones_dedupe_key_uq` are the arbiters for the engine's upserts — run-live.ts
-- upserts `on conflict (dedupe_key)`. Without them a rebuilt database does not
-- merely lose deduplication, it rejects the write: Postgres raises 42P10 "there
-- is no unique or exclusion constraint matching the ON CONFLICT specification".
-- A rebuild missing the columns fails loudly on first write; a rebuild missing
-- these fails on EVERY write.
--
-- Values below were read back from the live project (`bizgcoljagsnytrnaicr`) on
-- 2026-08-07, not inferred from the code that writes them, so the defaults and
-- nullability match what production actually has.

-- ── public.signals ──────────────────────────────────────────
-- Ordered as they sit in the live table, after `updated_at`.

alter table public.signals
  add column if not exists tier       text not null default 'A',
  add column if not exists score      numeric,
  add column if not exists qty        integer,
  add column if not exists risk_usd   numeric,
  add column if not exists target_usd numeric,
  add column if not exists exit_ts    timestamptz,
  add column if not exists exit_price numeric,
  add column if not exists pnl_usd    numeric,
  add column if not exists dedupe_key text;

-- Tier is the stream label the whole dashboard slices on; anything outside
-- A/B would silently fall out of every tier-filtered query rather than error.
alter table public.signals drop constraint if exists signals_tier_check;
alter table public.signals add constraint signals_tier_check
  check (tier in ('A','B'));

-- Upsert arbiter — see the 42P10 note above.
create unique index if not exists signals_dedupe_key_uq
  on public.signals (dedupe_key);

-- The dashboard's default ordering. Present live, never committed.
create index if not exists signals_signal_ts_idx
  on public.signals (signal_ts desc);

-- ── public.zones ────────────────────────────────────────────
-- The zone-quality flags zone-v5 sets: `fresh`/`achieved`/`blocked80` are
-- deliberately nullable — null means "not yet assessed", which is a different
-- state from false and is read as such. `active` defaults true so a zone is
-- live the moment it is seated.

alter table public.zones
  add column if not exists fresh      boolean,
  add column if not exists achieved   boolean,
  add column if not exists blocked80  boolean,
  add column if not exists score      numeric,
  add column if not exists active     boolean default true,
  add column if not exists dedupe_key text;

create unique index if not exists zones_dedupe_key_uq
  on public.zones (dedupe_key);

-- ── public.engine_runs ──────────────────────────────────────
-- The per-tier signal counts the heartbeat writes, and the provenance column
-- that distinguishes a scheduled GitHub run from a local one.

alter table public.engine_runs
  add column if not exists tier_a_signals integer default 0,
  add column if not exists tier_b_signals integer default 0,
  add column if not exists source         text default 'github-actions';
