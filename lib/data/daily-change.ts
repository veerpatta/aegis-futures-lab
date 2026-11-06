/* The reference price for "today's change" on a quote card.

   Yahoo's chart meta carries two different "previous closes":
   - `previousClose` is the last settle before today's session — what a
     trader means by "since yesterday".
   - `chartPreviousClose` is the close just before the FIRST bar of the
     requested range. The market route asks for a 5-day range, so this one is
     about a week old.

   Until 2026-11-06 the route preferred `chartPreviousClose`, so the cards
   showed a 5-day move (for example -2.44%) labelled as if it were today's
   (+0.07% at the time). Prefer the daily settle; fall back to the range
   close, then to the first bar's open, only when the vendor omits it. */
export interface QuoteMeta {
  previousClose?: number | null;
  chartPreviousClose?: number | null;
}

const usable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function dailyReferencePrice(meta: QuoteMeta, firstBarOpen: number): number {
  if (usable(meta.previousClose)) return meta.previousClose;
  if (usable(meta.chartPreviousClose)) return meta.chartPreviousClose;
  return firstBarOpen;
}
