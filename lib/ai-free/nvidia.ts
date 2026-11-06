/* Free AI through NVIDIA's API catalog (OpenAI-compatible chat completions).

   Why this exists: the owner has a free NVIDIA key (stored on Vercel) and asked
   for Kimi. On 2026-11-06 the key reached NVIDIA, but Kimi K3.1 Pro was not on
   the API yet (404, playground only) and Kimi K2.6 was "not found for account";
   Nemotron 3 Ultra and Gemma 4 answered. So every caller names a CHAIN of
   models: Kimi first, then the free models that work today. A model that
   answers "not found" is skipped for six hours, so Kimi takes over by itself the
   day NVIDIA switches it on, without a deploy.

   Zero cost: the endpoint is a free trial with rate limits and no billing
   method. NVIDIA's trial terms allow evaluation, not production, and forbid
   handing generated text to others, so callers keep AI words owner-only
   (docs/AI-HELPER.md). AEGIS_FREE_AI=off switches every free AI call off.

   Nothing here logs or returns the key, and errors carry fixed codes only:
   a provider body can contain arbitrary text. */

export const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const FREE_AI_SWITCH = "AEGIS_FREE_AI";
export const FREE_AI_MODELS_ENV = "AEGIS_FREE_AI_MODELS";
export const KIMI_K31_PRO = "moonshotai/kimi-k3.1-pro";
export const KIMI_K26 = "moonshotai/kimi-k2.6";
export const NEMOTRON_ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
export const GEMMA_4 = "google/gemma-4-31b-it";
export const DEFAULT_MODEL_CHAIN: readonly string[] = Object.freeze([KIMI_K31_PRO, KIMI_K26, NEMOTRON_ULTRA, GEMMA_4]);

/** Names an owner is likely to have used for the key on Vercel, in order. */
export const KEY_NAMES: readonly string[] = Object.freeze([
  "NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NIM_API_KEY", "NGC_API_KEY", "KIMI_API_KEY", "NVAPI_KEY", "NVIDIA_KEY",
]);
/** NVIDIA API catalog keys start with this prefix. */
const NVIDIA_KEY_PREFIX = "nvapi-";
/** A model that answered "not found"/"gone" is not asked again for this long. */
export const NOT_FOUND_BACKOFF_MS = 6 * 3600_000;
export const DEFAULT_TIMEOUT_MS = 40_000;
export const DEFAULT_MAX_TOKENS = 1500;

type Env = Record<string, string | undefined>;

export function freeAiEnabled(env: Env = process.env): boolean {
  return (env[FREE_AI_SWITCH] ?? "").trim().toLowerCase() !== "off";
}

/** The key and the NAME of the variable that holds it. The value is for the
    request header only; report the name, never the value. */
export function findFreeAiKey(env: Env = process.env): { key: string; name: string } | null {
  if (!freeAiEnabled(env)) return null;
  for (const name of KEY_NAMES) {
    const value = env[name]?.trim();
    if (value) return { key: value, name };
  }
  // The owner saved the key on Vercel under a name we cannot list from here.
  // NVIDIA keys are recognisable by their prefix, so look for one.
  for (const name of Object.keys(env).sort()) {
    const value = env[name]?.trim();
    if (value && value.startsWith(NVIDIA_KEY_PREFIX) && value.length > NVIDIA_KEY_PREFIX.length + 8) return { key: value, name };
  }
  return null;
}

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,95}$/i;

/** The model chain, optionally overridden by AEGIS_FREE_AI_MODELS (comma list). */
export function modelChain(env: Env = process.env): string[] {
  const raw = env[FREE_AI_MODELS_ENV];
  const listed = raw ? raw.split(",").map((s) => s.trim()).filter((s) => MODEL_ID.test(s)) : [];
  return listed.length ? [...new Set(listed)] : [...DEFAULT_MODEL_CHAIN];
}

export type FreeAiErrorCode =
  | "disabled" | "no-key" | "not-found" | "unauthorized" | "rate-limited" | "busy"
  | "timeout" | "network" | "bad-request" | "bad-response" | "empty" | "all-unavailable";

export class FreeAiError extends Error {
  readonly code: FreeAiErrorCode;
  readonly status: number | null;
  readonly model: string | null;
  constructor(code: FreeAiErrorCode, status: number | null = null, model: string | null = null) {
    const safeStatus = status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    super(`Free AI ${code}${safeStatus ? ` (${safeStatus})` : ""}`);
    this.code = code;
    this.status = safeStatus;
    this.model = model && MODEL_ID.test(model) ? model : null;
  }
}

/* Per-instance memory of models that answered "not found". A serverless
   instance is short-lived, so at worst a cold instance re-asks once: a 404
   costs about 0.2 s and no quota. */
const unavailableUntil = new Map<string, number>();
export function markUnavailable(model: string, now: number): void {
  unavailableUntil.set(model, now + NOT_FOUND_BACKOFF_MS);
}
export function isUnavailable(model: string, now: number): boolean {
  const until = unavailableUntil.get(model);
  if (until === undefined) return false;
  if (until <= now) {
    unavailableUntil.delete(model);
    return false;
  }
  return true;
}
/** Tests only. */
export function resetAvailability(): void {
  unavailableUntil.clear();
  lastAnsweredModel = null;
}

/* The model that answered most recently in this instance, so screens can name
   the model that would answer next rather than the first one in the chain
   (Kimi K3.1 Pro heads the chain but is not on the API yet). */
let lastAnsweredModel: string | null = null;
export function lastAnswered(): string | null {
  return lastAnsweredModel;
}

/** The model the chain would try first right now: the last one that answered,
    else the first not known to be unavailable. */
export function likelyModel(env: Env = process.env, now: number = Date.now()): string | null {
  const chain = modelChain(env);
  if (lastAnsweredModel && chain.includes(lastAnsweredModel) && !isUnavailable(lastAnsweredModel, now)) return lastAnsweredModel;
  return chain.find((m) => !isUnavailable(m, now)) ?? null;
}

/** Remove reasoning that some models put inside the answer text. */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // An unterminated block at the start means the model ran out of room while
  // still thinking: nothing after it is an answer.
  if (/^\s*<think>/i.test(out)) out = "";
  return out.trim();
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse the first JSON object in a model's answer: plain, fenced (```json),
    or wrapped in prose. Null when there is none. */
export function extractJson(text: string): unknown {
  const clean = stripThinking(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(clean)?.[1];
  for (const candidate of [fenced, clean]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      const obj = firstJsonObject(candidate);
      if (obj) {
        try {
          return JSON.parse(obj);
        } catch {
          /* try the next candidate */
        }
      }
    }
  }
  return null;
}

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Ask this chain instead of the configured one. */
  models?: readonly string[];
}
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface ChatAttempt {
  model: string;
  outcome: "ok" | "skipped" | FreeAiErrorCode;
  status: number | null;
  ms: number;
}
export interface ChatResult {
  model: string;
  text: string;
  usage: ChatUsage | null;
  ms: number;
  attempts: ChatAttempt[];
}
export interface FreeAiDeps {
  fetch?: typeof fetch;
  env?: Env;
  now?: () => number;
}

/** Kimi K3.x fixes its own sampling (temperature 1.0, top_p 0.95) and Moonshot
    asks callers to leave both out; other models take the caller's temperature. */
function samplingFor(model: string, temperature: number | undefined): Record<string, number> {
  if (model.startsWith("moonshotai/kimi-k3")) return {};
  return temperature === undefined ? {} : { temperature };
}

/** One request to one model. Throws FreeAiError with a fixed code. */
export async function callModel(model: string, key: string, req: ChatRequest, deps: FreeAiDeps = {}): Promise<{ text: string; usage: ChatUsage | null }> {
  const transport = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await transport(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: false,
        ...samplingFor(model, req.temperature),
      }),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new FreeAiError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", null, model);
  }
  if (!res.ok) {
    // Drain without reading the text into any message.
    await res.body?.cancel().catch(() => {});
    const s = res.status;
    // 403 is model-specific on this catalog (a model the account may not use),
    // like "not found"; 401 means the key itself is refused.
    if (s === 404 || s === 410 || s === 403) throw new FreeAiError("not-found", s, model);
    if (s === 401) throw new FreeAiError("unauthorized", s, model);
    if (s === 429) throw new FreeAiError("rate-limited", s, model);
    if (s === 400 || s === 422) throw new FreeAiError("bad-request", s, model);
    throw new FreeAiError("busy", s, model);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FreeAiError("bad-response", res.status, model);
  }
  const choice = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string" ? stripThinking(content) : "";
  if (!text) throw new FreeAiError("empty", res.status, model);
  const u = (body as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  const usage = u && Number.isSafeInteger(u.prompt_tokens) && Number.isSafeInteger(u.completion_tokens)
    ? { inputTokens: u.prompt_tokens as number, outputTokens: u.completion_tokens as number } : null;
  return { text, usage };
}

/** Ask the chain in order and return the first usable answer.
    - not found/gone: skip that model for six hours, try the next;
    - busy, rate-limited, timeout, empty or a rejected request: try the next;
    - unauthorized: stop (the key itself is refused). */
export async function chat(req: ChatRequest, deps: FreeAiDeps = {}): Promise<ChatResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  if (!freeAiEnabled(env)) throw new FreeAiError("disabled");
  const found = findFreeAiKey(env);
  if (!found) throw new FreeAiError("no-key");
  const models = req.models?.length ? [...req.models] : modelChain(env);
  const attempts: ChatAttempt[] = [];
  const started = now();
  for (const model of models) {
    const t0 = now();
    if (isUnavailable(model, t0)) {
      attempts.push({ model, outcome: "skipped", status: null, ms: 0 });
      continue;
    }
    try {
      const { text, usage } = await callModel(model, found.key, req, deps);
      attempts.push({ model, outcome: "ok", status: 200, ms: now() - t0 });
      lastAnsweredModel = model;
      return { model, text, usage, ms: now() - started, attempts };
    } catch (err) {
      const e = err instanceof FreeAiError ? err : new FreeAiError("network", null, model);
      attempts.push({ model, outcome: e.code, status: e.status, ms: now() - t0 });
      if (e.code === "not-found") markUnavailable(model, now());
      if (e.code === "unauthorized") throw e;
    }
  }
  const error = new FreeAiError("all-unavailable");
  (error as FreeAiError & { attempts?: ChatAttempt[] }).attempts = attempts;
  throw error;
}
