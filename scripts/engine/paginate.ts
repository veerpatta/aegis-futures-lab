/* Shared paginated read for the engine scripts. Supabase caps a single
   select at 1000 rows, so any read that needs COMPLETE history (promotion
   checklists, training sets) must page through with range() until a short
   page signals the end. Kept in one place so the four decision paths can't
   silently truncate (finding 2). */

import type { SupabaseClient } from "@supabase/supabase-js";

export const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orderColumn = "signal_ts"
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table} read: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}
