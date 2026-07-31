/* The one way to read the bar archive out of Supabase.
   ─────────────────────────────────────────────────────────────────────────
   Five files had grown their own copy of this loop — tune-core.ts, report.ts,
   tier-a.ts, tier-a-baseline.ts, archive-lib.ts — and every copy carried the
   same latent defect:

     for (let offset = 0; ; offset += 1000)
       ...order("time").range(offset, offset + 999)

   `range()` is OFFSET/LIMIT. Postgres has to walk the index from the start on
   every page, so page N costs O(N · 1000) and reading the whole archive is
   quadratic. That was invisible while bars_5m held 15,236 rows per symbol.
   After the seven-year Databento backfill it holds 508,091, and the read dies:
   EXPLAIN ANALYZE on a single page at offset 400,000 scans 401,000 index rows
   and takes 6.3 seconds, and the run hits PostgREST's statement timeout well
   before the end.

   That was not a theoretical problem. It meant
   `BAR_SOURCE=databento npx tsx scripts/diag/tier-a-baseline.ts` — the command
   tiers.ts prints as the reproduction of its own headline number — could not
   be run at all. In a repo whose rule is that every number carries a command
   that reproduces it, an unrunnable command is a broken claim.

   KEYSET paging fixes it. `(symbol, source, time)` is the primary key, so
   `time` is unique within a symbol+source and `> last` is an exact cursor:
   each page is a fresh index seek costing what the first one did.

   WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not trim the leading
   partial session. `alignArchiveSlice` stays at the call site, because whether
   a reader needs it depends on what the reader builds — tune-core.ts aligns
   the UNION of archive and live bars, not the archive read alone, and folding
   the trim in here would quietly change that. tests/archive-window.test.ts
   holds each reader individually accountable for the trim, and it should keep
   being able to. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import type { BarSource } from "./source";

/** Supabase caps a single select at 1000 rows. */
export const ARCHIVE_PAGE = 1000;

export interface ArchiveQuery {
  symbol: string;
  /** Required, never defaulted: bars_5m holds two feeds over the same
      timestamps, and an unpinned read returns both interleaved. */
  source: BarSource;
  /** Inclusive unix-second lower bound. Omit for the whole history. */
  fromSec?: number;
  /** Inclusive unix-second upper bound. Omit for everything up to now. */
  toSec?: number;
}

/** Every bar matching the query, ascending by time. Not trimmed — see the
    module note. Throws on the first read error rather than returning a short
    series, because a truncated archive is indistinguishable from a real one
    downstream. */
export async function fetchArchiveBars(
  supabase: SupabaseClient,
  { symbol, source, fromSec, toSec }: ArchiveQuery
): Promise<Bar[]> {
  const out: Bar[] = [];
  // -1 rather than 0: bars_5m stores unix seconds, and `gt(0)` would skip a
  // bar at the epoch. Nothing here trades in 1970, but a cursor that silently
  // drops its first row is the kind of thing that is only ever found later.
  let after = fromSec === undefined ? -1 : fromSec - 1;
  for (;;) {
    let q = supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .eq("source", source)
      .gt("time", after);
    if (toSec !== undefined) q = q.lte("time", toSec);
    const { data, error } = await q.order("time", { ascending: true }).limit(ARCHIVE_PAGE);
    if (error) throw new Error(`bars_5m read for ${symbol} (${source}): ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      });
    if (!data || data.length < ARCHIVE_PAGE) break;
    after = out[out.length - 1].time;
  }
  return out;
}
