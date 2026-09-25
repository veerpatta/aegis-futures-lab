/** Older registry rows bundled two markets (or three control streams). */
export function effectiveTrialCount(rows: Array<{params?: {streams?: unknown[]};dataset?: {symbols?: unknown[]}}> ) {
  return rows.reduce((n,r)=>n+Math.max(1,r.params?.streams?.length??0,r.dataset?.symbols?.length??0),0);
}
