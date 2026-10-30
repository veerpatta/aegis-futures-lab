import { describe, expect, it, vi } from "vitest";
import { formatBudget, requestResearch, requestResearchBudget, requestShadowSummary } from "@/components/bot/AIResearch";

describe("research request", () => {
  it("requires a signed-in token and never sends an empty question", async () => {
    const transport = vi.fn();
    await expect(requestResearch("question", "", transport)).rejects.toThrow(/sign in/i);
    await expect(requestResearch("  ", "token", transport)).rejects.toThrow(/question/i);
    expect(transport).not.toHaveBeenCalled();
  });
  it("sends only the question to the research endpoint and preserves validated references", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answer: "Evidence", citations: [{ id: "study-1", label: "Study" }] }), { status: 200 }));
    const result = await requestResearch("  Why?  ", "token", transport);
    expect(transport).toHaveBeenCalledWith("/api/ai/research", expect.objectContaining({ method: "POST", body: JSON.stringify({ question: "Why?", depth: "standard" }), headers: { "Content-Type": "application/json", Authorization: "Bearer token" } }));
    expect(result.citations).toEqual([{ id: "study-1", label: "Study" }]);
  });
  it("sends deep research only when explicitly selected", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answer: "Evidence", citations: [] }), { status: 200 }));
    await requestResearch("Why?", "token", transport, "deep");
    expect(transport).toHaveBeenCalledWith("/api/ai/research", expect.objectContaining({ body: JSON.stringify({ question: "Why?", depth: "deep" }) }));
  });
  it("does not present an incomplete response as an answer", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(requestResearch("Why?", "token", transport)).rejects.toThrow(/incomplete/);
  });
  it("loads the shared budget only with a session and refuses an incomplete balance", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage: { remainingUsd: 21.5, usedUsd: 3.5, userRequests: 2, dailyLimit: 10, resetAt: "2026-11-01", timezone: "UTC" } }), { status: 200 }));
    await expect(requestResearchBudget("", transport)).rejects.toThrow(/sign in/i);
    expect(transport).not.toHaveBeenCalled();
    expect(await requestResearchBudget("token", transport)).toMatchObject({ remainingUsd: 21.5, usedUsd: 3.5, userRequests: 2, dailyLimit: 10 });
    expect(transport).toHaveBeenCalledWith("/api/ai/research", { method: "GET", headers: { Authorization: "Bearer token" } });
    const incomplete = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage: {} }), { status: 200 }));
    await expect(requestResearchBudget("token", incomplete)).rejects.toThrow(/unavailable/i);
  });
  it("shows the shared spending and the signed-in account's daily request count when provided", () => {
    expect(formatBudget({ remainingUsd: 21.5, usedUsd: 3.5, userRequests: 2, dailyLimit: 10, resetAt: "2026-11-01", timezone: "UTC" })).toContain("used $3.50");
    expect(formatBudget({ remainingUsd: 21.5, usedUsd: 3.5, userRequests: 2, dailyLimit: 10 })).toContain("Your requests today: 2 of 10");
    expect(formatBudget({ remainingUsd: 0 })).not.toContain("requests today");
  });
  it("requires a signed-in session and an interpretable shadow summary", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "available", study: { id: "study", registeredAt: "2026-10-30T00:00:00Z", model: "model", promptVersion: "v1", featureVersion: "v1" }, period: { firstObservedAt: null, lastObservedAt: null }, comparison: { eligible: 0, scored: 0, resolved: 0, abstained: 0, taken: 0, modelNet: 0, takeAllNet: 0, noTradeNet: 0, randomN: 0, randomPercentile: null, deltaPerIdea: null, verdict: "inconclusive" }, rejected: 0, invalidated: 0, cancelled: 0, unresolved: 0, assumptions: { costVersion: "v1", execution: "modeled costs", source: "delayed", seed: "study" } }), { status: 200 }));
    await expect(requestShadowSummary("", transport)).rejects.toThrow(/sign in/i);
    expect(transport).not.toHaveBeenCalled();
    const summary = await requestShadowSummary("token", transport);
    expect(summary.status).toBe("available");
    if (summary.status !== "available") throw new Error("Expected an available summary");
    expect(summary.comparison.verdict).toBe("inconclusive");
    expect(transport).toHaveBeenCalledWith("/api/ai/shadow/summary", { method: "GET", headers: { Authorization: "Bearer token" } });
    const incomplete = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "available" }), { status: 200 }));
    await expect(requestShadowSummary("token", incomplete)).rejects.toThrow(/unavailable/i);
  });
});
