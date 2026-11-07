import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HealthBook, healthSignal, isUsable, nextRow, PgHealthStore, REST_BASE_MS, REST_MAX_MS, restMs, SLOW_TIMEOUT_MS,
  type HealthRow, type HealthStore,
} from "@/lib/ai-free/health";
import { chat, DEEPSEEK_V41_FLASH, GEMMA_4, KIMI_K26, KIMI_K31_PRO, NEMOTRON_ULTRA, resetAvailability, type ChatAttempt } from "@/lib/ai-free/nvidia";

/* The shared record of which free models answer (lib/ai-free/health.ts):
   a slow failure must not eat every pass, and DeepSeek V4.1 Flash, whose
   requests failed after ~30 s on 2026-11-06, is asked by no chain until it
   has answered once. */

const KEY = "nvapi-" + "h".repeat(40);
const env = { NVIDIA_API_KEY: KEY };
const T0 = Date.parse("2026-11-09T15:00:00Z");
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const attempt = (model: string, outcome: ChatAttempt["outcome"], ms = 500): ChatAttempt => ({ model, outcome, status: null, ms });

/** In-memory store with the database's semantics. */
function memStore(seed: Record<string, HealthRow> = {}) {
  const rows = new Map(Object.entries(seed));
  const saves: [string, string, string][] = [];
  const store: HealthStore = {
    load: async () => new Map(rows),
    save: async (model, signal, code, at) => {
      saves.push([model, signal, code]);
      const next = nextRow(rows.get(model), signal, code, at);
      rows.set(model, next);
      return next;
    },
  };
  return { store, rows, saves };
}

beforeEach(() => resetAvailability());

describe("what an attempt says about a model", () => {
  it("counts an answer (even an empty one) as up, and only real failures as down", () => {
    expect(healthSignal(attempt("m/a", "ok"))).toBe("ok");
    expect(healthSignal(attempt("m/a", "empty"))).toBe("ok");
    for (const code of ["not-found", "busy", "network", "rate-limited", "bad-response"] as const) expect(healthSignal(attempt("m/a", code))).toBe("fail");
    // Our key, our request, the deadline or a skip say nothing about the model.
    for (const code of ["unauthorized", "bad-request", "deadline", "skipped"] as const) expect(healthSignal(attempt("m/a", code))).toBeNull();
  });

  it("counts a timeout only when the attempt had time: a call cut short by the end of a pass is not the model's fault", () => {
    expect(healthSignal(attempt("m/a", "timeout", SLOW_TIMEOUT_MS - 1))).toBeNull();
    expect(healthSignal(attempt("m/a", "timeout", 20_000))).toBe("fail");
  });
});

describe("resting and probation", () => {
  it("rests 15 minutes after one failure, doubling per failure in a row, at most six hours", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 30].map(restMs)).toEqual([0, REST_BASE_MS, 2 * REST_BASE_MS, 4 * REST_BASE_MS, 8 * REST_BASE_MS, 16 * REST_BASE_MS, REST_MAX_MS, REST_MAX_MS]);
    expect(REST_BASE_MS).toBe(15 * 60_000);
    expect(REST_MAX_MS).toBe(6 * 3600_000);
    const row = nextRow(nextRow(undefined, "fail", "busy", T0), "fail", "busy", T0 + 1000);
    expect(row).toMatchObject({ fails: 2, failAt: T0 + 1000, code: "busy", okAt: null });
    expect(isUsable(NEMOTRON_ULTRA, row, T0 + 1000 + 2 * REST_BASE_MS - 1)).toBe(false);
    expect(isUsable(NEMOTRON_ULTRA, row, T0 + 1000 + 2 * REST_BASE_MS)).toBe(true);
    // One answer clears it.
    expect(isUsable(NEMOTRON_ULTRA, nextRow(row, "ok", "ok", T0 + 5000), T0 + 5000)).toBe(true);
  });

  it("asks every model with no record, except DeepSeek until it has answered once", () => {
    expect(isUsable(GEMMA_4, undefined, T0)).toBe(true);
    expect(isUsable(DEEPSEEK_V41_FLASH, undefined, T0)).toBe(false);
    expect(isUsable(DEEPSEEK_V41_FLASH, nextRow(undefined, "fail", "timeout", T0), T0 + REST_MAX_MS)).toBe(false);
    expect(isUsable(DEEPSEEK_V41_FLASH, nextRow(undefined, "ok", "ok", T0), T0)).toBe(true);
  });
});

describe("the chain with the health record", () => {
  it("never asks DeepSeek before it has answered, then asks it first after Kimi once it has", async () => {
    const asked: string[] = [];
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      asked.push(model);
      return model.startsWith("moonshotai/") ? new Response("", { status: 404 }) : ok("fine");
    });
    const { store } = memStore();
    const book = await HealthBook.open(store);
    const first = await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => T0, health: book });
    expect(first.model).toBe(NEMOTRON_ULTRA);
    expect(asked).toEqual([KIMI_K31_PRO, KIMI_K26, NEMOTRON_ULTRA]);
    // The waiting study's probe is the check: it asks DeepSeek, which answers.
    asked.length = 0;
    await chat({ system: "s", user: "u", models: [DEEPSEEK_V41_FLASH], healthCheck: true }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => T0, health: book });
    expect(asked).toEqual([DEEPSEEK_V41_FLASH]);
    // From then on the chain uses it (the Kimi models rest after their 404s).
    asked.length = 0;
    const later = await chat({ system: "s", user: "u" }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => T0 + 60_000, health: book });
    expect(later.model).toBe(DEEPSEEK_V41_FLASH);
    expect(asked).toEqual([DEEPSEEK_V41_FLASH]);
  });

  it("rests a model after a slow failure, so the next call goes straight to the next model", async () => {
    let clock = T0;
    const asked: string[] = [];
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      asked.push(model);
      if (model === DEEPSEEK_V41_FLASH) { clock += 30_500; return new Response("upstream request failed", { status: 502 }); }
      return ok("fine");
    });
    const { store, rows } = memStore({ [DEEPSEEK_V41_FLASH]: { okAt: T0 - 3600_000, failAt: null, fails: 0, code: null } });
    const book = await HealthBook.open(store);
    const models = [DEEPSEEK_V41_FLASH, GEMMA_4];
    const r1 = await chat({ system: "s", user: "u", models }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => clock, health: book });
    expect(r1.model).toBe(GEMMA_4);
    expect(rows.get(DEEPSEEK_V41_FLASH)).toMatchObject({ fails: 1, code: "busy" });
    asked.length = 0;
    await chat({ system: "s", user: "u", models }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => clock, health: book });
    expect(asked).toEqual([GEMMA_4]);
    // After its rest it is tried once more (it may be back).
    clock += REST_BASE_MS;
    asked.length = 0;
    await chat({ system: "s", user: "u", models }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => clock, health: book });
    expect(asked).toEqual([DEEPSEEK_V41_FLASH, GEMMA_4]);
    expect(rows.get(DEEPSEEK_V41_FLASH)?.fails).toBe(2);
  });

  it("keeps DeepSeek out when the record cannot be read, and never lets a failed save break an answer", async () => {
    const fetch = vi.fn(async () => ok("fine"));
    const broken: HealthStore = { load: async () => { throw new Error("db down"); }, save: async () => { throw new Error("db down"); } };
    const book = await HealthBook.open(broken);
    expect(book.usable(DEEPSEEK_V41_FLASH, T0)).toBe(false);
    expect(book.usable(GEMMA_4, T0)).toBe(true);
    const r = await chat({ system: "s", user: "u", models: [DEEPSEEK_V41_FLASH, GEMMA_4] }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => T0, health: book });
    expect(r.model).toBe(GEMMA_4);
    const saving: HealthStore = { load: async () => new Map(), save: async () => { throw new Error("db down"); } };
    const r2 = await chat({ system: "s", user: "u", models: [GEMMA_4] }, { fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => T0, health: await HealthBook.open(saving) });
    expect(r2.text).toBe("fine");
  });

  it("lists the models resting now, for the pass report", async () => {
    const { store } = memStore({ [NEMOTRON_ULTRA]: { okAt: null, failAt: T0, fails: 1, code: "busy" } });
    const book = await HealthBook.open(store);
    expect(book.resting([KIMI_K31_PRO, DEEPSEEK_V41_FLASH, NEMOTRON_ULTRA, GEMMA_4], T0 + 1000)).toEqual([DEEPSEEK_V41_FLASH, NEMOTRON_ULTRA]);
  });
});

describe("PgHealthStore", () => {
  it("reads only well-formed rows and records each signal in one atomic upsert", async () => {
    const queries: { sql: string; values?: unknown[] }[] = [];
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT")) return { rows: [
          { model: GEMMA_4, ok_ms: String(T0), fail_ms: null, fails: 0, fail_code: null },
          { model: "not a model", ok_ms: null, fail_ms: null, fails: 0, fail_code: null },
          { model: NEMOTRON_ULTRA, ok_ms: null, fail_ms: T0, fails: -1, fail_code: "busy" },
        ] };
        return { rows: [{ ok_ms: null, fail_ms: String(T0), fails: 3, fail_code: "busy" }] };
      }),
    };
    const store = new PgHealthStore(db);
    const loaded = await store.load();
    expect([...loaded.keys()]).toEqual([GEMMA_4]);
    expect(loaded.get(GEMMA_4)).toEqual({ okAt: T0, failAt: null, fails: 0, code: null });
    expect(await store.save(DEEPSEEK_V41_FLASH, "fail", "busy", T0)).toEqual({ okAt: null, failAt: T0, fails: 3, code: "busy" });
    const upsert = queries[1];
    expect(upsert.sql).toMatch(/INSERT INTO public\.ai_model_health AS h/);
    expect(upsert.sql).toMatch(/ON CONFLICT \(model\) DO UPDATE/);
    expect(upsert.sql).toMatch(/least\(h\.fails \+ 1, 1000\)/);
    expect(upsert.values).toEqual([DEEPSEEK_V41_FLASH, false, new Date(T0).toISOString(), "busy"]);
  });
});
