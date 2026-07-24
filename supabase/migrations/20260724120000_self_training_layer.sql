-- Self-training layer ("autopilot with a leash") — Phases A–D, one file.
--
-- Everything the self-training layer needs, in a single migration so it can
-- be pasted once into the Supabase SQL editor. All tables are new or add
-- empty, nullable/defaulted columns, so applying this is harmless to the
-- running app: old code neither reads nor writes any of it until the matching
-- phase deploys. Every table is RLS-on / public-SELECT only — writes come
-- from the engine's service-role key, exactly like signals/shadow_signals.
--
-- Paper only, delayed data — none of this touches real money or real orders.

-- ── Phase A — Ring 0: nightly knowledge (learned_stats) ──────────────────
-- One versioned row per (stat_key, NY date). date_key is a plain text column
-- ('YYYY-MM-DD') rather than an expression index so the unique constraint is
-- index-safe. learn.ts upserts idempotently: same NY day re-runs overwrite
-- the same row.
create table if not exists public.learned_stats (
  id bigint generated always as identity primary key,
  computed_at timestamptz not null default now(),
  stat_key text not null,
  date_key text not null, -- 'YYYY-MM-DD', New York date the stats describe
  payload jsonb not null,
  unique (stat_key, date_key)
);

alter table public.learned_stats enable row level security;

drop policy if exists "public read learned_stats" on public.learned_stats;
create policy "public read learned_stats" on public.learned_stats
  for select to public
  using (true);

create index if not exists learned_stats_key_date_idx
  on public.learned_stats (stat_key, date_key desc);

-- ── Phase B — Ring 1a: circuit breakers (bot_policy) ─────────────────────
-- Append-only audit of every automatic (or human) policy action. Current
-- state of a stream = its latest row by changed_at. No silent actions ever:
-- a breaker pause/resume, a model graduation/demotion, all land here.
create table if not exists public.bot_policy (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  actor text not null check (actor in ('breaker', 'model', 'human')),
  stream text not null,
  action text not null
    check (action in ('paused', 'resumed', 'veto_enabled', 'veto_disabled', 'observe')),
  reason text,
  metrics jsonb
);

alter table public.bot_policy enable row level security;

drop policy if exists "public read bot_policy" on public.bot_policy;
create policy "public read bot_policy" on public.bot_policy
  for select to public
  using (true);

create index if not exists bot_policy_stream_idx
  on public.bot_policy (stream, changed_at desc);

-- Paused streams keep simulating silently — their rows are written with
-- suppressed = true and treated like shadow rows at the presentation layer
-- (visible only in a "paused streams" drawer, excluded from headline stats
-- and Telegram). The strategy code and live params are untouched.
alter table public.signals add column if not exists suppressed boolean not null default false;

-- ── Phase C — Ring 1b: win-probability veto model ────────────────────────
-- Versioned registry of every nightly-trained model: coefficients, the
-- feature list they map to, training size, out-of-sample Brier vs the
-- base-rate baseline, a calibration summary, and lifecycle status.
create table if not exists public.model_registry (
  id bigint generated always as identity primary key,
  trained_at timestamptz not null default now(),
  model text not null default 'winprob-logit-v1',
  coefficients jsonb,
  features jsonb,
  train_n integer,
  oos_brier numeric,
  baseline_brier numeric,
  calibration jsonb,
  status text not null default 'observe'
    check (status in ('observe', 'active', 'demoted'))
);

alter table public.model_registry enable row level security;

drop policy if exists "public read model_registry" on public.model_registry;
create policy "public read model_registry" on public.model_registry
  for select to public
  using (true);

create index if not exists model_registry_trained_idx
  on public.model_registry (trained_at desc);

-- Each scored signal carries its predicted win probability; a signal in the
-- bottom decile of the trailing distribution (only when the model is active)
-- is flagged model_veto = true — recorded and shown, excluded from NEW IDEA
-- alerts, still resolved so the digest can grade the veto. Both columns land
-- on real signals and on shadow auditions (the model auditions there too).
alter table public.signals add column if not exists win_prob numeric;
alter table public.signals add column if not exists model_veto boolean not null default false;
alter table public.shadow_signals add column if not exists win_prob numeric;
alter table public.shadow_signals add column if not exists model_veto boolean not null default false;

-- ── Phase D — Ring 2: bot-proposed upgrades (challenger_history) ──────────
-- Every week's tune result per stream, so a challenger that survives the
-- held-out month + Monte Carlo gate for two consecutive weeks can be
-- recognised (deep-equal params, week over week) and turned into a PR. Also
-- tracks proposed sets to honour the 4-week re-propose cooldown.
create table if not exists public.challenger_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  week_key text not null, -- 'YYYY-Www', the NY week the tune ran for
  stream text not null,
  params jsonb,
  oos_pf numeric,
  oos_net numeric,
  mc_p95_dd numeric,
  verdict text not null, -- 'challenger' | 'none' | 'proposed' | 'cooldown'
  unique (week_key, stream, verdict)
);

alter table public.challenger_history enable row level security;

drop policy if exists "public read challenger_history" on public.challenger_history;
create policy "public read challenger_history" on public.challenger_history
  for select to public
  using (true);

create index if not exists challenger_history_stream_idx
  on public.challenger_history (stream, week_key desc);
