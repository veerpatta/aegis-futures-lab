import { describe, expect, it } from "vitest";
import { captureAiShadowPass, configuredShadowStudyId, shadowMarketAsOf } from "@/scripts/engine/ai-shadow-capture";

const observed = Date.parse("2026-10-30T14:30:00Z");
const time = (sec: number) => new Date(observed + sec * 1000).toISOString();
const row = { dedupe_key: "B:rsi-reversion:MES:123", tier: "B" as const, symbol: "MES", direction: "long", signal_ts: time(-600),
  entry_price: 6000, stop_price: 5990, target_price: 6020, score: 1, rr: 2, status: "triggered", suppressed: true, stale_data: false, orphaned: false,
  exit_ts: null, exit_price: null, pnl_usd: null, unexpected_private: "do-not-copy" };
const options = { study: { id: "shadow-v1", registeredAt: time(-86400) }, signals: [row], marketAsOf: { MES: observed / 1000 - 300 }, sourceCodeSha: "sha", now: () => observed };

function client() {
  const records = new Map<string, unknown[]>();
  const calls: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push(sql);
    if (!sql.startsWith("INSERT")) return { rows: [], rowCount: null };
    const key = `${values[0]}:${values[1]}`;
    if (records.has(key)) return { rows: [], rowCount: 0 };
    records.set(key, values);
    return { rows: [{ opportunity_key: values[1] }], rowCount: 1 };
  };
  return { query, records, calls };
}

describe("AI shadow capture", () => {
  it("requires an explicit capture enable and a selected study", () => {
    expect(configuredShadowStudyId("true", " study ")).toBe("study");
    expect(configuredShadowStudyId("false", "study")).toBeNull();
    expect(configuredShadowStudyId(undefined, "study")).toBeNull();
    expect(configuredShadowStudyId("true", "  ")).toBeNull();
    expect(configuredShadowStudyId("TRUE", "study")).toBeNull();
  });
  it("never treats archived fallback bars as a fresh Yahoo receipt", async () => {
    const db = client();
    expect(shadowMarketAsOf(observed / 1000 - 300, false)).toBe(observed / 1000);
    await captureAiShadowPass(db, { ...options, marketAsOf: { MES: shadowMarketAsOf(observed / 1000 - 300, true) } });
    expect([...db.records.values()][0][7]).toBe(false);
    expect([...db.records.values()][0][9]).toBe("rejected");
  });
  it("records a withheld idea once with actual receipt and no outcome data", async () => {
    const db = client();
    const result = await captureAiShadowPass(db, options);
    expect(result).toMatchObject({ ok: true, inserted: 1, rejected: 0 });
    const saved = [...db.records.values()][0];
    expect(saved).toContain(time(0));
    const payload = JSON.parse(saved.find(v => typeof v === "string" && v.startsWith("{")) as string);
    expect(payload.suppressed).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/exit|pnl|do-not-copy/i);
    expect(JSON.stringify(payload.modelInput)).not.toMatch(/entry|stop|target|6000|5990|6020/i);
    expect(db.calls[0]).toBe("BEGIN");
    expect(db.calls.at(-1)).toBe("COMMIT");
  });
  it("does not rewrite the first receipt or duplicate an idea", async () => {
    const db = client();
    await captureAiShadowPass(db, options);
    const previous = [...db.records.values()][0];
    const next = await captureAiShadowPass(db, { ...options, now: () => observed + 300000 });
    expect(next).toMatchObject({ ok: true, inserted: 0, duplicates: 1 });
    expect([...db.records.values()][0]).toEqual(previous);
  });
  it("records a closed or stale observation as rejected, without its outcome", async () => {
    const db = client();
    const result = await captureAiShadowPass(db, { ...options, signals: [{ ...row, status: "hit_target", exit_ts: time(0), exit_price: 6123, pnl_usd: 999 }, { ...row, dedupe_key: "B:rsi-reversion:MES:124", stale_data: true }] });
    expect(result).toMatchObject({ ok: true, inserted: 2, rejected: 2 });
    expect(JSON.stringify([...db.records.values()])).not.toMatch(/pnl|exit|6123|999/i);
    expect(JSON.stringify([...db.records.values()])).toMatch(/already-closed/);
    expect(JSON.stringify([...db.records.values()])).toMatch(/stale/);
  });
  it("never treats a triggered row carrying an outcome as prospective", async () => {
    const db = client();
    const result = await captureAiShadowPass(db, { ...options, signals: [{ ...row, exit_ts: time(-60), pnl_usd: -10 }] });
    expect(result).toMatchObject({ ok: true, inserted: 1, rejected: 1 });
    expect(JSON.stringify([...db.records.values()])).toContain("already-closed");
  });
  it("marks missing or future source times as not fresh", async () => {
    const db = client();
    await captureAiShadowPass(db, { ...options, marketAsOf: { MES: observed / 1000 + 30 } });
    expect([...db.records.values()][0][7]).toBe(false);
    const closed = client();
    await captureAiShadowPass(closed, { ...options, signals: [{ ...row, status: "closed" }], marketAsOf: { MES: null } });
    expect([...closed.records.values()][0][7]).toBe(false);
  });
  it("rolls back and returns a failure instead of stopping the source engine", async () => {
    const calls: string[] = [];
    const db = { query: async (sql: string) => { calls.push(sql); if (sql.startsWith("INSERT")) throw new Error("unavailable"); return { rows: [], rowCount: null }; } };
    const result = await captureAiShadowPass(db, options);
    expect(result.ok).toBe(false);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});
