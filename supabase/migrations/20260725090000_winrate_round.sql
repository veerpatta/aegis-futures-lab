-- Win-rate round (2026-07-25) — every schema change from this round, one file.
--
-- Safe to apply before the matching code deploys: the only change is one new
-- nullable/defaulted boolean column. Old code neither reads nor writes it, and
-- new code treats false as "fine", so there is no window where the engine can
-- break on a missing column in either direction.
--
-- Paper only, delayed data — none of this touches real money or real orders.

-- ── Item 2.4 — bar-age gate (stale_data) ─────────────────────────────────
-- Yahoo's nominal delay is 10–15 minutes, but the feed stalls: the digest for
-- the week to 2026-07-24 reported a worst bar age of 104 minutes, and the
-- engine ran anyway. A signal computed on 104-minute-old bars is not a signal
-- — its fill classification is meaningless — but deleting it would hide the
-- outage, so it is recorded and FLAGGED instead.
--
-- stale_data gets exactly the treatment `suppressed` already gets: excluded
-- from headline stats, from Telegram alerts, and from the win-probability
-- model's training set, while still being visible in the paused/excluded
-- drawer with its own label. Defaults false so every existing row keeps
-- counting exactly as it does today.
alter table public.signals
  add column if not exists stale_data boolean not null default false;

alter table public.shadow_signals
  add column if not exists stale_data boolean not null default false;

-- Partial indexes: the common query is "the rows that still count", so index
-- the small flagged set rather than the large clean one.
create index if not exists signals_stale_data_idx
  on public.signals (signal_ts desc)
  where stale_data;

create index if not exists shadow_signals_stale_data_idx
  on public.shadow_signals (signal_ts desc)
  where stale_data;

-- ── Item 2.2 — allow the `closed_win` status ─────────────────────────────
-- Both tables carry a CHECK constraint enumerating the allowed statuses. The
-- 2.2 fix introduces `closed_win` (a profitable exit that never touched the
-- bracket, previously mislabelled `expired`), so the enumeration has to grow
-- before the engine can write one.
--
-- This was caught the honest way: the first engine run after deploying 2.2
-- failed with `signals_status_check`, wrote an error heartbeat, and changed
-- nothing — the upsert is atomic, so no partial batch landed. An earlier draft
-- of this file asserted "a new value in an existing free-text status column,
-- not a new constraint", which was simply wrong. Corrected here rather than
-- quietly patched, because the wrong claim is the more instructive artifact.
--
-- Widen-only: every previously valid status stays valid, so this is safe to
-- apply before or after the code deploy.
alter table public.signals drop constraint if exists signals_status_check;
alter table public.signals add constraint signals_status_check
  check (status = any (array['pending','triggered','hit_target','hit_stop','closed_win','expired','cancelled']));

alter table public.shadow_signals drop constraint if exists shadow_signals_status_check;
alter table public.shadow_signals add constraint shadow_signals_status_check
  check (status = any (array['pending','triggered','hit_target','hit_stop','closed_win','expired','cancelled']));

-- ── Items 2.1, 2.5, 2.6, 2.7, 2.8, 2.9 — no schema change ────────────────
-- Recorded here so the round's migration file is a complete answer to "what
-- did the database need for this round?":
--   2.1 zones.score and signals.score BOTH already existed; the score was
--       being computed and dropped in application code, not missing a column.
--   2.5 the silence watchdog reads engine_runs/signals and writes GitHub
--       issues + Telegram; no table of its own.
--   2.6 the nightly invariant check reads learned_stats/signals/engine_runs
--       and reports through the same watchdog path.
--   2.7 the "why no signal today?" panel reads learned_stats.gate_costs and
--       the engine's existing per-day funnel.
--   2.8 richer signal cards read learned_stats.condition_ledger and
--       signals.win_prob, both already present.
--   2.9 the graduation gate is a code constant.
