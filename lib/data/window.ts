/* Whole-session trimming for archive reads.
   ─────────────────────────────────────────
   The archive readers slice `bars_5m` at `nowSec - Nd` — an arbitrary instant.
   When that instant lands inside a NY session, the oldest NY date in the slice
   contributes a TRUNCATED day: on 2026-06-24 a 13:11 ET start left 27 of the
   session's 72 five-minute bars, a daily range of 43.75 against a typical ~100.

   That single malformed daily bar is not a cosmetic edge artifact. zone-v5
   classifies every candle base/leg/strong against a 14-bar ROLLING MEAN of
   range seeded with bar 0's own range (`candleMeta`,
   lib/strategies/zone-v5/engine.ts:219-251). A 30-day window of RTH-only bars
   is ~21 daily bars, so the seed is never washed out: a first bar 2.3× too
   small holds the mean down for 14 of those 21 bars and reclassifies candles
   across the whole window, rebuilding a different Daily zone set.

   Measured consequence (scripts/diag/tier-a.ts, PHASE1-FINDINGS.md): two
   nightly `gate_costs` runs 13 hours apart on the SAME archive reported
   invalidFill 61 vs 4, nesting 6,577 vs 3,654, and tier-A trade counts of 2 vs
   14. Crossing the two windows' edges shows the START edge decides all of it.

   Yahoo's own `range=60d` response is already day-aligned (first RTH day = 72
   of 72 bars), so `fetchYahooBars` — the live signal path — was never exposed.
   The exposed readers are the ones that slice the archive by an instant:
   `gate-costs.ts` (the funnel stored in learned_stats), `archiveTrailingBars`
   in `run-live.ts` (the Yahoo-down fallback, which DOES reach live signals),
   and `report.ts --archive` (the tuning numbers). */

import type { Bar } from "@/lib/types";
import { NY_SESSION_START_MIN, inNySession, nyMeta } from "@/lib/time/ny";

/* Whether archive slices are trimmed to whole NY sessions.

   Defaults to the legacy instant-slice so every stored number stays
   reproducible and the golden parity tests are untouched; flipped to true in a
   separate commit carrying the before/after backtest table. */
export const ARCHIVE_DAY_ALIGN = false;

/* Drop the leading NY date when the slice cut into its session.

   The test is the first RTH bar's minute: a whole session's first five-minute
   bar is stamped exactly at the 09:30 open, so anything later means the window
   started mid-session and that day's daily bar would be truncated. A leading
   date with no RTH bars at all (a slice that starts in the overnight, or on a
   holiday) is left alone — the first RTH day in the series is already whole. */
export function dropPartialLeadingSession(bars: Bar[]): Bar[] {
  if (!bars.length) return bars;
  const leadingKey = nyMeta(bars[0].time).dateKey;
  const firstRth = bars.find((b) => inNySession(b.time));
  if (!firstRth) return bars; // no session in the slice at all
  if (nyMeta(firstRth.time).dateKey !== leadingKey) return bars; // leading date is pre-session
  if (nyMeta(firstRth.time).minutes <= NY_SESSION_START_MIN) return bars; // whole session
  return bars.filter((b) => nyMeta(b.time).dateKey !== leadingKey);
}

/* What the archive readers call. Honours ARCHIVE_DAY_ALIGN so the behaviour
   change and its default flip are separate, auditable commits. */
export function alignArchiveSlice(bars: Bar[]): Bar[] {
  return ARCHIVE_DAY_ALIGN ? dropPartialLeadingSession(bars) : bars;
}
