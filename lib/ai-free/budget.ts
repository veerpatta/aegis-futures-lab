/* Ledger entries for free AI requests made on behalf of a person (the owner's
   research questions).

   The free endpoint cannot bill, but the ledger still does two useful jobs: it
   enforces the per-person daily request limit and records every request once.
   PgBudgetStore refuses a zero reservation, so a free request reserves one
   microdollar ($0.000001) as a placeholder and settles at 0 after a successful
   answer, leaving the monthly total unchanged. A failed request keeps its
   one-microdollar placeholder, which is harmless and keeps the record honest
   that the request was attempted. */

import type { BudgetStore } from "@/lib/ai-budget";

/** Reservation model label for requests answered by the free provider. */
export const FREE_LEDGER_MODEL = "nvidia-free";
const PLACEHOLDER_MICROS = 1;

export async function freeLedgerRequest<T>(
  store: BudgetStore,
  req: { requestId: string; userId: string },
  invoke: () => Promise<T>,
): Promise<T> {
  const reservation = await store.reserve({ id: req.requestId, userId: req.userId, model: FREE_LEDGER_MODEL, reservedMicros: PLACEHOLDER_MICROS });
  if (reservation.id !== req.requestId) throw new Error("Budget reservation identity mismatch.");
  const value = await invoke();
  await store.settle(reservation.id, 0);
  return value;
}
