/* The instruments this app can FETCH.
 *
 * `FeedSymbol` answers "can bars be loaded for this?" — NOT "can it be
 * traded?". Those are different questions and conflating them is how a
 * confirmation-only series ends up with a position in it. Tradability lives in
 * `lib/costs/specs.ts` as `ContractSpec.role` / `.tradable`, and is enforced at
 * the engine boundary.
 *
 * SI is here because the gold strategy needs silver's price structure to
 * confirm an entry. It is `role: "confirmation"` and can never be traded.
 *
 * MNQ is still here after being retired as a live stream. Retiring a stream is
 * a `tierStreams()` decision; it does not make seven years of archived bars
 * unreadable, and dropping MNQ from this union would silently reprice every
 * historical diagnostic at $1/point.
 */

import { CONTRACT_SPECS, specFor } from "@/lib/costs/specs";

export type FeedSymbol = "MES" | "MNQ" | "MGC" | "SI";

/* The one place the fetchable set is enumerated. Everything below derives from
   it, so a symbol cannot be half-added. */
export const FEED_SYMBOLS: readonly FeedSymbol[] = ["MES", "MNQ", "MGC", "SI"] as const;

export const YAHOO_SYMBOLS: Record<FeedSymbol, string> = {
  MES: "MES=F",
  MNQ: "MNQ=F",
  MGC: "MGC=F",
  /* Full-size silver, deliberately NOT micro (SIL=F). specs.ts role-locks SIL:
     "micro silver's thin book manufactures zone structure that is not there, so
     it must never be a confirmation series." A false zone in silver would
     manufacture a false confirmation on gold, which is the precise failure this
     strategy is exposed to. The two quote within a cent of each other and
     silver is never traded here, so nothing is lost by taking the deeper book. */
  SI: "SI=F",
};

export const CONTRACT_LABELS: Record<FeedSymbol, string> = {
  MES: "Micro E-mini S&P 500",
  MNQ: "Micro E-mini Nasdaq-100",
  MGC: "Micro Gold",
  SI: "Silver (full-size)",
};

/* DERIVED from the contract specs rather than maintained beside them.
   These were two hand-kept tables cross-checked by a test that iterated THIS
   one — so a symbol present in specs but missing here was not caught, and that
   gap is exactly the path to `pointValues[symbol] ?? 1` pricing an instrument
   at $1/point. One source now; the test hardcodes the literals independently. */
export const POINT_VALUES: Record<FeedSymbol, number> = Object.fromEntries(
  FEED_SYMBOLS.map((s) => [s, specFor(s).pointValue])
) as Record<FeedSymbol, number>;

/* Derived from the map's own keys. This used to be a hand-written chain of
   literal comparisons, which meant widening the union did NOT fail compilation
   here — the guard could silently disagree with the type it was guarding. */
export function isFeedSymbol(value: string): value is FeedSymbol {
  return Object.prototype.hasOwnProperty.call(YAHOO_SYMBOLS, value);
}

/** Symbols this app may actually take a position in. */
export function isTradableSymbol(value: string): value is FeedSymbol {
  return isFeedSymbol(value) && CONTRACT_SPECS[value]?.tradable === true;
}

/** The tradable subset, for UI pickers that must never offer a confirmation series. */
export const TRADABLE_SYMBOLS: readonly FeedSymbol[] = FEED_SYMBOLS.filter((s) =>
  isTradableSymbol(s)
);
