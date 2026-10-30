import { describe, expect, it } from "vitest";
import { PgBudgetStore } from "@/lib/ai-budget/pg";

function poolFixture(options: { total?: number; userCount?: number; duplicate?: boolean; settleRows?: number } = {}) {
  const log: { sql: string; values?: unknown[] }[] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      log.push({ sql, values });
      if (sql.includes("clock_timestamp() AS budget_time")) return { rows: [{ budget_time: "2026-10-30T23:59:59.000Z" }], rowCount: 1 };
      if (sql.includes("SELECT id FROM public.ai_budget_reservations")) return { rows: options.duplicate ? [{ id: "x" }] : [], rowCount: options.duplicate ? 1 : 0 };
      if (sql.includes("AS used_micros")) return { rows: [{ used_micros: options.total ?? 0, user_count: options.userCount ?? 0 }], rowCount: 1 };
      if (sql.startsWith("UPDATE public.ai_budget_reservations")) return { rows: [], rowCount: options.settleRows ?? 1 };
      return { rows: [], rowCount: 1 };
    }, release() {},
  };
  return { pool: { connect: async () => client }, log };
}
const request = { id: "req-1", userId: "user-1", model: "gpt-6.1-sol", reservedMicros: 140000 };
describe("Postgres reservation gate", () => {
  it("locks the shared budget and commits a reservation before returning", async () => {
    const { pool, log } = poolFixture();
    await expect(new PgBudgetStore(pool as never).reserve(request)).resolves.toEqual({ id: request.id });
    expect(log.findIndex(x => x.sql.includes("pg_advisory_xact_lock"))).toBeLessThan(log.findIndex(x => x.sql.startsWith("INSERT INTO public.ai_budget_reservations")));
    expect(log.findIndex(x => x.sql.includes("clock_timestamp() AS budget_time"))).toBeGreaterThan(log.findIndex(x => x.sql.includes("pg_advisory_xact_lock")));
    expect(log.find(x => x.sql.startsWith("INSERT INTO public.ai_budget_reservations"))?.values).toContain("2026-10-30T23:59:59.000Z");
    expect(log.at(-1)?.sql).toBe("COMMIT");
  });
  it("rejects cap exhaustion, daily limits and duplicate ids without inserting", async () => {
    for (const options of [{ total: 24_900_000 }, { userCount: 10 }, { duplicate: true }]) {
      const { pool, log } = poolFixture(options);
      await expect(new PgBudgetStore(pool as never).reserve(request)).rejects.toThrow();
      expect(log.some(x => x.sql.startsWith("INSERT INTO public.ai_budget_reservations"))).toBe(false);
      expect(log.at(-1)?.sql).toBe("ROLLBACK");
    }
  });
  it("rejects any second settlement", async () => {
    const { pool, log } = poolFixture({ settleRows: 0 });
    await expect(new PgBudgetStore(pool as never).settle("req-1", 30)).rejects.toThrow();
    expect(log.at(-1)?.sql).toBe("ROLLBACK");
  });
});
