/* Can a stored "open" row still be open?

   Every live stream is flat by 15:25 ET (SESSION_EXIT_MINUTE in
   scripts/engine/tiers.ts — earlier on CME early-close days), and a waiting
   limit order is cancelled at the same time. So a `triggered` or `pending` row
   whose trading session ended well over an hour ago is not open: the engine
   simply has not rewritten it (lib/engine/stale-open.ts explains how two rows
   from 2026-08-18 stayed OPEN on screen for seven weeks).

   The engine now reconciles those rows itself; this is the screen's own guard
   so a row the engine has not reached yet can never be counted or shown as
   OPEN. It keys on the TRADING day (the Globex evening belongs to the next
   session), not the calendar date, so an overnight entry is still open the
   next morning. */

import { flattenMinuteNy } from "@/lib/market/holidays";
import { nyTimeToUnix, tradingDayKey } from "@/lib/time/ny";

/** Mirrors SESSION_EXIT_MINUTE (15:25 ET); tests/open-state.test.ts pins the two equal. */
export const SESSION_FLAT_MINUTE = 925;
/** Grace after the flatten time: the engine runs every 15 minutes and GitHub delays it. */
export const STALE_OPEN_GRACE_SEC = 90 * 60;

export function isOpenStatus(status: string): boolean {
  return status === "triggered" || status === "pending";
}

export function isStaleOpen(row: { status: string; signal_ts: string }, nowSec: number): boolean {
  if (!isOpenStatus(row.status)) return false;
  const entrySec = Date.parse(row.signal_ts) / 1000;
  if (!Number.isFinite(entrySec)) return false;
  const day = tradingDayKey(entrySec);
  const flatSec = nyTimeToUnix(day, flattenMinuteNy(day, SESSION_FLAT_MINUTE));
  return nowSec > flatSec + STALE_OPEN_GRACE_SEC;
}

/** Open AND still within its session — the only rows that may say OPEN. */
export function isLiveOpen(row: { status: string; signal_ts: string }, nowSec: number): boolean {
  return isOpenStatus(row.status) && !isStaleOpen(row, nowSec);
}
