import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PAID_AI_OFF_MESSAGE, paidAiAllowed, paidAiKey } from "@/lib/ai-cost/paid-ai";

const mocks = vi.hoisted(() => ({ pool: vi.fn(), verify: vi.fn(), research: vi.fn(), diagnostic: vi.fn(), shadow: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { constructor() { mocks.pool(); } query = vi.fn(async () => ({ rows: [{ ok: 1 }] })); } }));
vi.mock("@/lib/ai-auth/verify", () => ({ verifyNeonResearchUser: mocks.verify }));
vi.mock("@/lib/ai-research/provider", async (o) => ({ ...(await o<typeof import("@/lib/ai-research/provider")>()), callOpenAiResearch: mocks.research }));
vi.mock("@/lib/ai-research/diagnostic", async (o) => ({ ...(await o<typeof import("@/lib/ai-research/diagnostic")>()), callDiagnostic: mocks.diagnostic }));
vi.mock("@/lib/ai-shadow/processor", async (o) => ({ ...(await o<typeof import("@/lib/ai-shadow/processor")>()), shadowOpenAiProvider: mocks.shadow }));

import { POST as research } from "@/app/api/ai/research/route";
import { POST as diagnostic } from "@/app/api/ai/diagnostic/route";
import { GET as shadow } from "@/app/api/ai/shadow/cron/route";

const saved = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AEGIS_ALLOW_PAID_AI;
  // These tests are about PAID AI; a free NVIDIA key (lib/ai-free) in the
  // shell would legitimately open the research route, so none is present here.
  for (const k of Object.keys(process.env)) if (/NVIDIA|NVAPI|KIMI|NGC_API|NIM_API/.test(k) || process.env[k]?.startsWith("nvapi-")) delete process.env[k];
  Object.assign(process.env, { OPENAI_API_SECRET: "sk-test", AI_DATABASE_URL: "postgres://example", AI_SHADOW_ENABLED: "true",
    AI_SHADOW_STUDY_ID: "study", AI_SHADOW_CRON_SECRET: "a".repeat(40) });
  mocks.verify.mockResolvedValue({ ok: true, userId: "owner" });
});
afterEach(() => { process.env = saved; });

describe("zero-cost mode: paid AI is off unless the owner opts in", () => {
  it("hands out the OpenAI key only with the explicit switch", () => {
    expect(paidAiAllowed({})).toBe(false);
    expect(paidAiKey({ OPENAI_API_SECRET: "sk" })).toBeUndefined();
    expect(paidAiKey({ OPENAI_API_SECRET: "sk", AEGIS_ALLOW_PAID_AI: "1" })).toBeUndefined();
    expect(paidAiKey({ OPENAI_API_SECRET: "sk", AEGIS_ALLOW_PAID_AI: "true" })).toBe("sk");
  });

  it("research refuses before recording anything, even with a key configured", async () => {
    const res = await research(new Request("https://aegis.test/api/ai/research", { method: "POST", body: JSON.stringify({ question: "Why?" }) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: PAID_AI_OFF_MESSAGE, paidAi: "off" });
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it("the one-time diagnostic never reaches the provider", async () => {
    const res = await diagnostic(new Request("https://aegis.test/api/ai/diagnostic", { method: "POST" }));
    expect(res.status).toBe(503);
    expect(mocks.diagnostic).not.toHaveBeenCalled();
  });

  it("the shadow study stays off and opens no database connection", async () => {
    const res = await shadow(new Request("http://localhost/api/ai/shadow/cron", { headers: { authorization: `Bearer ${"a".repeat(40)}` } }));
    expect(await res.json()).toEqual({ status: "disabled", paidAi: "off" });
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("no route reads the OpenAI key except through the gate", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    const root = join(__dirname, "..");
    for (const d of ["app", "lib", "components", "scripts"]) walk(join(root, d));
    const readers = files.filter((f) => /process\.env\.OPENAI_API_SECRET/.test(readFileSync(f, "utf8")));
    expect(readers.map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it("the free AI helper never reaches a paid provider", () => {
    const free = ["lib/ai-free/nvidia.ts", "lib/ai-free/research.ts", "lib/ai-judge/runner.ts", "lib/ai-coach/runner.ts", "app/api/ai/run/route.ts"]
      .map((p) => readFileSync(join(__dirname, "..", p), "utf8")).join("\n");
    expect(free).not.toMatch(/api\.openai\.com|api\.anthropic\.com|api\.moonshot|OPENAI_API_SECRET/);
    expect(free).toContain("https://integrate.api.nvidia.com/v1/chat/completions");
  });
});
