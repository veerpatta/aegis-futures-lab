-- Two things a targetless stream needs before it can ever go live, plus the
-- index the excursion reader will want.
--
-- 1. signals.target_price was NOT NULL from the core schema
--    (20260719055349_signal_engine_core_schema.sql:28). run-live.ts writes
--    `target_price: t.target`, and t.target is NULL for `{kind:"signalOnly"}`
--    targets — rsi-reversion with exitStyle "midline", and anything else the
--    shadow catalogue promotes with an exit rule instead of a bracket.
--
--    The live tier config happens to avoid it, so this has never fired. But a
--    single NULL does not fail one row: run-live.ts upserts the whole batch in
--    one call, so it fails EVERY signal that pass and the run dies. The type
--    in lib/supabase/client.ts has always said `number | null`, and
--    scripts/engine/promotion.ts already carries targetlessStream() and
--    TARGETLESS_NOTE to render exactly this case — the column was the only
--    thing that disagreed.
--
--    Nothing downstream needs to change: HomeClient and SignalsClient already
--    branch on `target_price !== null` (that branch was simply unreachable),
--    and lib/signals/status.ts distinguishes closed_win from hit_target for
--    precisely these streams.
alter table public.signals alter column target_price drop not null;

-- 2. signal_excursion is written per pass and read per signal. The unique
--    constraint on signal_id already covers lookups by signal, but the
--    diagnostics path wants "every excursion for this window" ordered by when
--    it was computed.
create index if not exists signal_excursion_computed_idx
  on public.signal_excursion (computed_at desc);

-- 3. The engine reads back ids by dedupe_key to attach excursion, in batches
--    of 200 via `.in(...)`. There is a unique index on dedupe_key already
--    (signals_dedupe_key_uq, 20260807030500) so that lookup is served; this
--    is only the covering order for the status diff the alert path does on
--    the same keys.
create index if not exists signals_status_idx
  on public.signals (status);
