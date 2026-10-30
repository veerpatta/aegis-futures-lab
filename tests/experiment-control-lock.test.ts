import { describe, expect, it } from "vitest";
import { PgStore } from "@/lib/experiment/store-pg";

function fixture(failUpdate = false) {
  const calls: { sql: string; args?: unknown[] }[] = [];
  const client = {
    async query(sql: string, args?: unknown[]) {
      calls.push({ sql, args });
      if (sql.startsWith("SELECT status FROM experiments")) return { rows: [{ status: "active" }] };
      if (sql.startsWith("INSERT INTO experiment_changes")) return { rows: [{ id: 7 }] };
      if (failUpdate && sql.startsWith("UPDATE experiments")) throw new Error("update failed");
      return { rows: [] };
    },
    release() {},
  };
  return { store: new PgStore({ connect: async () => client } as never), calls };
}

describe("owner status transaction", () => {
  it("takes the tick's experiment lock before reading and updating the status", async () => {
    const { store, calls } = fixture();
    await store.setStatus("learner-1", "paused", { kind: "paused", reason: "owner requested pause", eventKey: "event-1" });
    const lock = calls.findIndex(c => c.sql.includes("aegis-exp:'"));
    const read = calls.findIndex(c => c.sql.startsWith("SELECT status FROM experiments"));
    const update = calls.findIndex(c => c.sql.startsWith("UPDATE experiments"));
    expect(lock).toBeGreaterThan(0);
    expect(calls[lock].sql).toContain("aegis-exp:");
    expect(calls[lock].args).toEqual(["learner-1"]);
    expect(lock).toBeLessThan(read);
    expect(read).toBeLessThan(update);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("rolls back the change record if the status update fails", async () => {
    const { store, calls } = fixture(true);
    await expect(store.setStatus("learner-1", "paused", { kind: "paused", reason: "owner requested pause", eventKey: "event-2" })).rejects.toThrow("update failed");
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
  });
});
