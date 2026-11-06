import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chat, DEFAULT_MODEL_CHAIN, extractJson, findFreeAiKey, FreeAiError, freeAiEnabled, GEMMA_4, isUnavailable, KIMI_K26, KIMI_K31_PRO,
  lastAnswered, likelyModel, modelChain, NEMOTRON_ULTRA, NOT_FOUND_BACKOFF_MS, resetAvailability, stripThinking,
} from "@/lib/ai-free/nvidia";

const KEY = "nvapi-" + "x".repeat(40);
const env = (extra: Record<string, string> = {}) => ({ NVIDIA_API_KEY: KEY, ...extra });
const ok = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content, ...extra } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

beforeEach(() => resetAvailability());

describe("free AI key discovery", () => {
  it("prefers the named variables, in order, and reports the name only", () => {
    expect(findFreeAiKey({ NGC_API_KEY: "nvapi-bbbbbbbbbbbbbbbb", NVIDIA_API_KEY: "nvapi-aaaaaaaaaaaaaaaa" })).toEqual({ key: "nvapi-aaaaaaaaaaaaaaaa", name: "NVIDIA_API_KEY" });
    expect(findFreeAiKey({ KIMI_API_KEY: "proxy-injected" })).toEqual({ key: "proxy-injected", name: "KIMI_API_KEY" });
  });
  it("finds a key saved under any name by its nvapi- prefix", () => {
    expect(findFreeAiKey({ SOMETHING_ELSE: "x", MY_KIMI: "nvapi-" + "k".repeat(30) })).toEqual({ key: "nvapi-" + "k".repeat(30), name: "MY_KIMI" });
    expect(findFreeAiKey({ SHORT: "nvapi-x" })).toBeNull();
    expect(findFreeAiKey({})).toBeNull();
  });
  it("AEGIS_FREE_AI=off switches everything off", () => {
    expect(freeAiEnabled({ AEGIS_FREE_AI: "OFF" })).toBe(false);
    expect(findFreeAiKey(env({ AEGIS_FREE_AI: "off" }))).toBeNull();
    expect(freeAiEnabled({})).toBe(true);
  });
});

describe("model chain", () => {
  it("asks Kimi first, then the free models that work today", () => {
    expect(modelChain({})).toEqual([KIMI_K31_PRO, KIMI_K26, NEMOTRON_ULTRA, GEMMA_4]);
    expect(DEFAULT_MODEL_CHAIN[0]).toBe("moonshotai/kimi-k3.1-pro");
  });
  it("accepts a clean override and ignores junk", () => {
    expect(modelChain({ AEGIS_FREE_AI_MODELS: " google/gemma-4-31b-it, bad model ,google/gemma-4-31b-it" })).toEqual([GEMMA_4]);
    expect(modelChain({ AEGIS_FREE_AI_MODELS: "nonsense" })).toEqual([...DEFAULT_MODEL_CHAIN]);
  });
});

describe("answer parsing", () => {
  it("strips reasoning blocks and treats an unfinished one as no answer", () => {
    expect(stripThinking("<think>hmm</think> Hello")).toBe("Hello");
    expect(stripThinking("<think>still thinking")).toBe("");
  });
  it("extracts JSON from plain, fenced and wrapped answers", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here it is: {"a":"x}y","b":{"c":3}} Thanks.')).toEqual({ a: "x}y", b: { c: 3 } });
    expect(extractJson("<think>{\"a\":9}</think>{\"a\":4}")).toEqual({ a: 4 });
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("chat over the chain", () => {
  it("skips a model that is not found, remembers it, and answers with the next", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      calls.push(model);
      if (model.startsWith("moonshotai/")) return new Response("Function 'x': Not found for account 'secret-account'", { status: 404 });
      return ok("ready");
    });
    const now = () => 1_000_000;
    const first = await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env(), now });
    expect(first.model).toBe(NEMOTRON_ULTRA);
    expect(first.text).toBe("ready");
    expect(first.attempts.map((a) => a.outcome)).toEqual(["not-found", "not-found", "ok"]);
    calls.length = 0;
    await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env(), now });
    expect(calls).toEqual([NEMOTRON_ULTRA]);
    expect(lastAnswered()).toBe(NEMOTRON_ULTRA);
    expect(likelyModel(env(), 1_000_000)).toBe(NEMOTRON_ULTRA);
    // Six hours later Kimi is asked again (it may have been switched on).
    expect(isUnavailable(KIMI_K31_PRO, 1_000_000 + NOT_FOUND_BACKOFF_MS - 1)).toBe(true);
    expect(isUnavailable(KIMI_K31_PRO, 1_000_000 + NOT_FOUND_BACKOFF_MS + 1)).toBe(false);
  });

  it("falls through busy, rate-limited and empty answers, and reads only message content", async () => {
    const replies = [new Response("busy", { status: 502 }), new Response("", { status: 429 }), ok("   ", { reasoning_content: "long thoughts" }), ok("final", { reasoning_content: "ignored" })];
    const fetch = vi.fn(async () => replies.shift()!);
    const r = await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() });
    expect(r.text).toBe("final");
    expect(r.model).toBe(GEMMA_4);
    expect(r.attempts.map((a) => a.outcome)).toEqual(["busy", "rate-limited", "empty", "ok"]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("stops at once when the key itself is refused", async () => {
    const fetch = vi.fn(async () => new Response("bad key details", { status: 401 }));
    const err = await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() }).catch((e) => e);
    expect(err).toBeInstanceOf(FreeAiError);
    expect(err.code).toBe("unauthorized");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never puts provider text or the key in an error", async () => {
    const fetch = vi.fn(async () => new Response("Function 'abc': Not found for account 'secret-account'", { status: 404 }));
    const err = await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() }).catch((e) => e);
    expect(err.code).toBe("all-unavailable");
    expect(String(err.message)).not.toMatch(/secret|Function|nvapi/);
  });

  it("sends the key only in the Authorization header and leaves Kimi K3's sampling alone", async () => {
    const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      seen.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return ok("x");
    });
    await chat({ system: "s", user: "u", temperature: 0.3, models: [KIMI_K31_PRO] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() });
    await chat({ system: "s", user: "u", temperature: 0.3, models: [GEMMA_4] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() });
    expect(seen[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(seen[0].body)).not.toContain(KEY);
    expect(seen[0].body.temperature).toBeUndefined();
    expect(seen[1].body.temperature).toBe(0.3);
  });

  it("refuses without a key or when switched off", async () => {
    await expect(chat({ system: "s", user: "u" }, { env: {} })).rejects.toMatchObject({ code: "no-key" });
    await expect(chat({ system: "s", user: "u" }, { env: env({ AEGIS_FREE_AI: "off" }) })).rejects.toMatchObject({ code: "disabled" });
  });
});
