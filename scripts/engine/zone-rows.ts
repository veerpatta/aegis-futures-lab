/* Zone snapshot rows for the scheduled engine (extracted from run-live.ts so
   the dedupe rule is unit-testable without triggering a live run).

   The zones table carries TWO unique constraints: dedupe_key (what the
   engine upserts on) and the natural key (symbol, timeframe, zone_type,
   price_high, price_low) — the data-integrity backstop. Two zones can form
   at identical price levels at different times (same dedupe_key prefix,
   different formedAt), which used to abort the whole upsert against the
   natural-key constraint. dedupeZoneRows keeps only the freshest formation
   of each price level. */

import type { Bar } from "@/lib/types";
import { inNySession } from "@/lib/time/ny";
import {
  buildStack,
  scoreZoneAt,
  TF_LABEL,
  type Timeframe,
  type Zone,
} from "@/lib/strategies/zone-v5/engine";

export const ZONE_TFS: Timeframe[] = ["D", "240", "60", "15"];
export const MAX_ZONES_PER_FRAME = 12;

export interface ZoneUpsertRow {
  dedupe_key: string;
  symbol: string;
  timeframe: string;
  zone_type: "demand" | "supply";
  price_high: number;
  price_low: number;
  /* Odds-enhancer score for this zone, as if entered now at its own proximal
     (scoreZoneAt) — the same number and the same scale signals.score carries,
     so score_calibration can correlate zone quality against outcomes. Was
     computed inside the strategy and thrown away here until 2026-07-25. */
  score: number | null;
  status: "fresh" | "tested";
  fresh: boolean;
  achieved: boolean;
  blocked80: boolean;
  touches: number;
  source_candle_ts: string;
  active: boolean;
  updated_at: string;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/* The DB natural key, as a string. Mirrors
   zones_symbol_timeframe_zone_type_price_high_price_low_key. */
export const zoneNaturalKey = (r: {
  symbol: string;
  timeframe: string;
  zone_type: string;
  price_high: number;
  price_low: number;
}) => `${r.symbol}|${r.timeframe}|${r.zone_type}|${r.price_high}|${r.price_low}`;

export interface ExistingZoneRow {
  id: number;
  dedupe_key: string;
  symbol: string;
  timeframe: string;
  zone_type: string;
  price_high: number;
  price_low: number;
}

/* Which existing zones rows must go before the snapshot is upserted.
   KEEP a row only when it is an EXACT match of a snapshot row — same
   dedupe_key AND same natural key. Everything else is deleted.

   Pruning on dedupe_key alone (what this did until 2026-07-31) is not enough,
   and that is what kept throwing
   `duplicate key value violates unique constraint
    zones_symbol_timeframe_zone_type_price_high_price_low_key`
   — four times in the 118 runs the 2026-07-25 digest covers. A row surviving
   the prune still carries its OLD natural key; a zone's price_high/price_low
   can move while its dedupe_key (symbol:tf:type:formedAt) does not, because
   formedAt is the aggregated frame bar's bucket time and that bar keeps
   widening while it is still forming. So the survivor sits on natural key N
   while another snapshot row now claims N, and whichever of the two Postgres
   applies first wins — an ordering-dependent 23505 that no amount of in-batch
   deduping can prevent.

   Deleting every non-exact match makes the collision impossible by
   construction rather than by argument: after this runs, every remaining row
   is byte-identical on both keys to a row in the snapshot, so the upsert can
   only ever INSERT rows whose natural keys are unheld. It costs one SELECT of
   a table that holds ~25 rows. */
export function rowsToDelete(
  existing: ExistingZoneRow[],
  snapshot: ZoneUpsertRow[]
): number[] {
  const wanted = new Map(snapshot.map((r) => [r.dedupe_key, zoneNaturalKey(r)]));
  return existing
    .filter((row) => wanted.get(row.dedupe_key) !== zoneNaturalKey(row))
    .map((row) => row.id);
}

/* Collapse rows sharing the DB natural key, keeping the row with the latest
   source_candle_ts (the freshest formation of that price level). */
export function dedupeZoneRows(rows: ZoneUpsertRow[]): ZoneUpsertRow[] {
  const byNaturalKey = new Map<string, ZoneUpsertRow>();
  for (const row of rows) {
    const key = zoneNaturalKey(row);
    const kept = byNaturalKey.get(key);
    if (!kept || row.source_candle_ts > kept.source_candle_ts) byNaturalKey.set(key, row);
  }
  return [...byNaturalKey.values()];
}

export function zoneRows(symbol: string, bars: Bar[], nowSec: number): ZoneUpsertRow[] {
  const rthBars = bars.filter((b) => inNySession(b.time));
  const stack = buildStack(rthBars.length ? rthBars : bars);
  const price = bars[bars.length - 1].close;
  const out: ZoneUpsertRow[] = [];
  for (const tf of ZONE_TFS) {
    const zones = (stack.zones[tf] || [])
      .filter(
        (z: Zone) =>
          z.formedAt <= nowSec && (z.brokenAt === null || z.brokenAt > nowSec)
      )
      .sort(
        (a: Zone, b: Zone) =>
          Math.abs((a.proximal + a.distal) / 2 - price) - Math.abs((b.proximal + b.distal) / 2 - price)
      )
      .slice(0, MAX_ZONES_PER_FRAME);
    for (const z of zones) {
      const fresh = z.firstReturnAt === null || z.firstReturnAt > nowSec;
      out.push({
        dedupe_key: `${symbol}:${TF_LABEL[tf]}:${z.type}:${z.formedAt}`,
        symbol,
        timeframe: TF_LABEL[tf],
        zone_type: z.type,
        price_high: z.high,
        price_low: z.low,
        score: scoreZoneAt(stack, z, symbol, nowSec),
        status: fresh ? "fresh" : "tested",
        fresh,
        achieved: z.achievedAt !== null && z.achievedAt <= nowSec,
        blocked80: z.blocked80 !== null && z.blocked80.at <= nowSec,
        touches: fresh ? 0 : 1,
        source_candle_ts: iso(z.formedAt),
        active: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return dedupeZoneRows(out);
}
