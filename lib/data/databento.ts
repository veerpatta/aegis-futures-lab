/* Databento GLBX.MDP3 `ohlcv-1m` → the 5-minute bars this engine speaks.
   ─────────────────────────────────────────────────────────────────────────
   There is no `ohlcv-5m` schema in GLBX.MDP3, so the 5-minute series has to
   be folded here from one-minute records. Rule: bar shaping is frozen — this
   adapter produces bars that already satisfy shapeCompleted5mBars' contract
   (5m-aligned epoch, completed only, finite OHLC), because feeds adapt to the
   shaping and never the reverse.

   Two things in here are easy to get wrong silently, so both fail loudly.

   1) PRICE SCALING. DBN stores prices as int64 with 1e-9 fixed-point scaling.
      Depending on whether a request asks for `pretty_px`, the same field comes
      back as either "7369.75" or "7369750000000". Multiplying by the wrong
      convention does not throw — it produces a bar series that is internally
      consistent, passes every finite check, and is off by nine orders of
      magnitude. assertPlausible() rejects it instead.

   2) COMPLETENESS. shapeCompleted5mBars decides "completed" against
      Date.now(), which is meaningless for a historical backfill of bars from
      months ago — every bucket would pass. Completeness here is DATA-relative:
      a bucket is closed when the pull itself contains a later minute. */

import type { Bar } from "@/lib/types";

/** DBN fixed-point price scale: real price = raw × 1e-9. */
export const DBN_PX_SCALE = 1e9;

/* Databento's own open issue: continuous-contract (`stype_in=continuous`)
   requests return missing data for UTC Sundays from 2026-05-17 onward. Our
   signal-engine cron deliberately covers the Sunday Globex reopen (every 15
   minutes across 22:00-23:59 UTC on Sundays), so an empty Sunday is EXPECTED
   here and must not be reported as a dead feed.

   Exported as a constant because the alternative — each caller matching its
   own copy of the wording — is the exact drift this repo keeps getting bitten
   by (see STALE_MARKER in lib/time/session.ts for the same fix). Anything that
   classifies a gap must import this, never retype it. */
export const DATABENTO_SUNDAY_GAP = "databento-sunday-continuous-gap";

/** True for a timestamp that falls on a Sunday in UTC. Deliberately UTC and
    deliberately narrow: the known bug is Sunday-shaped, so accepting a gap on
    any other weekday would let a real outage hide behind it. */
export function isUtcSunday(unixSec: number): boolean {
  return new Date(unixSec * 1000).getUTCDay() === 0;
}

/** A plausible index level for the contracts this app trades. MES ≈ 7,400 and
    MNQ ≈ 27,500 as of writing; the window is wide enough to survive years of
    drift and narrow enough to catch a 1e-9 scaling mistake, which lands either
    around 7e-6 or 7e12. */
const MIN_PLAUSIBLE_PX = 100;
const MAX_PLAUSIBLE_PX = 1_000_000;

export function assertPlausible(bars: Bar[], label: string): void {
  if (!bars.length) return;
  for (const b of bars) {
    for (const px of [b.open, b.high, b.low, b.close]) {
      if (!Number.isFinite(px) || px < MIN_PLAUSIBLE_PX || px > MAX_PLAUSIBLE_PX)
        throw new Error(
          `${label}: implausible price ${px} at ${new Date(b.time * 1000).toISOString()} — ` +
            `expected ${MIN_PLAUSIBLE_PX}–${MAX_PLAUSIBLE_PX}. This is almost always the DBN ` +
            `1e-9 fixed-point scaling applied the wrong way (pretty_px on/off mismatch), ` +
            `not bad market data.`
        );
    }
  }
}

/* ── Parsing ──────────────────────────────────────────────────────────────

   `ts_event` arrives as nanoseconds-since-epoch, or as an ISO-8601 string when
   the request sets pretty_ts. Both are accepted; anything else throws rather
   than silently becoming NaN and being filtered out as "not finite" three
   functions later. */
export function parseTsEvent(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    // Nanoseconds. Seconds would be ~1.7e9 (10 digits), nanos ~1.7e18 (19).
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new Error(`ts_event out of range: "${raw}"`);
    return Math.floor(n / 1e9);
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) throw new Error(`Unparseable ts_event: "${raw}"`);
  return Math.floor(ms / 1000);
}

export interface ParseOptions {
  /** True when the request was made WITHOUT pretty_px, so prices are raw
      int64 fixed-point and need dividing by 1e9. */
  rawPrices: boolean;
}

/* `Number("")`, `Number(" ")` and `Number(undefined)` are 0, 0 and NaN — so a
   blank price cell parses as a PRICE OF ZERO, sails through every
   Number.isFinite check, and lands in an aggregate where it sets the bucket's
   low to 0. Strict parsing is the difference between dropping one bad minute
   and corrupting a 5-minute bar's range. */
function strictNum(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const t = raw.trim();
  if (!t) return NaN;
  return Number(t);
}

/* Minimal CSV reader for the ohlcv-1m response. Databento's CSV has a header
   row and never quotes numeric fields, so a full RFC-4180 parser is not
   needed; the column ORDER is not assumed, only the names. */
export function parseOhlcv1mCsv(text: string, opts: ParseOptions): Bar[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`ohlcv-1m response is missing the "${name}" column`);
    return i;
  };
  const iTs = col("ts_event");
  const iO = col("open");
  const iH = col("high");
  const iL = col("low");
  const iC = col("close");
  const iV = header.indexOf("volume");

  const scale = opts.rawPrices ? DBN_PX_SCALE : 1;
  const out: Bar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const bar: Bar = {
      time: parseTsEvent(c[iTs] ?? ""),
      open: strictNum(c[iO]) / scale,
      high: strictNum(c[iH]) / scale,
      low: strictNum(c[iL]) / scale,
      close: strictNum(c[iC]) / scale,
      // A missing volume is genuinely fine and means zero; a missing PRICE is
      // not, which is why only this field is lenient.
      volume: iV >= 0 ? Number(c[iV]?.trim() || 0) || 0 : 0,
    };
    // Drop unusable rows rather than propagating NaN into an aggregate, where
    // one bad minute would poison a whole 5-minute bar's high or low.
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) continue;
    // An inverted range means the row is corrupt or the columns are not what
    // the header claimed. One such row is a vendor glitch worth skipping; if
    // it is systematic the result comes back empty or fails assertPlausible,
    // both of which are loud at the call site rather than a quiet short read.
    if (bar.high < bar.low) continue;
    out.push(bar);
  }
  return out;
}

/* ── Aggregation ──────────────────────────────────────────────────────────

   Folds 1-minute bars into the 5-minute grid.

   A bucket is emitted only when the input contains a minute at or after
   bucket + 300, which proves the bucket closed within this pull. The trailing
   bucket is therefore always dropped — it is the one that may still be
   forming. This is what "completed only" has to mean for historical data.

   NOTE, because it reads like a bug and is not: a complete bucket may hold
   FEWER than five one-minute bars. CME OHLCV omits minutes with no trades, so
   a thin overnight five-minute window legitimately contains one or two. A
   five-bar requirement would silently delete real overnight structure — which
   is exactly the structure zone-v5 builds Daily/4H frames from. */
export function aggregate1mTo5m(oneMin: Bar[]): Bar[] {
  if (!oneMin.length) return [];

  // Sort defensively. `open` comes from the first minute and `close` from the
  // last, so an out-of-order input corrupts both without ever looking wrong.
  const bars = [...oneMin].sort((a, b) => a.time - b.time);
  const lastTime = bars[bars.length - 1].time;

  const buckets = new Map<number, Bar>();
  for (const b of bars) {
    if (!Number.isFinite(b.time)) continue;
    if (![b.open, b.high, b.low, b.close].every(Number.isFinite)) continue;
    const key = Math.floor(b.time / 300) * 300;
    const acc = buckets.get(key);
    if (!acc) {
      buckets.set(key, {
        time: key,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      });
      continue;
    }
    acc.high = Math.max(acc.high, b.high);
    acc.low = Math.min(acc.low, b.low);
    acc.close = b.close; // bars are sorted, so this ends as the last minute
    acc.volume = (acc.volume ?? 0) + (b.volume ?? 0);
  }

  return [...buckets.values()]
    .filter((bar) => lastTime >= bar.time + 300) // completed within this pull
    .sort((a, b) => a.time - b.time);
}

/** Parse + aggregate + sanity-check, which is what a caller actually wants. */
export function bars5mFromOhlcv1mCsv(
  text: string,
  opts: ParseOptions,
  label: string
): Bar[] {
  const out = aggregate1mTo5m(parseOhlcv1mCsv(text, opts));
  assertPlausible(out, label);
  return out;
}
