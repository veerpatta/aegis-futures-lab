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
import { buildStack, TF_LABEL, type Timeframe, type Zone } from "@/lib/strategies/zone-v5/engine";

export const ZONE_TFS: Timeframe[] = ["D", "240", "60", "15"];
export const MAX_ZONES_PER_FRAME = 12;

export interface ZoneUpsertRow {
  dedupe_key: string;
  symbol: string;
  timeframe: string;
  zone_type: "demand" | "supply";
  price_high: number;
  price_low: number;
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

/* Collapse rows sharing the DB natural key, keeping the row with the latest
   source_candle_ts (the freshest formation of that price level). */
export function dedupeZoneRows(rows: ZoneUpsertRow[]): ZoneUpsertRow[] {
  const byNaturalKey = new Map<string, ZoneUpsertRow>();
  for (const row of rows) {
    const key = `${row.symbol}|${row.timeframe}|${row.zone_type}|${row.price_high}|${row.price_low}`;
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
