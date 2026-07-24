-- Finding 10: challenger_history uniqueness must be (week_key, stream), not
-- (week_key, stream, verdict). With verdict in the key, a same-week rerun that
-- changed its mind (e.g. "challenger" → "insufficient-oos") ADDED a second row,
-- and the 2-week confirmation could then trust a verdict the rerun retracted.
-- One row per (week_key, stream): a rerun replaces the week's verdict in place.
--
-- Keep the newest row per (week_key, stream) before swapping the constraint.

delete from public.challenger_history a
  using public.challenger_history b
  where a.id < b.id and a.week_key = b.week_key and a.stream = b.stream;

alter table public.challenger_history
  drop constraint if exists challenger_history_week_key_stream_verdict_key;

alter table public.challenger_history
  add constraint challenger_history_week_stream_key unique (week_key, stream);
