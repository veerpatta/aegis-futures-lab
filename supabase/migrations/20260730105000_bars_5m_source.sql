-- Two feeds in one archive: bars_5m gains a `source` column.
--
-- WHY THIS EXISTS, AND WHY IT IS NOT OPTIONAL.
--
-- bars_5m currently holds ~29,300 rows per symbol of delayed Yahoo MES=F/MNQ=F
-- 5-minute bars, 2026-05-12 onward, keyed (symbol, time). The Databento
-- backfill is about to add the real CME contracts (GLBX.MDP3, MES.c.0/MNQ.c.0)
-- over the SAME date range, so it would land on the SAME (symbol, time) keys.
--
-- Upserting it there would overwrite the Yahoo history in place, and every
-- measurement pinned to that archive would silently stop reproducing:
--
--   * TUNING_BASELINE.provenance for all three streams (scripts/engine/tiers.ts)
--   * the re-measured tier-A baseline — 51 sessions, 16 trades, PF 1.27,
--     net +$357 — which tiers.ts tells the reader to reproduce with
--     `npx tsx scripts/diag/tier-a-baseline.ts`
--   * MNQ_MES_DOLLAR_ATR_RATIO = 2.68 (scripts/diag/atr-ratio.ts)
--   * the day-alignment evidence in lib/data/window.ts (invalidFill 4 vs 61,
--     nesting 3,654 vs 6,577), which is what justifies ARCHIVE_DAY_ALIGN
--
-- None of those would error. They would just print different numbers than the
-- comments claiming to have measured them, which is this repo's documented
-- recurring failure shape: a green run where nothing announced that the ground
-- moved. Keeping both feeds side by side is what makes the Databento pull an
-- ADDITION to the evidence rather than a silent replacement of it.
--
-- WHAT THIS CHANGES BEHAVIOURALLY: nothing, today. Existing rows are stamped
-- 'yahoo', the public read policy is untouched, and the engine keeps reading
-- and writing the same rows it always did.
--
-- Paper only, delayed data — nothing here touches real money.

-- 1) The column. `default 'yahoo'` backfills all existing rows in place.
--
--    The default is DELIBERATELY KEPT rather than dropped after backfill. A
--    dropped default would make an insert that forgets `source` fail loudly,
--    which sounds better — but the TypeScript readers take source as a
--    REQUIRED parameter, so a forgotten source is already a compile error,
--    which is earlier and cheaper than a runtime constraint violation. What
--    the default actually buys is a safe deploy window: applying this
--    migration before the code that knows about it ships cannot break the
--    15-minute engine cron.
alter table public.bars_5m
  add column if not exists source text not null default 'yahoo';

-- 2) Constrain the namespace. Without this a typo ('databeno') would quietly
--    create a third feed that every reader then misses, which is precisely the
--    silent-partition bug this migration exists to prevent. Adding a feed
--    means editing this constraint on purpose.
alter table public.bars_5m
  drop constraint if exists bars_5m_source_check;
alter table public.bars_5m
  add constraint bars_5m_source_check check (source in ('yahoo', 'databento'));

-- 3) The primary key moves to (symbol, source, time) so the two feeds can hold
--    the same bar timestamp without colliding. Verified against the live
--    database: the existing constraint is named bars_5m_pkey on
--    (symbol, "time"), and nothing has a foreign key onto this table, so the
--    drop cannot cascade.
alter table public.bars_5m drop constraint if exists bars_5m_pkey;
alter table public.bars_5m
  add constraint bars_5m_pkey primary key (symbol, source, "time");

-- 4) Indexes. BOTH are wanted, for two different query shapes:
--      (symbol, source, time desc) — "give me one feed's trailing window",
--                                    which is every engine and diag read.
--      (symbol, time desc)         — the pre-existing index, kept because the
--                                    proxy-error comparison joins the two
--                                    feeds ON (symbol, time) and cannot use a
--                                    source-leading index for that.
--    At ~30k rows growing a few hundred per trading day the second index costs
--    almost nothing; guessing wrong about it costs a sequential scan.
create index if not exists bars_5m_symbol_source_time_desc_idx
  on public.bars_5m (symbol, source, "time" desc);

-- RLS is unchanged: "public read bars_5m" (select to public using true) still
-- applies, and there is still no public write policy — engine writes continue
-- to need the service-role key.
