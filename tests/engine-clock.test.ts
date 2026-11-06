import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import {
  CLOCK_TRIGGERS, CLOCK_WORKFLOWS, LOG_SQL, READ_TOKEN_SQL, dispatchRequest, handleClock, type ClockDeps,
} from "@/lib/clock/handler";
import { neonSql, sqlEndpoint, type SqlRow } from "@/lib/clock/neon-http";
import { TOKEN_PATTERN, syncAction } from "@/lib/clock/token";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const KEY = "github_pat_" + "A".repeat(82);
const NOW = Date.parse("2026-11-06T14:21:30Z");

function delivery(name = "aegisclock-engine-day", scheduledAt = "2026-11-06T14:21:00Z", id = "inv-1") {
  return new Request("https://clock.example/engine", {
    method: "POST",
    headers: { "content-type": "application/json", "x-neon-trigger-invocation-id": id },
    body: JSON.stringify({ version: 1, invocation_id: id, trigger: { type: "schedule", id: "trigger-1", name }, data: { scheduled_at: scheduledAt } }),
  });
}

function deps(opts: { token?: string | null; github?: Response | Error; sqlFails?: boolean } = {}) {
  const calls: { query: string; params: unknown[] }[] = [];
  const sql = vi.fn(async (query: string, params: unknown[] = []): Promise<SqlRow[]> => {
    calls.push({ query, params });
    if (opts.sqlFails) throw new Error("database HTTP 503");
    if (query === READ_TOKEN_SQL) return opts.token === undefined ? [[KEY]] : opts.token === null ? [] : [[opts.token]];
    return [];
  });
  const fetch = vi.fn(async () => {
    if (opts.github instanceof Error) throw opts.github;
    return opts.github ?? new Response(null, { status: 204 });
  });
  const d: ClockDeps = { sql, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW };
  const logged = () => calls.filter((c) => c.query === LOG_SQL).map((c) => ({ outcome: c.params[4], status: c.params[5], message: String(c.params[6]) }));
  return { d, sql, fetch, calls, logged };
}

describe("engine clock: SQL over HTTP", () => {
  it("uses the driver's endpoint: api.<region host>/sql", () => {
    expect(sqlEndpoint("postgresql://u:p@ep-twilight-recipe-b3apaham-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"))
      .toBe("https://api.c-4.ap-southeast-1.aws.neon.tech/sql");
  });

  it("sends the connection string as a header and returns array rows", async () => {
    const conn = "postgresql://u:p@ep-x-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb";
    const transport = vi.fn(async () => new Response(JSON.stringify({ rows: [["a", null]] }), { status: 200 }));
    const rows = await neonSql(conn, transport as unknown as typeof fetch)("SELECT $1", [1]);
    expect(rows).toEqual([["a", null]]);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.c-4.ap-southeast-1.aws.neon.tech/sql");
    const headers = init.headers as Record<string, string>;
    expect(headers["Neon-Connection-String"]).toBe(conn);
    expect(headers["Neon-Array-Mode"]).toBe("true");
    expect(JSON.parse(String(init.body))).toEqual({ query: "SELECT $1", params: [1] });
  });

  it("never echoes the connection string in an error", async () => {
    const conn = "postgresql://u:secret-password@ep-x.c-4.ap-southeast-1.aws.neon.tech/neondb";
    const transport = vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    await expect(neonSql(conn, transport as unknown as typeof fetch)("SELECT 1")).rejects.toThrow(/^database HTTP 500: boom$/);
  });
});

describe("engine clock: handler", () => {
  it("starts the engine workflow on main with the stored key", async () => {
    const { d, fetch, logged } = deps();
    const res = await handleClock(delivery(), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "dispatched", route: "engine" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/veerpatta/aegis-futures-lab/actions/workflows/signal-engine.yml/dispatches");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main" });
    expect(logged()).toEqual([{ outcome: "dispatched", status: 204, message: "Started signal-engine.yml." }]);
  });

  it("starts learn and review through the fallback workflow's job input", () => {
    expect(JSON.parse(String(dispatchRequest("learn", KEY).init.body))).toEqual({ ref: "main", inputs: { job: "learn" } });
    expect(JSON.parse(String(dispatchRequest("review", KEY).init.body))).toEqual({ ref: "main", inputs: { job: "review" } });
    expect(dispatchRequest("review", KEY).url).toContain("/actions/workflows/experiment-fallback.yml/dispatches");
  });

  it("is a logged no-op without a key, and never writes the key to the log", async () => {
    const none = deps({ token: null });
    expect(await (await handleClock(delivery(), none.d)).json()).toEqual({ outcome: "not-configured" });
    expect(none.fetch).not.toHaveBeenCalled();
    expect(none.logged()[0].outcome).toBe("not-configured");

    const ok = deps();
    await handleClock(delivery(), ok.d);
    for (const c of ok.calls) expect(JSON.stringify(c.params)).not.toContain(KEY);
  });

  it("refuses a malformed stored key without calling GitHub", async () => {
    const bad = deps({ token: "not-a-token" });
    expect(await (await handleClock(delivery(), bad.d)).json()).toEqual({ outcome: "not-configured" });
    expect(bad.fetch).not.toHaveBeenCalled();
  });

  it("records a refused key (expired or revoked) without asking Neon to retry", async () => {
    const r = deps({ github: new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }) });
    const res = await handleClock(delivery(), r.d);
    expect(res.status).toBe(200);
    expect(r.logged()).toEqual([{ outcome: "rejected", status: 401, message: "GitHub refused (401): Bad credentials" }]);
  });

  it("returns 502 on a transient failure so Neon may retry inside the freshness window", async () => {
    const r = deps({ github: new TypeError("fetch failed") });
    expect((await handleClock(delivery(), r.d)).status).toBe(502);
    expect(r.logged()[0].outcome).toBe("failed");
    const s = deps({ github: new Response("", { status: 503 }) });
    expect((await handleClock(delivery(), s.d)).status).toBe(502);
  });

  it("acts only on genuine, fresh, known trigger deliveries", async () => {
    const r = deps();
    const noHeader = new Request("https://clock.example/engine", { method: "POST", body: "{}" });
    expect((await handleClock(noHeader, r.d)).status).toBe(403);
    expect((await handleClock(delivery("someone-elses-trigger"), r.d)).status).toBe(403);
    expect(await (await handleClock(delivery("aegisclock-engine-day", "2026-11-06T13:00:00Z"), r.d)).json()).toEqual({ outcome: "stale-trigger" });
    expect(r.fetch).not.toHaveBeenCalled();
    expect((await handleClock(new Request("https://clock.example/health"), r.d)).status).toBe(200);
    expect(r.sql).toHaveBeenCalledTimes(1); // only the stale delivery's log line; health never touches the database
  });

  it("does not start anything when the database cannot be read", async () => {
    const r = deps({ sqlFails: true });
    expect((await handleClock(delivery(), r.d)).status).toBe(502);
    expect(r.fetch).not.toHaveBeenCalled();
  });
});

describe("engine clock: configuration", () => {
  it("triggers.json and the handler agree on names, routes and paths", () => {
    const cfg = JSON.parse(read("scripts/clock/triggers.json")) as { function: string; triggers: { name: string; function_path: string; cron: string; enabled: boolean }[] };
    expect(cfg.function).toBe("aegisclock");
    expect(Object.fromEntries(cfg.triggers.map((t) => [t.name, t.function_path.slice(1)]))).toEqual(CLOCK_TRIGGERS);
    // One database wake per quarter hour: the clock fires one minute before the learner's :07/:22/:37/:52.
    for (const t of cfg.triggers.filter((x) => x.function_path === "/engine")) expect(t.cron.split(" ")[0]).toMatch(/^6(,21,36,51)?$/);
    expect(cfg.triggers.filter((t) => t.function_path !== "/engine").every((t) => !t.enabled)).toBe(true);
  });

  it("every workflow it starts accepts a manual start with those inputs", () => {
    for (const { workflow, inputs } of Object.values(CLOCK_WORKFLOWS)) {
      const yml = read(`.github/workflows/${workflow}`);
      expect(yml).toMatch(/^\s*workflow_dispatch:/m);
      for (const [k, v] of Object.entries(inputs ?? {})) {
        expect(yml).toContain(`${k}:`);
        expect(yml).toMatch(new RegExp(`options: \\[[^\\]]*\\b${v}\\b`));
      }
    }
  });

  it("the engine workflow syncs the key last, and the sync can never fail the pass", () => {
    const yml = read(".github/workflows/signal-engine.yml");
    expect(yml).toContain("ENGINE_DISPATCH_TOKEN: ${{ secrets.ENGINE_DISPATCH_TOKEN }}");
    // After the engine, the publish and the learner tick: it cannot block or precede them.
    const sync = yml.indexOf("run: npx tsx scripts/clock/sync-token.ts");
    expect(sync).toBeGreaterThan(yml.indexOf("npx tsx scripts/experiment/run.ts tick"));
    expect(sync).toBeGreaterThan(yml.indexOf("- run: npx tsx scripts/engine/run-live.ts"));
    // The script swallows its own failures (exit 0) instead of continue-on-error,
    // which tests/workflow-contract.test.ts forbids in this workflow.
    const script = read("scripts/clock/sync-token.ts");
    expect(script).toMatch(/main\(\)\.catch\(\(err\) => \{[\s\S]*?::warning::Engine clock key sync failed/);
    expect(script).not.toMatch(/process\.exit(Code)?\s*=?\s*\(?\s*1/);
  });

  it("the database refuses anything the code would refuse", () => {
    const sql = read("db/migrations/20261106_engine_clock.sql");
    expect(sql).toContain(`token ~ '${TOKEN_PATTERN.source}'`);
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA aegis_private FROM PUBLIC/);
    expect(sql).not.toMatch(/GRANT [^;]*aegis_private[^;]*TO (anonymous|authenticated|aegis_ai)/);
  });

  it("sync rules: empty does nothing, 'off' clears, junk is refused", () => {
    expect(syncAction(undefined)).toBe("unset");
    expect(syncAction("  ")).toBe("unset");
    expect(syncAction("OFF")).toBe("clear");
    expect(syncAction(KEY)).toBe("store");
    expect(syncAction("ghp_" + "b".repeat(36))).toBe("store");
    expect(syncAction("password123")).toBe("invalid");
    expect(syncAction(KEY + " extra")).toBe("invalid");
  });
});

describe("engine clock: zero-cost bundle", () => {
  it("bundles only lib/clock and Neon's trigger parser, and stays tiny", async () => {
    const r = await build({
      entryPoints: [join(root, "functions/aegisclock/index.ts")], bundle: true, minify: true, platform: "node", target: "node24", format: "esm",
      write: false, metafile: true, tsconfig: join(root, "tsconfig.json"), logLevel: "silent",
    });
    const inputs = Object.keys(r.metafile!.inputs).map((p) => p.replaceAll("\\", "/"));
    for (const p of inputs) expect(p).toMatch(/^(functions\/aegisclock\/index\.ts|lib\/clock\/[a-z-]+\.ts|node_modules\/@neon\/functions\/dist\/(triggers|lib\/parse-trigger-invocation)\.js)$/);
    const text = r.outputFiles![0].text;
    expect(text.length).toBeLessThan(16 * 1024);
    for (const host of ["databento.com", "anthropic.com", "openai.com", "finance.yahoo.com", "api.telegram.org"]) expect(text).not.toContain(host);
  }, 60_000);
});
