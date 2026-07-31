-- Phase 1 truth layer — the diagnostics that decide whether anything
-- downstream is worth building. Applied 2026-07-31.
--
-- Three tables, all RLS-on / public-SELECT / service-role-write, matching
-- signals and shadow_signals. Paper only; none of this touches real money.
--
-- TWO OF THEM ARE ENFORCED BY TRIGGERS, NOT BY RLS, AND THE DISTINCTION IS
-- LOAD-BEARING: the engine writes with the service-role key, which BYPASSES
-- row level security. A policy saying "nobody may update this row" is
-- therefore no protection at all against the one writer that exists. Triggers
-- still fire for service_role, so immutability lives there.
--
-- Note on schema drift: signals.dedupe_key / .qty / .score are read and
-- written by committed code but have no committed migration, so the files in
-- this folder are not a complete picture of the live database. Nothing below
-- adds a NOT NULL column without a default to an existing table, and the only
-- foreign key is to signals(id), which IS in the committed core schema.

-- ── 1. research_baselines — the immutable control ────────────────────────
-- The losing baseline is the control for every future comparison, and the
-- brief's rule is that it may never be deleted, overwritten or hidden.
-- Correcting a baseline means INSERTING a new config_hash and leaving the old
-- row visible — the same discipline TUNING_BASELINE already follows in code
-- by keeping refuted bands beside the evidence against them.
create table if not exists public.research_baselines (
  id bigint generated always as identity primary key,
  measured_at timestamptz not null default now(),
  baseline_key text not null,          -- 'A', 'B:MES', 'B:MNQ'
  config_hash text not null,           -- stableHash() of strategy+params+execution+window
  code_sha text,
  bar_source text not null,            -- 'yahoo' | 'databento' — never assume
  symbol text not null,
  window_from timestamptz,
  window_to timestamptz,
  sessions integer,
  -- Both books, always. Reporting one without the other is forbidden.
  gross jsonb not null default '{}'::jsonb,
  net jsonb not null default '{}'::jsonb,
  excursion jsonb not null default '{}'::jsonb,
  random_entry jsonb not null default '{}'::jsonb,
  provenance text not null,
  unique (baseline_key, config_hash)
);

alter table public.research_baselines enable row level security;

drop policy if exists "public read research_baselines" on public.research_baselines;
create policy "public read research_baselines" on public.research_baselines
  for select to public
  using (true);

revoke insert, update, delete on public.research_baselines from anon, authenticated;

create or replace function public.research_baselines_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception
    'research_baselines is append-only: the losing baseline is the control for '
    'every later comparison. Insert a new config_hash instead of editing %.',
    old.baseline_key;
end;
$$;

drop trigger if exists research_baselines_no_edit on public.research_baselines;
create trigger research_baselines_no_edit
  before update or delete on public.research_baselines
  for each row execute function public.research_baselines_immutable();

create index if not exists research_baselines_key_idx
  on public.research_baselines (baseline_key, measured_at desc);

-- ── 2. signal_excursion — MAE/MFE for LIVE signals ───────────────────────
-- Backtest excursion is deliberately NOT stored: it is recomputable from the
-- bars_5m archive at any time, and storing 1,180 + 2,641 + 2,731 rows per
-- re-run would grow without bound on a 500 MB free tier. Live signals are
-- different — the bar path around a live signal is only archived for as long
-- as the feed keeps it, so these genuinely cannot be reconstructed later.
create table if not exists public.signal_excursion (
  id bigint generated always as identity primary key,
  signal_id bigint not null references public.signals(id) on delete cascade,
  computed_at timestamptz not null default now(),
  bar_source text not null,
  mae_points numeric,
  mfe_points numeric,
  atr_at_entry numeric,
  mae_atr numeric,
  mfe_atr numeric,
  mae_r numeric,
  mfe_r numeric,
  minutes_to_mae numeric,
  minutes_to_mfe numeric,
  bars_held integer,
  unique (signal_id)
);

alter table public.signal_excursion enable row level security;

drop policy if exists "public read signal_excursion" on public.signal_excursion;
create policy "public read signal_excursion" on public.signal_excursion
  for select to public
  using (true);

revoke insert, update, delete on public.signal_excursion from anon, authenticated;

create index if not exists signal_excursion_signal_idx
  on public.signal_excursion (signal_id);

-- ── 3. research_trials — the trial registry ──────────────────────────────
-- Built now because it is RETROACTIVELY UNFIXABLE. Deflated Sharpe needs an
-- honest trial count; a trial that was run and not logged silently inflates
-- every significance claim made afterwards, and there is no way to recover it
-- later. Every parameter combination ever evaluated gets a row.
--
-- The three write-once columns are what make this worth having. Anyone can
-- keep a list of things they ran; the question that matters is what they
-- predicted BEFORE they looked, and a prediction that can be edited after the
-- result is not a prediction.
create table if not exists public.research_trials (
  id bigint generated always as identity primary key,
  registered_at timestamptz not null default now(),
  trial_key text not null,
  hypothesis text not null,            -- write-once
  prediction text not null,            -- write-once
  decision_rule text not null,         -- write-once: what result means what
  config_hash text not null,           -- write-once
  params jsonb not null default '{}'::jsonb,
  dataset jsonb not null default '{}'::jsonb,
  code_sha text,
  status text not null default 'registered'
    check (status in ('registered', 'running', 'complete', 'abandoned')),
  outcome jsonb,
  decided_at timestamptz,
  -- Running the same configuration twice becomes VISIBLE rather than silent.
  -- "We ran it, disliked the answer, and ran it again" is the single most
  -- common way a trial count gets understated.
  unique (config_hash)
);

alter table public.research_trials enable row level security;

drop policy if exists "public read research_trials" on public.research_trials;
create policy "public read research_trials" on public.research_trials
  for select to public
  using (true);

revoke insert, update, delete on public.research_trials from anon, authenticated;

create or replace function public.research_trials_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hypothesis is distinct from old.hypothesis
     or new.prediction is distinct from old.prediction
     or new.decision_rule is distinct from old.decision_rule
     or new.config_hash is distinct from old.config_hash then
    raise exception
      'research_trials: hypothesis, prediction, decision_rule and config_hash '
      'are write-once. A prediction that can be edited after the result is not '
      'a prediction. Register a new trial instead.';
  end if;

  if old.outcome is not null and new.outcome is distinct from old.outcome then
    raise exception
      'research_trials: outcome is write-once (trial %). Re-running a trial is '
      'a new trial and must be counted as one.', old.trial_key;
  end if;

  return new;
end;
$$;

drop trigger if exists research_trials_write_once on public.research_trials;
create trigger research_trials_write_once
  before update on public.research_trials
  for each row execute function public.research_trials_guard();

create index if not exists research_trials_key_idx
  on public.research_trials (trial_key, registered_at desc);
create index if not exists research_trials_status_idx
  on public.research_trials (status);
