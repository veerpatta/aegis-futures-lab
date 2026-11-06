import { beforeEach, describe, expect, it, vi } from "vitest";
import { chat, FreeAiError, GEMMA_4, isUnavailable, MIN_ATTEMPT_MS, NEMOTRON_ULTRA, resetAvailability } from "@/lib/ai-free/nvidia";

/* Review fixes: the deadline holds across the whole model chain, an empty
   answer is reported as such, and the single-model judge has its own short
   "not found" memory. */

const env = () => ({ NVIDIA_API_KEY: "nvapi-" + "x".repeat(40) });
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

beforeEach(() => resetAvailability());

describe("free AI deadline across the chain", () => {
  it("caps every attempt at the time left and starts none with under 5 s left", async () => {
    let clock = 1_000_000;
    const seen: number[] = [];
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((ms: number) => { seen.push(ms); return realTimeout.call(AbortSignal, ms); }) as typeof AbortSignal.timeout;
    const fetch = vi.fn(async () => { clock += 20_000; return new Response("busy", { status: 502 }); });
    try {
      const err = await chat({ system: "s", user: "u", timeoutMs: 40_000, deadline: 1_000_000 + 45_000 }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env(), now: () => clock }).catch((e) => e);
      expect(err).toBeInstanceOf(FreeAiError);
      // 45 s: the first attempt may use 40 s, the second the 25 s left; then 5 s
      // remain, enough for one more short attempt at most, never a full 40 s.
      expect(seen[0]).toBe(40_000);
      expect(seen[1]).toBe(25_000);
      expect(seen.every((ms) => ms >= MIN_ATTEMPT_MS && ms <= 40_000)).toBe(true);
      expect(clock).toBeLessThanOrEqual(1_000_000 + 45_000 + 20_000);
      expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  it("reports the deadline when no attempt could start", async () => {
    const fetch = vi.fn();
    await expect(chat({ system: "s", user: "u", deadline: 1_000 + 4_000 }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env(), now: () => 1_000 })).rejects.toMatchObject({ code: "deadline" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls an empty or thinking-only answer 'empty', a real but unusable answer", async () => {
    const fetch = vi.fn(async () => ok("<think>only thinking</think>"));
    await expect(chat({ system: "s", user: "u", models: [NEMOTRON_ULTRA] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() })).rejects.toMatchObject({ code: "empty" });
  });
});

describe("scoped 'not found' memory", () => {
  it("keeps the judge's 15-minute memory apart from the chain's six hours", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 404 }));
    const now = () => 5_000_000;
    await chat({ system: "s", user: "u", models: [NEMOTRON_ULTRA], memory: { scope: "judge", ms: 15 * 60_000 } }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env(), now }).catch(() => {});
    expect(isUnavailable(NEMOTRON_ULTRA, 5_000_000 + 60_000, "judge")).toBe(true);
    expect(isUnavailable(NEMOTRON_ULTRA, 5_000_000 + 60_000)).toBe(false);
    expect(isUnavailable(NEMOTRON_ULTRA, 5_000_000 + 16 * 60_000, "judge")).toBe(false);
    await chat({ system: "s", user: "u", models: [GEMMA_4] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env(), now }).catch(() => {});
    expect(isUnavailable(GEMMA_4, 5_000_000 + 60_000, "judge")).toBe(false);
    expect(isUnavailable(GEMMA_4, 5_000_000 + 5 * 3600_000)).toBe(true);
  });
});
