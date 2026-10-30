import { describe, expect, it } from "vitest";
import { captureAiShadowBars } from "@/scripts/engine/ai-shadow-bars";

const receivedAt = Date.parse("2026-10-30T14:30:00Z");
const study = { id: "study", registeredAt: new Date(receivedAt - 3600000).toISOString() };
const bar = { time: receivedAt / 1000 - 600, open: 100, high: 102, low: 99, close: 101 };

describe("AI shadow market receipts", () => {
  it("takes only valid complete post-registration direct feed bars", async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const client = { query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } };
    await captureAiShadowBars(client, study, [
      { symbol: "MES", bars: [bar, { ...bar, time: receivedAt / 1000 - 60 }, { ...bar, time: receivedAt / 1000 - 7200 }, { ...bar, high: 1 }], receivedAt, fromArchive: false },
      { symbol: "MNQ", bars: [bar], receivedAt, fromArchive: true },
    ]);
    const values = calls.find(c => c.sql.includes("INSERT INTO public.ai_shadow_bars"))!.values!;
    expect(JSON.parse(values[1] as string)).toEqual([{ symbol: "MES", bar_time: bar.time, open: 100, high: 102, low: 99, close: 101, source_received_at: new Date(receivedAt).toISOString() }]);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("does not capture archive-only feeds or fetches predating registration", async () => {
    let count = 0;
    const client = { query: async () => { count++; return { rows: [], rowCount: null }; } };
    await captureAiShadowBars(client, study, [{ symbol: "MES", bars: [bar], receivedAt, fromArchive: true },
      { symbol: "MNQ", bars: [bar], receivedAt: receivedAt - 7200000, fromArchive: false }]);
    expect(count).toBe(0);
  });
  it("rolls back if a revision record cannot be written", async () => {
    const calls: string[] = [];
    const client = { query: async (sql: string) => { calls.push(sql); if (sql.includes("ai_shadow_bar_revisions")) throw new Error("unavailable"); return { rows: [], rowCount: 1 }; } };
    await expect(captureAiShadowBars(client, study, [{ symbol: "MES", bars: [bar], receivedAt, fromArchive: false }])).rejects.toThrow("unavailable");
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});
