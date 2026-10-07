/* When the practice-account broker may run.

   scripts/engine/paper-broker.ts pauses a live release for good when either
   market's newest bar is more than 30 minutes old — right for a feed outage in
   the middle of a session, wrong for the market's own quiet hours. The engine
   also runs during the daily 17:00–18:00 ET halt, through Friday evening and at
   the Sunday 18:00 ET reopen, when the newest bar is old because nothing
   traded. Releases are created Sunday 04:00 UTC, so the first Sunday-evening
   pass would have paused every new release before its first trade.

   The broker replays from the account's last processed bar, so skipping a pass
   loses nothing. Outside the 02:00–15:25 ET entry window a stale feed is
   expected and the pass is skipped; inside it, staleness is a real fault and the
   broker keeps its own pause. Lives here, not in the broker, because the broker
   is research code: editing it would restart forward evidence. */

import { inEntryWindow } from "@/lib/time/session";

export const BROKER_FRESH_SEC = 1800;

export function shouldRunPaperBroker(bySymbol: Record<string, { time: number }[] | undefined>, nowSec: number): boolean {
  const fresh = ["MES", "MNQ"].every((s) => {
    const last = bySymbol[s]?.at(-1)?.time;
    return last !== undefined && nowSec - last <= BROKER_FRESH_SEC;
  });
  return fresh || inEntryWindow(nowSec);
}
