/* Pure decision helpers for the weekly challenger (challenger.ts self-executes
   on import, so these live apart for testing). With the (week_key, stream)
   uniqueness (finding 10) there is exactly ONE challenger_history row per
   stream per week, so confirmation reads a single, current verdict. */

/** Order-independent canonical form of a params object, for deep-equality. */
export const canonicalParams = (p: unknown): string =>
  JSON.stringify(p, Object.keys((p as object) ?? {}).sort());

export interface WeekRow {
  verdict: string;
  params: unknown;
}

/* A challenger is confirmed only if last week's SINGLE row for the stream is a
   surviving challenger with the deep-equal param set. Because a rerun replaces
   the week's row in place, this can't be fooled by a retracted verdict. */
export function confirmsTwoWeeks(thisParams: unknown, lastWeekRows: WeekRow[]): boolean {
  const prev = lastWeekRows.find((r) => r.verdict === "challenger");
  return !!prev && canonicalParams(prev.params) === canonicalParams(thisParams);
}
