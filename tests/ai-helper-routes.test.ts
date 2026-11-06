import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  oidc: vi.fn(), runJudge: vi.fn(), runCoach: vi.fn(), runIdeas: vi.fn(), scoreboard: vi.fn(), ideasBoard: vi.fn(), calls: vi.fn(), notes: vi.fn(), ownerIdeas: vi.fn(),
  verify: vi.fn(), query: vi.fn(), freeResearch: vi.fn(), reserve: vi.fn(), settle: vi.fn(), status: vi.fn(),
  saveRequest: vi.fn(), saveResult: vi.fn(), evidence: vi.fn(),
}));
vi.mock("pg", () => ({ Pool: class { query = m.query; } }));
vi.mock("@/lib/ai-auth/github-oidc", () => ({ verifyGithubOidc: m.oidc }));
vi.mock("@/lib/ai-auth/verify", () => ({ verifyNeonResearchUser: m.verify }));
vi.mock("@/lib/ai-judge/runner", () => ({ runJudge: m.runJudge }));
vi.mock("@/lib/ai-coach/runner", () => ({ runCoach: m.runCoach }));
vi.mock("@/lib/ai-ideas/runner", () => ({ runIdeas: m.runIdeas }));
vi.mock("@/lib/ai-judge/store-pg", () => ({ PgJudgeStore: class {}, readScoreboard: m.scoreboard, readOwnerCalls: m.calls }));
vi.mock("@/lib/ai-coach/store-pg", () => ({ PgCoachStore: class {}, readOwnerNotes: m.notes }));
vi.mock("@/lib/ai-ideas/store-pg", () => ({ PgIdeasStore: class {}, readIdeasScoreboard: m.ideasBoard, readOwnerIdeas: m.ownerIdeas }));
vi.mock("@/lib/ai-free/research", async (o) => ({ ...(await o<typeof import("@/lib/ai-free/research")>()), callFreeResearch: m.freeResearch }));
vi.mock("@/lib/ai-budget/pg", () => ({ PgBudgetStore: class { reserve = m.reserve; settle = m.settle; status = m.status; } }));
vi.mock("@/lib/ai-store/research", () => ({ ResearchStore: class { saveRequest = m.saveRequest; saveResult = m.saveResult; } }));
vi.mock("@/lib/ai-research/evidence", () => ({ loadResearchEvidence: m.evidence }));

import { POST as run } from "@/app/api/ai/run/route";
import { GET as scoreboard } from "@/app/api/ai/scoreboard/route";
import { GET as owner } from "@/app/api/ai/owner/route";
import { GET as status } from "@/app/api/ai/status/route";
import { GET as researchUsage, POST as research } from "@/app/api/ai/research/route";
import { resetAvailability } from "@/lib/ai-free/nvidia";

const KEY = "nvapi-" + "s".repeat(40);
const saved = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  resetAvailability();
  for (const k of Object.keys(process.env)) if (/NVIDIA|NVAPI|KIMI|NGC|NIM_|AEGIS_|AI_DATABASE_URL|OPENAI/.test(k) || process.env[k]?.startsWith("nvapi-")) delete process.env[k];
  m.oidc.mockResolvedValue({ ok: true, runId: "1", event: "workflow_dispatch" });
  m.runJudge.mockResolvedValue({ decided: 1, invalid: 0, errors: 0, skipped: [], activated: [], probes: [], looks: [] });
  m.runCoach.mockResolvedValue({ tradeNotes: 1, dayNotes: 0, rejected: 0, errors: 0 });
  m.runIdeas.mockResolvedValue({ retired: [], looks: [], proposed: 0, rejected: 0, summary: null, waiting: "too-few-finished", errors: 0 });
  m.verify.mockResolvedValue({ ok: true, userId: "owner" });
  m.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
});
afterEach(() => { process.env = { ...saved }; vi.useRealTimers(); });

describe("POST /api/ai/run (GitHub OIDC only)", () => {
  const post = () => run(new Request("https://aegis.test/api/ai/run", { method: "POST", headers: { authorization: "Bearer x" } }));

  it("refuses without a valid GitHub token and does no work", async () => {
    m.oidc.mockResolvedValueOnce({ ok: false, status: 401, error: "Unauthorized" });
    Object.assign(process.env, { NVIDIA_API_KEY: KEY, AI_DATABASE_URL: "postgres://x" });
    expect((await post()).status).toBe(401);
    expect(m.runJudge).not.toHaveBeenCalled();
  });

  it("says plainly when the key or the database is missing, or the helper is off", async () => {
    expect(await (await post()).json()).toEqual({ status: "no-key" });
    process.env.NVIDIA_API_KEY = KEY;
    expect(await (await post()).json()).toEqual({ status: "no-database" });
    process.env.AEGIS_FREE_AI = "off";
    expect(await (await post()).json()).toEqual({ status: "disabled" });
  });

  it("runs the second opinion, the coach, then the ideas, and returns counts only", async () => {
    Object.assign(process.env, { NVIDIA_API_KEY: KEY, AI_DATABASE_URL: "postgres://x" });
    const res = await post();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", keyName: "NVIDIA_API_KEY", judge: { decided: 1 }, coach: { tradeNotes: 1 }, ideas: { waiting: "too-few-finished" } });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(m.runJudge.mock.invocationCallOrder[0]).toBeLessThan(m.runCoach.mock.invocationCallOrder[0]);
    expect(m.runCoach.mock.invocationCallOrder[0]).toBeLessThan(m.runIdeas.mock.invocationCallOrder[0]);
  });

  it("starts the clock before verifying the token (review fix 3)", async () => {
    Object.assign(process.env, { NVIDIA_API_KEY: KEY, AI_DATABASE_URL: "postgres://x" });
    vi.useFakeTimers();
    const start = Date.parse("2026-11-09T15:00:00Z");
    vi.setSystemTime(start);
    // A slow JWKS fetch takes 12 s of the function's 60.
    m.oidc.mockImplementationOnce(async () => { vi.setSystemTime(start + 12_000); return { ok: true, runId: "1", event: "schedule" }; });
    await post();
    expect(m.runJudge.mock.calls[0][1]).toMatchObject({ deadline: start + 40_000, hardStop: start + 55_000 });
  });
});

describe("public AI routes carry numbers and names, never text or keys", () => {
  it("scoreboard: edge-cached, unavailable without a database", async () => {
    const res = await scoreboard();
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(await res.json()).toMatchObject({ available: false, studies: [], ideas: [] });
  });

  it("scoreboard: exactly the documented fields for studies and ideas", async () => {
    process.env.AI_DATABASE_URL = "postgres://x";
    m.scoreboard.mockResolvedValueOnce([{ id: "ai-judge-nemotron-ultra-v1", label: "Nemotron 3 Ultra", model: "nvidia/nemotron-3-ultra-550b-a55b", status: "active", startedAt: "2026-11-07T00:00:00.000Z",
      calls: 2, resolved: 1, taken: 1, skipped: 1, sessions: 1, aiNet: -10, takeAllNet: -20, randomPercentile: 60, delta: null, verdict: "too-early", nextLook: 60, waiting: "Look 1: 1 of 60 resolved over 1 of 15 sessions.", extra: "dropped" }]);
    m.ideasBoard.mockResolvedValueOnce([{ id: "idea-aaaaaaaaaaaa", proposedAt: "2026-11-16T15:00:00.000Z", model: "m", status: "testing", tested: 3, resolved: 2, skipped: 1, sessions: 1,
      keptNet: 50, takeAllNet: -250, delta: null, randomPercentile: null, verdict: "too-early", nextLook: 60, waiting: "Look 1: …", rule: "never public" }]);
    const body = await (await scoreboard()).json();
    expect(Object.keys(body.studies[0]).sort()).toEqual(["aiNet", "calls", "delta", "id", "label", "model", "nextLook", "randomPercentile", "resolved", "sessions", "skipped", "startedAt", "status", "takeAllNet", "taken", "verdict", "waiting"]);
    expect(Object.keys(body.ideas[0]).sort()).toEqual(["delta", "id", "keptNet", "model", "nextLook", "proposedAt", "randomPercentile", "resolved", "sessions", "skipped", "status", "takeAllNet", "tested", "verdict", "waiting"]);
    expect(JSON.stringify(body)).not.toContain("never public");
  });

  it("status: names the key's variable, never its value, without calling a model", async () => {
    process.env.MY_SAVED_KEY = KEY;
    const body = await (await status()).json();
    expect(body).toMatchObject({ freeAi: "on", keyFound: true, keyName: "MY_SAVED_KEY", database: false });
    expect(body.models[0]).toBe("moonshotai/kimi-k3.1-pro");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});

describe("GET /api/ai/owner (owner only)", () => {
  const get = () => owner(new Request("https://aegis.test/api/ai/owner", { headers: { authorization: "Bearer t" } }));

  it("refuses a visitor who is not the owner", async () => {
    process.env.AI_DATABASE_URL = "postgres://x";
    m.query.mockResolvedValueOnce({ rows: [] });
    expect((await get()).status).toBe(401);
    expect(m.calls).not.toHaveBeenCalled();
  });

  it("gives the owner the AI's calls, accepted notes and the ideas' own words", async () => {
    process.env.AI_DATABASE_URL = "postgres://x";
    m.calls.mockResolvedValueOnce([{ decisionKey: "d1", studyId: "s", model: "m", decision: "skip", confidence: 80, reason: "r", calledAt: "t" }]);
    m.notes.mockResolvedValueOnce([{ kind: "week", subject: "2026-W46", text: "Summary.", model: "m", createdAt: "t" }]);
    m.ownerIdeas.mockResolvedValueOnce([{ id: "idea-aaaaaaaaaaaa", name: "Skip shorts", why: "w", when: [{ field: "side", op: "=", value: "SHORT" }], proposedAt: "t", model: "m" }]);
    const res = await get();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ calls: [expect.objectContaining({ decision: "skip" })], notes: [expect.objectContaining({ kind: "week" })], ideas: [expect.objectContaining({ name: "Skip shorts" })] });
  });
});

describe("research on the free provider", () => {
  beforeEach(() => {
    Object.assign(process.env, { NVIDIA_API_KEY: KEY, AI_DATABASE_URL: "postgres://x" });
    m.evidence.mockResolvedValue([{ id: "run:1", label: "Run", text: "ok" }]);
    m.reserve.mockImplementation(async (r: { id: string }) => ({ id: r.id }));
    m.status.mockResolvedValue({ month: "2026-11", usedMicros: 0, remainingMicros: 25_000_000, userRequests: 1, dailyLimit: 10 });
    m.saveRequest.mockResolvedValue(true);
    m.saveResult.mockResolvedValue(true);
    m.freeResearch.mockResolvedValue({ value: { answer: "Paused after losses.", citations: [{ id: "run:1", label: "Run" }] }, model: "nvidia/nemotron-3-ultra-550b-a55b" });
  });
  const ask = () => research(new Request("https://aegis.test/api/ai/research", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ question: "Why paused?" }) }));

  it("answers for free when paid AI is off: a one-microdollar placeholder settled at 0", async () => {
    const res = await ask();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.answer).toBe("Paused after losses.");
    expect(body.usage).toMatchObject({ provider: "free", usedUsd: 0 });
    expect(m.reserve).toHaveBeenCalledWith(expect.objectContaining({ model: "nvidia-free", reservedMicros: 1 }));
    expect(m.settle).toHaveBeenCalledWith(expect.any(String), 0);
    expect(m.saveRequest).toHaveBeenCalledWith(expect.objectContaining({ model: "nvidia-free", promptVersion: "research-free-2026-11-07-v1" }));
  });

  it("bounds the free answer by the request's own clock and records a timeout as a failure (review fix 3)", async () => {
    vi.useFakeTimers();
    const start = Date.parse("2026-11-09T15:00:00Z");
    vi.setSystemTime(start);
    await ask();
    expect(m.freeResearch.mock.calls[0][0]).toMatchObject({ deadline: start + 50_000 });
    vi.useRealTimers();
    const { FreeAiError } = await import("@/lib/ai-free/nvidia");
    m.freeResearch.mockRejectedValueOnce(new FreeAiError("deadline"));
    const res = await ask();
    expect(res.status).toBe(503);
    expect(m.saveResult).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error" }));
  });

  it("reports provider and model in the usage the Ask panel reads", async () => {
    const body = await (await researchUsage(new Request("https://aegis.test/api/ai/research", { headers: { authorization: "Bearer t" } }))).json();
    expect(body.usage).toMatchObject({ provider: "free", model: "moonshotai/kimi-k3.1-pro" });
    delete process.env.NVIDIA_API_KEY;
    expect((await (await researchUsage(new Request("https://aegis.test/api/ai/research", { headers: { authorization: "Bearer t" } }))).json()).usage).toMatchObject({ provider: "off", model: null });
  });

  it("stays refused with neither paid AI nor a free key", async () => {
    delete process.env.NVIDIA_API_KEY;
    expect((await ask()).status).toBe(403);
    expect(m.freeResearch).not.toHaveBeenCalled();
  });
});
