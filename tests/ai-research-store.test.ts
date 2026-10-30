import { describe, expect, it, vi } from "vitest";
import { ResearchStore } from "@/lib/ai-store/research";

describe("private AI research records", () => {
  it("looks up a request only for the supplied verified account", async () => {
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      const safe = /r\.id\s*=\s*\$1\s+AND\s+r\.user_id\s*=\s*\$2/i.test(sql);
      return { rows: safe && values[0] === "r1" && values[1] === "owner" ? [{ id: "r1", question: "private" }] : [] };
    });
    const store = new ResearchStore({ query });
    expect(await store.getRequest("r1", "owner")).toMatchObject({ id: "r1", question: "private" });
    expect(await store.getRequest("r1", "another-user")).toBeNull();
  });

  it("does not write an answer into another account's request", async () => {
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      const safe = /WHERE\s+(?:r\.)?id\s*=\s*\$1\s+AND\s+(?:r\.)?user_id\s*=\s*\$2/i.test(sql);
      return { rows: safe && values[0] === "r1" && values[1] === "owner" ? [{ request_id: "r1" }] : [] };
    });
    const store = new ResearchStore({ query });
    const result = { requestId: "r1", userId: "another-user", response: { answer: "x" }, citations: [], status: "complete" as const };
    expect(await store.saveResult(result)).toBe(false);
    expect(await store.saveResult({ ...result, userId: "owner" })).toBe(true);
  });

  it("returns false for an already recorded request without overwriting it", async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
    const store = new ResearchStore({ query });
    expect(await store.saveRequest({ id: "r1", userId: "owner", question: "question", snapshot: {}, snapshotHash: "hash", model: "model", promptVersion: "v1" })).toBe(false);
    expect(query.mock.calls[0][0]).toMatch(/ON CONFLICT\s*\(id\)\s*DO NOTHING/i);
  });
});
