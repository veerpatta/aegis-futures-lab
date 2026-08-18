/* Gold/silver confirmation — the testable core, kept free of engine types.

   The brief: gold reaches its zone, and if silver has a corresponding zone we
   WAIT for silver to reach it before entering gold. If silver has no
   corresponding zone and the move is fast, take gold alone. In New York be
   strict; in Asia/London be flexible.

   Everything here is a pure function of zone lifecycle timestamps and visible
   bars. There is no armed/pending state anywhere, and that is deliberate:
   Strategy.onSnapshot is contractually a pure function of the visible bars, so
   a mutable "we are waiting on silver" flag would break the contract the
   backtest walk depends on.

   It does not need one. annotateZones stamps firstReturnAt on every zone
   during prepare(), and reading it behind a "<= now" guard is exactly the
   idiom zone-v5 already uses. The bar on which silver's zone first satisfies
   reachedAt <= T IS the entry bar, re-derived from immutable timestamps on
   every pass. */

import type { Bar } from "@/lib/types";
import type { Zone } from "@/lib/strategies/zone-v5/engine";

/** How far into a zone price must travel before it counts as reached. */
export const DEFAULT_CONFIRM_PENETRATION = 0.33;
/** Max zone-heights between silver's price and a zone for it to correspond. */
export const DEFAULT_MAX_PAIR_DISTANCE = 2;
/** Max bars between silver reaching its zone and gold triggering. */
export const DEFAULT_CONFIRM_MAX_LAG_BARS = 12;
/** Bars used to judge approach speed, matching zone-v5's intermarket window. */
const SPEED_BARS = 7;
const SPEED_MULT = 2.5;

/* How deep into a zone price travelled between two times, as a fraction of the
   zone's height. 0 = never entered, 1 = reached the distal, >1 = ran through.

   Not clamped above 1: running through the far side is real information and
   flattening it would hide it. 0.33 is the default threshold because zone-v5
   already uses height/3 for exactly this "did price actually get there"
   question — one number, one justification. */
export function penetrationDepth(zone: Zone, bars: Bar[], fromSec: number, toSec: number): number {
  if (!(zone.height > 0)) return 0;
  let ext: number | null = null;
  for (const b of bars) {
    if (b.time < fromSec || b.time > toSec) continue;
    const v = zone.type === "demand" ? b.low : b.high;
    if (ext === null) ext = v;
    else ext = zone.type === "demand" ? Math.min(ext, v) : Math.max(ext, v);
  }
  if (ext === null) return 0;
  const raw = zone.type === "demand" ? zone.proximal - ext : ext - zone.proximal;
  return Math.max(0, raw / zone.height);
}

/** Unix seconds at which the zone was first touched, or null if not by nowSec. */
export function reachedAt(zone: Zone, nowSec: number): number | null {
  return zone.firstReturnAt !== null && zone.firstReturnAt <= nowSec ? zone.firstReturnAt : null;
}

export function isAlive(zone: Zone, nowSec: number): boolean {
  return zone.formedAt <= nowSec && (zone.brokenAt === null || zone.brokenAt > nowSec);
}

/* The silver zone corresponding to a gold zone, or null.

   Four conditions, and the distance one carries the most weight: a silver zone
   forty heights away is not a confirmation waiting to happen, it is noise.
   Treating it as "present but unreached" would arm the wait forever and the
   strategy would simply stop trading. */
export function pairedZone(
  goldZone: Zone,
  silverZones: Zone[],
  silverPrice: number,
  nowSec: number,
  maxPairDistance = DEFAULT_MAX_PAIR_DISTANCE
): Zone | null {
  let best: Zone | null = null;
  let bestDist = Infinity;
  for (const z of silverZones) {
    if (z.type !== goldZone.type) continue; // gold and silver co-move: same sign
    if (!isAlive(z, nowSec)) continue;
    if (z.tfRank > goldZone.tfRank) continue; // no finer than gold's own frame
    const dist =
      silverPrice >= z.low && silverPrice <= z.high
        ? 0
        : silverPrice < z.low
          ? z.low - silverPrice
          : silverPrice - z.high;
    if (z.height > 0 && dist > maxPairDistance * z.height) continue;
    if (dist < bestDist || (dist === bestDist && best !== null && z.formedAt > best.formedAt)) {
      best = z;
      bestDist = dist;
    }
  }
  return best;
}

/** Fast approach, using the same measure zone-v5's intermarket check uses. */
export function approachSpeed(bars: Bar[], index: number): "fast" | "slow" {
  const from = Math.max(0, index - (SPEED_BARS - 1));
  const win = bars.slice(from, index + 1);
  if (win.length < SPEED_BARS) return "slow";
  const move = Math.abs(win[win.length - 1].close - win[0].close);
  const avgRange = win.reduce((s, b) => s + (b.high - b.low), 0) / win.length;
  return move > SPEED_MULT * Math.max(avgRange, 1e-9) ? "fast" : "slow";
}

export interface ConfirmInput {
  goldZone: Zone;
  silverZones: Zone[];
  silverBars: Bar[];
  silverPrice: number;
  nowSec: number;
  strictSession: boolean;
  goldSpeed: "fast" | "slow";
  barSeconds: number;
  confirmPenetration?: number;
  maxPairDistance?: number;
  confirmMaxLagBars?: number;
  allowFastSolo?: boolean;
}

export type ConfirmVerdict =
  | {
      ok: true;
      how: "silver-confirmed" | "solo-fast" | "solo-flexible";
      detail: string;
      pairedTf?: string;
    }
  | { ok: false; reason: "awaitingSilver" | "nyNoConfirm" | "staleConfirm"; detail: string };

/* The decision table, in one place.

   New York + no silver zone + SLOW is a skip. The brief's exception exists
   because a fast move leaves no time to wait; a slow one has no such excuse,
   and "be extremely cautious during New York" is the rule it would otherwise
   contradict. */
export function confirmEntry(i: ConfirmInput): ConfirmVerdict {
  const pen = i.confirmPenetration ?? DEFAULT_CONFIRM_PENETRATION;
  const lag = i.confirmMaxLagBars ?? DEFAULT_CONFIRM_MAX_LAG_BARS;
  const solo = i.allowFastSolo ?? true;

  const silver = pairedZone(
    i.goldZone,
    i.silverZones,
    i.silverPrice,
    i.nowSec,
    i.maxPairDistance ?? DEFAULT_MAX_PAIR_DISTANCE
  );

  if (!silver) {
    if (!i.strictSession)
      return {
        ok: true,
        how: "solo-flexible",
        detail: "No corresponding silver zone; Asia/London allows a solo gold entry",
      };
    if (solo && i.goldSpeed === "fast")
      return {
        ok: true,
        how: "solo-fast",
        detail: "No corresponding silver zone, but the move is fast — solo entry",
      };
    return {
      ok: false,
      reason: "nyNoConfirm",
      detail: "New York, no corresponding silver zone, and a slow approach — no reason to act",
    };
  }

  const touched = reachedAt(silver, i.nowSec);
  if (touched === null)
    return {
      ok: false,
      reason: "awaitingSilver",
      detail: "Gold is at its zone; waiting for silver to reach its own",
    };

  const depth = penetrationDepth(silver, i.silverBars, touched, i.nowSec);
  if (depth < pen)
    return {
      ok: false,
      reason: "awaitingSilver",
      detail: `Silver touched its zone but only ${(depth * 100).toFixed(0)}% deep (needs ${(pen * 100).toFixed(0)}%)`,
    };

  /* Confirmation has to be RECENT. Silver visiting its zone six hours before
     gold reaches its own is two unrelated events, not two markets arriving
     together. */
  const lagBars = Math.floor((i.nowSec - touched) / i.barSeconds);
  if (lagBars > lag)
    return {
      ok: false,
      reason: "staleConfirm",
      detail: `Silver reached its zone ${lagBars} bars ago (limit ${lag}) — too old to confirm`,
    };

  return {
    ok: true,
    how: "silver-confirmed",
    detail: `Silver confirmed ${lagBars} bar(s) ago, ${(depth * 100).toFixed(0)}% into its zone`,
    pairedTf: silver.tf,
  };
}
