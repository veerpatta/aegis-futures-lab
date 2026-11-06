import { afterEach, describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { constructor(c: unknown) { pg.config(c); } query = vi.fn(); } }));

import { validateNote } from "@/lib/ai-coach/validate";
import { runCoach, type CoachStore } from "@/lib/ai-coach/runner";
import { aiPool, AI_QUERY_TIMEOUT_MS } from "@/lib/ai-free/pool";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("coach: week notes and save handling", () => {
  it("accepts a week summary that compares values and needs no 'virtual' label, still checking numbers", () => {
    const facts = { overall: { finished_ideas: 24, wins: 8 }, by_field: { rr: [{ bucket: "rr < 1.5", n: 10, net_per_idea_usd: -40 }] } };
    expect(validateNote("Of the 24 finished ideas, 8 won. Ideas with rr < 1.5 lost $40 per idea over 10 ideas.", facts, "week")).toEqual({ ok: true });
    expect(validateNote("Of the 24 finished ideas, 8 won. Ideas with rr < 1.5 lost $55 per idea over 10 ideas.", facts, "week")).toMatchObject({ ok: false, reason: "unsupported-number" });
    expect(validateNote("Of the 24 finished ideas, 8 won, so you should buy more of them next week, honestly.", facts, "week")).toMatchObject({ ok: false, reason: "advice" });
  });

  it("stops the pass when a note cannot be saved, without counting a provider error (review fix 5)", async () => {
    const store: CoachStore = {
      activeExperiment: async () => "learner-3",
      finishedTrades: async () => [],
      day: async () => ({ dayKey: "2026-11-06", decided: 1, taken: 1, skipped: 0, closed: 1, wins: 0, losses: 1, resultUsd: -111.89, open: 0, balanceUsd: 9888.11, sp500ChangePct: 0.72, nasdaqChangePct: 1.51 }),
      latestDayNote: async () => null,
      save: async () => { throw new Error("database down"); },
    };
    const chat = vi.fn(async () => ({ model: "m", text: "A virtual recap: 1 trade lost $111.89 and the virtual balance is $9,888.11.", usage: null, ms: 1, attempts: [] }));
    await expect(runCoach({ store, chat, now: () => Date.parse("2026-11-06T16:00:00Z") }, { deadline: Date.parse("2026-11-06T16:00:40Z"), calls: 4 })).rejects.toThrow("database down");
  });
});

describe("AI database pool", () => {
  it("caps every query on the client; the server cap is set on the AI login role", () => {
    process.env.AI_DATABASE_URL = "postgres://ai@example/neondb";
    aiPool();
    expect(pg.config).toHaveBeenCalledWith(expect.objectContaining({ query_timeout: AI_QUERY_TIMEOUT_MS }));
    expect(AI_QUERY_TIMEOUT_MS).toBe(10_000);
    expect(pg.config.mock.calls[0][0]).not.toHaveProperty("statement_timeout");
  });
});
