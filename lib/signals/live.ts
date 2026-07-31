/* Which signals actually happened live.
   ─────────────────────────────────────────────────────────────────────────
   The engine's first run was 2026-07-19 11:31 UTC, and every run mirrors a
   trailing seven days. So on that first pass it wrote signals dated 2026-07-13
   onward — six days of rows for sessions that had already finished. They are
   correctly computed (the backtest engine acts on completed bars and never
   looks ahead), but they were BACKFILLED, not traded: no one could have acted
   on them, and they are the output of a strategy being applied to the window
   it was tuned on.

   That distinction was not academic. On 2026-07-31 the numbers were:

     backfilled, before go-live   11 closed   net +$1,441.78
     genuinely live since go-live 17 closed   net   −$215.68

   Home's "Bot · last 3 weeks" card summed both and printed **+$1,226.10** as
   the headline P&L, so the app's single most prominent number was carried
   entirely by rows the engine wrote about the past, while every trade it has
   actually made since going live has, in aggregate, lost money. Exactly the
   error this app exists to avoid, on its own front page.

   `LiveVsTuning` already filtered on GO_LIVE_DATE; the performance cards did
   not. This is that filter, in one place, so the two can never disagree
   again. */

import { GO_LIVE_DATE } from "@/scripts/engine/tiers";
import { nyMeta } from "@/lib/time/ny";

/** True when a signal was produced by a live engine pass rather than written
    retroactively by the first run's trailing-7-day mirror. Compared on the NY
    trading day, because that is the key everything else in the app groups by. */
export function isLiveSignal(signalTs: string): boolean {
  return nyMeta(Math.floor(new Date(signalTs).getTime() / 1000)).dateKey >= GO_LIVE_DATE;
}

/** Keep only the rows that were live. Anything measuring the bot's PERFORMANCE
    must go through this; a feed that merely lists what the engine knows need
    not, as long as it does not add the rows up. */
export function liveOnly<T extends { signal_ts: string }>(signals: T[]): T[] {
  return signals.filter((s) => isLiveSignal(s.signal_ts));
}
