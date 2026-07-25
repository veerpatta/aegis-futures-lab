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

/* Per-ROW staleness, which is the flag that actually goes on a signal.
   ────────────────────────────────────────────────────────────────────
   The run-level verdict above is right for the heartbeat and the Home panel —
   "the feed is behind right now" — but it is WRONG as a row flag, and shipping
   it as one was a real bug caught by the first live run: every engine pass is a
   full recompute of the trailing 7 days, so a Saturday run (bars 652 minutes
   old, because the market shut on Friday) flagged all nine of Friday's rows.
   Repeated, that drains every headline stat to zero.

   What actually makes a row untrustworthy is being at the BLIND EDGE of the
   data: not enough bars after its entry for the engine to have seen what
   happened. That is also exactly what corrupts `fill_confidence`, which walks
   the bars after entry to judge whether a resting order could have filled — the
   concrete harm the brief names.

   So: a row is stale iff fewer than `thresholdMin` of bar history exist after
   its entry. A weekend recompute of Friday's trades has hours of history after
   each one and is clean. A signal produced during a live 104-minute stall sits
   right at the edge of the visible data and is flagged. Both correct, and
   neither depends on the wall clock.

   Self-correcting by construction: the recompute rewrites `stale_data` from
   scratch every pass, so a row flagged during a stall is un-flagged once the
   bars arrive and its fill audit becomes judgeable again. */
export function staleAtSignal(
  signalSec: number,
  lastBarSec: number | null,
  thresholdMin: number = STALE_BAR_AGE_MIN
): boolean {
  if (lastBarSec === null) return false; // no bars for the symbol — not this gate's call
  return lastBarSec - signalSec < thresholdMin * 60;
}

/** Newest bar time per symbol, for staleAtSignal. */
export function lastBarBySymbol(
  bySymbol: Record<string, { time: number }[]>
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(bySymbol).map(([s, bars]) => [s, bars.length ? bars[bars.length - 1].time : null])
  );
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
