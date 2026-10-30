import type { Pool, PoolClient } from "pg";
import { MONTHLY_LIMIT_MICROS, USER_DAILY_REQUESTS, type BudgetStore, type ReservationInput } from "./index";

const LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('aegis-ai:budget', 0))";
/** DB clock, in UTC, is the authority for both the month and the daily limit.
 * Count unsettled requests at their full reservation; confirmed requests at
 * actual usage. Do not exclude historical timeouts or retry attempts. */
const TOTALS = `SELECT
  COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_micros ELSE reserved_micros END), 0)::bigint AS used_micros,
  COUNT(*) FILTER (WHERE user_id = $1 AND created_at >= (date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::bigint AS user_count,
  to_char($2::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM') AS month_key
  FROM public.ai_budget_reservations
  WHERE created_at >= (date_trunc('month', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

async function dbTime(client: PoolClient): Promise<string> {
  // CURRENT_TIMESTAMP is frozen at BEGIN, potentially before waiting on the
  // global lock across a month boundary. Use actual DB time after the lock.
  const result = await client.query("SELECT clock_timestamp() AS budget_time");
  const raw = result.rows[0]?.budget_time;
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  if (!Number.isFinite(ms)) throw new Error("Budget clock is unavailable.");
  return new Date(ms).toISOString();
}

function count(v: unknown, label: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ${label} in budget ledger.`);
  return n;
}
function validText(v: string, label: string, max = 256): void {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`Invalid ${label}.`);
}
async function tx<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(LOCK);
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* retain the original error */ }
    throw error;
  } finally { client.release(); }
}

export class PgBudgetStore implements BudgetStore {
  constructor(private readonly pool: Pool) {}

  async reserve(input: ReservationInput): Promise<{ id: string }> {
    validText(input.id, "request id", 128);
    validText(input.userId, "user id");
    validText(input.model, "model", 128);
    if (!Number.isSafeInteger(input.reservedMicros) || input.reservedMicros <= 0 || input.reservedMicros > MONTHLY_LIMIT_MICROS) throw new Error("Invalid budget reservation.");
    return tx(this.pool, async (client) => {
      const at = await dbTime(client);
      const existing = await client.query("SELECT id FROM public.ai_budget_reservations WHERE id = $1", [input.id]);
      if (existing.rows.length) throw new Error("Request already reserved; do not retry the provider call.");
      const result = await client.query(TOTALS, [input.userId, at]);
      if (result.rows.length !== 1) throw new Error("Budget ledger is unavailable.");
      const used = count(result.rows[0].used_micros, "monthly total");
      const requests = count(result.rows[0].user_count, "daily total");
      if (requests >= USER_DAILY_REQUESTS) throw new Error("Daily AI request limit reached.");
      if (used + input.reservedMicros > MONTHLY_LIMIT_MICROS) throw new Error("Monthly AI budget exhausted.");
      await client.query("INSERT INTO public.ai_budget_reservations (id,user_id,model,reserved_micros,status,created_at) VALUES ($1,$2,$3,$4,'reserved',$5)", [input.id, input.userId, input.model, input.reservedMicros, at]);
      return { id: input.id };
    });
  }

  async settle(id: string, actualMicros: number): Promise<void> {
    validText(id, "request id", 128);
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) throw new Error("Invalid actual spend.");
    await tx(this.pool, async (client) => {
      const result = await client.query("UPDATE public.ai_budget_reservations SET status = 'settled', actual_micros = $2 WHERE id = $1 AND status = 'reserved' RETURNING id", [id, actualMicros]);
      if (result.rowCount !== 1) throw new Error("Reservation is missing or already settled.");
    });
  }

  async status(userId: string): Promise<{ month: string; usedMicros: number; remainingMicros: number; userRequests: number; dailyLimit: number }> {
    validText(userId, "user id");
    const client = await this.pool.connect();
    try {
      const at = await dbTime(client);
      const result = await client.query(TOTALS, [userId, at]);
      if (result.rows.length !== 1) throw new Error("Budget ledger is unavailable.");
      const used = count(result.rows[0].used_micros, "monthly total");
      const month = result.rows[0].month_key;
      if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) throw new Error("Budget month is unavailable.");
      return { month, usedMicros: used, remainingMicros: Math.max(0, MONTHLY_LIMIT_MICROS - used), userRequests: count(result.rows[0].user_count, "daily total"), dailyLimit: USER_DAILY_REQUESTS };
    } finally { client.release(); }
  }
}
