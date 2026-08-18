/* Session classification on the GLOBEX day, which starts at 18:00 ET.

   lib/review/aggregate.ts already has a sessionOf(), and it is deliberately
   not reused here: its buckets are measured from NY midnight, so the whole
   Globex evening (18:00-24:00 ET) lands in "After the flat". For an equity
   stream that is correct — nothing trades there. For a metal whose Asia
   session lives at 19:00-23:00 ET it would classify every Asia trade as
   post-session, which is the opposite of the truth.

   That helper also backs published review numbers, so changing it would move
   analytics that have already been reported. This is a second classifier for
   a different day, not a replacement.

   The same anchor drives the backtest engine's session exit
   (BacktestInput.sessionAnchorMin), so entry classification and the flatten
   rule cannot drift apart. */

import { GLOBEX_REOPEN_MIN, NY_FLAT_BY_MIN, NY_SESSION_START_MIN, nyMeta } from "./ny";

/** 18:00 ET. Re-exported so callers name the concept, not the number. */
export const GLOBEX_ANCHOR_MIN = GLOBEX_REOPEN_MIN;

/** Minutes elapsed since the Globex reopen, 0..1439. */
export function globexMinutes(timeSec: number): number {
  return (nyMeta(timeSec).minutes - GLOBEX_ANCHOR_MIN + 1440) % 1440;
}

export type GlobexSession = "asia" | "london" | "ny" | "closed";

/* Boundaries in elapsed-minutes-since-18:00 ET:
     asia    18:00 -> 02:00 ET   (0    -> 480)
     london  02:00 -> 09:30 ET   (480  -> 930)
     ny      09:30 -> 15:25 ET   (930  -> 1285)
     closed  15:25 -> 18:00 ET   (1285 -> 1440)
   London and NY overlap in the real world; the boundary is placed at the NY
   open because that is where the strategy's own rule changes. */
const LONDON_FROM = (2 * 60 - GLOBEX_ANCHOR_MIN + 1440) % 1440; // 480
const NY_FROM = (NY_SESSION_START_MIN - GLOBEX_ANCHOR_MIN + 1440) % 1440; // 930
const NY_TO = (NY_FLAT_BY_MIN - GLOBEX_ANCHOR_MIN + 1440) % 1440; // 1285

export function globexSessionOf(timeSec: number): GlobexSession {
  const m = globexMinutes(timeSec);
  if (m < LONDON_FROM) return "asia";
  if (m < NY_FROM) return "london";
  if (m < NY_TO) return "ny";
  return "closed";
}

/** The strategy's own distinction: New York is the strict session. */
export const isStrictSession = (timeSec: number): boolean => globexSessionOf(timeSec) === "ny";

export const GLOBEX_BOUNDS = { LONDON_FROM, NY_FROM, NY_TO } as const;
