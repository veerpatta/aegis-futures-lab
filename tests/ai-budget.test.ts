import { describe, expect, it, vi } from "vitest";
import { budgetedRequest, worstCaseMicros, actualUsageMicros } from "@/lib/ai-budget";

const now = Date.parse("2026-10-30T00:00:00Z");
const price = { model: "gpt-6.1-sol", inputMicrosPerMillion: 2_000_000, outputMicrosPerMillion: 10_000_000, verifiedAt: now - 1000, expiresAt: now + 86400000 };
const req = { requestId: "req-1", userId: "user-1", model: "gpt-6.1-sol", inputLimit: 50000, outputLimit: 4000, price, now };

describe("OpenAI spending control", () => {
  it("reserves the worst uncached input and output cost using integer microdollars", () => {
    expect(worstCaseMicros(req)).toBe(140000);
    expect(actualUsageMicros({ inputTokens: 100, outputTokens: 50 }, price)).toBe(700);
  });
  it("rejects unknown, expired or malformed prices rather than guessing", () => {
    expect(() => worstCaseMicros({ ...req, model: "other" })).toThrow();
    expect(() => worstCaseMicros({ ...req, price: { ...price, expiresAt: now } })).toThrow();
    expect(() => worstCaseMicros({ ...req, outputLimit: -1 })).toThrow();
  });
  it("does not call OpenAI when reservation is refused", async () => {
    const store = { reserve: vi.fn().mockRejectedValue(new Error("budget exhausted")), settle: vi.fn() };
    const call = vi.fn();
    await expect(budgetedRequest(store, req, call)).rejects.toThrow("budget exhausted");
    expect(call).not.toHaveBeenCalled();
  });
  it("settles confirmed usage once and returns the result", async () => {
    const store = { reserve: vi.fn().mockResolvedValue({ id: "req-1" }), settle: vi.fn().mockResolvedValue(undefined) };
    const result = await budgetedRequest(store, req, async () => ({ value: "ok", usage: { inputTokens: 100, outputTokens: 50 } }));
    expect(result).toBe("ok");
    expect(store.settle).toHaveBeenCalledWith("req-1", 700);
  });
  it("retains the full reservation when a request times out or usage is missing", async () => {
    const store = { reserve: vi.fn().mockImplementation(async ({ id }: { id: string }) => ({ id })), settle: vi.fn() };
    await expect(budgetedRequest(store, req, async () => { throw new Error("timeout"); })).rejects.toThrow("timeout");
    await expect(budgetedRequest(store, { ...req, requestId: "req-2" }, async () => ({ value: "ok", usage: null }))).rejects.toThrow(/usage/i);
    expect(store.settle).not.toHaveBeenCalled();
  });
  it("records a usage overrun but never returns the result as successful", async () => {
    const store = { reserve: vi.fn().mockResolvedValue({ id: "req-1" }), settle: vi.fn().mockResolvedValue(undefined) };
    await expect(budgetedRequest(store, req, async () => ({ value: "ok", usage: { inputTokens: 50001, outputTokens: 4000 } }))).rejects.toThrow(/limit/i);
    expect(store.settle).toHaveBeenCalledWith("req-1", 140002);
  });
});
