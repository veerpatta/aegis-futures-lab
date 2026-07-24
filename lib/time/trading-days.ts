/* Trading-day arithmetic shared by the breakers (hysteresis) and the
   win-probability model (walk-forward embargo). A "trading day" is a NY weekday
   that isn't a full CME holiday. Pure — nyMeta + the holiday table only. */

import { nyMeta } from "./ny";
import { holidayFor } from "@/lib/market/holidays";

/** NY trading days strictly after `fromSec`'s date up to and including
    `toSec`'s date (weekends and full holidays excluded). */
export function tradingDaysBetween(fromSec: number, toSec: number): number {
  if (toSec <= fromSec) return 0;
  const fromKey = nyMeta(fromSec).dateKey;
  const toKey = nyMeta(toSec).dateKey;
  let [y, m, d] = fromKey.split("-").map(Number);
  let count = 0;
  for (let i = 0; i < 400; i++) {
    const next = new Date(Date.UTC(y, m - 1, d) + 86400_000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const wd = next.getUTCDay();
    if (wd !== 0 && wd !== 6 && holidayFor(key)?.kind !== "closed") count++;
    if (key >= toKey) break;
  }
  return count;
}
