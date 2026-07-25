/* Bar-age gate (item 2.4).

   Yahoo's delay is nominally 10–15 minutes. It stalls: the digest for the week
   to 2026-07-24 reported a worst bar age of 104 minutes, and the engine ran
   anyway. A signal computed on 104-minute-old bars is not a signal — its fill
   classification is meaningless, because the bar it was derived from is an hour
   and a half of unseen price action out of date.

   Deleting such rows would hide the outage, so they are recorded and FLAGGED.
   `stale_data` then gets exactly the treatment `suppressed` already gets:
   excluded from headline stats, from Telegram alerts, and from the model's
   training set, while staying visible in the paused/excluded drawer under its
   own label.

   The threshold is deliberately generous: at 30 minutes a signal is at worst
   six five-minute bars behind, which still describes the same move. Beyond
   that the feed has stalled, not lagged. */

import { nyMeta } from "@/lib/time/ny";

/** Minutes the freshest bar may lag `now` before a run counts as stale. */
export const STALE_BAR_AGE_MIN = Number(process.env.STALE_BAR_AGE_MIN ?? 30);

/** Whole minutes between the newest bar and now; 0 when the series is empty. */
export function barAgeMinutes(bars: { time: number }[], nowSec: number): number {
  if (!bars.length) return 0;
  return Math.max(0, Math.round((nowSec - bars[bars.length - 1].time) / 60));
}

export interface StalenessVerdict {
  stale: boolean;
  /** Worst age across the symbols checked, in minutes. */
  worstAgeMin: number;
  thresholdMin: number;
  /** Per-symbol ages, for the heartbeat message and the UI drawer. */
  ageBySymbol: Record<string, number>;
  /** Human sentence for the heartbeat / drawer; null when fresh. */
  note: string | null;
}

/* One verdict for the whole run, from every symbol's newest bar.

   Deliberately NOT gated on the entry window (unlike the older `(stale)`
   heartbeat marker in run-live.ts): a signal is computed from whatever bars
   exist at the moment it is computed, so if those bars are old the signal is
   tainted whether or not the clock says the session is open. Weekend and
   overnight runs produce no new signals anyway, so this cannot mass-flag
   legitimate rows — the flag is applied per row only when that row's run was
   stale (see run-live.ts). */
export function assessStaleness(
  bySymbol: Record<string, { time: number }[]>,
  nowSec: number,
  thresholdMin: number = STALE_BAR_AGE_MIN
): StalenessVerdict {
  const ageBySymbol: Record<string, number> = {};
  for (const [symbol, bars] of Object.entries(bySymbol))
    ageBySymbol[symbol] = barAgeMinutes(bars, nowSec);
  const ages = Object.values(ageBySymbol);
  const worstAgeMin = ages.length ? Math.max(...ages) : 0;
  const stale = worstAgeMin > thresholdMin;
  return {
    stale,
    worstAgeMin,
    thresholdMin,
    ageBySymbol,
    note: stale
      ? `stale data: freshest bar ${worstAgeMin}m old (limit ${thresholdMin}m) — ` +
        `rows recorded but flagged and excluded from stats, alerts and training`
      : null,
  };
}

/** Label the paused/excluded drawer shows for a stale row. */
export const STALE_LABEL = "STALE DATA";

/** Why a row is excluded, for the drawer's explanation line. */
export function staleReason(worstAgeMin: number, thresholdMin = STALE_BAR_AGE_MIN): string {
  return `computed on bars ${worstAgeMin}m old — over the ${thresholdMin}m limit`;
}

/* Trading-day helper the silence watchdog (2.5) shares: the NY date of a
   timestamp, so "days with a signal" and "trading days elapsed" agree. */
export const signalDateKey = (signalTs: string): string =>
  nyMeta(Math.floor(Date.parse(signalTs) / 1000)).dateKey;
