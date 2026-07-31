/* Scheduled macro releases, for the slippage multiplier.
 *
 * HONEST LIMITATION, stated here rather than discovered later: this repo has
 * no historical macro calendar covering 2019-2026. app/api/events/route.ts
 * hardcodes releases from 2026-06-05 forward and merges a live ForexFactory
 * feed; neither reaches back over the Databento archive.
 *
 * So only NFP is available, because it is the one release with a purely
 * algorithmic schedule: first Friday of the month, 08:30 ET. CPI, PPI and FOMC
 * are not derivable and are left explicitly empty rather than guessed.
 *
 * Because the calendar is partial, CostModel.macroMult defaults to 1 (off) in
 * every shipped model. A partial calendar applied silently would attribute
 * cost to the days it happens to know about and not to the days it does not —
 * which is a bias, not an approximation.
 */

import { nyTimeToUnix } from "@/lib/time/ny";

/** 08:30 ET, the release minute for NFP and most BLS/BEA prints. */
export const RELEASE_MIN = 8 * 60 + 30;

const pad = (n: number) => String(n).padStart(2, "0");

/** NY date key of the first Friday of a given month. `month` is 1-12. */
export function firstFridayKey(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (5 - first.getUTCDay() + 7) % 7; // 5 = Friday
  return `${year}-${pad(month)}-${pad(1 + offset)}`;
}

/* Unix seconds of every NFP release between two instants.
 *
 * Approximation, and it matters: the first-Friday rule is the schedule, not
 * the history. Releases have shifted for holidays and were suspended during
 * the 2018-19 and 2025 shutdowns. Treat this as "roughly when the market was
 * jumpy", not as a verified event list.
 */
export function nfpTimes(fromSec: number, toSec: number): number[] {
  if (!(toSec > fromSec)) return [];
  const start = new Date(fromSec * 1000);
  const end = new Date(toSec * 1000);
  const out: number[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  const lastYear = end.getUTCFullYear();
  const lastMonth = end.getUTCMonth() + 1;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const t = nyTimeToUnix(firstFridayKey(year, month), RELEASE_MIN);
    if (t >= fromSec && t <= toSec) out.push(t);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/* FOMC decision times. Deliberately empty: the schedule is announced, not
   computed, and no committed source in this repo covers 2019-2026. Populate
   only with a citation, and update the macroMult default at the same time. */
export const FOMC_DECISIONS: number[] = [];
