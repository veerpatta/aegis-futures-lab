import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const experimentFiles = readdirSync(join(root, "lib", "experiment")).filter((f) => f.endsWith(".ts")).map((f) => `lib/experiment/${f}`);

describe("experiment isolation", () => {
  it("writes only experiment_* tables — never the practice account, the signal record, bars or the global model", () => {
    for (const f of [...experimentFiles, "scripts/experiment/run.ts", "scripts/experiment/control.ts", "functions/aegisexp/index.ts"]) {
      const src = read(f);
      const writes = [...src.matchAll(/\b(INSERT\s+INTO|UPDATE(?!\s+SET\b)|DELETE\s+FROM)\s+([a-z_]+)/g)].map((m) => m[2].toLowerCase());
      for (const table of writes) expect(table, `${f} writes ${table}`).toMatch(/^experiment(s|_[a-z_]+)$/);
    }
  });

  it("lives outside the research-code hash, so changing it never restarts forward evidence", () => {
    const hashed = read("scripts/engine/research-code.ts");
    expect(hashed).not.toContain("lib/experiment");
    expect(hashed).not.toContain("functions/");
  });

  it("the trial account it replaced is gone", () => {
    expect(() => read("lib/trial/engine.ts")).toThrow();
    expect(() => read("scripts/engine/trial-broker.ts")).toThrow();
    expect(read("scripts/engine/run-live.ts")).not.toContain("trial");
  });
});

describe("zero-cost mode", () => {
  it("the function bundle pulls in no paid data, paid AI, notify or engine-on-import module", async () => {
    const r = await build({
      entryPoints: [join(root, "functions/aegisexp/index.ts")], bundle: true, platform: "node", target: "node24", format: "esm",
      write: false, metafile: true, external: ["pg-native", "cloudflare:sockets"], tsconfig: join(root, "tsconfig.json"), logLevel: "silent",
    });
    const inputs = Object.keys(r.metafile!.inputs);
    const forbidden = [/databento/i, /anthropic|claude/i, /lib[\\/]data[\\/](yahoo|archive|roll-fill)/, /scripts[\\/]engine[\\/](notify|run-live|learn|data|model|alerts|paper-broker)\.ts$/];
    expect(inputs.filter((p) => forbidden.some((re) => re.test(p)))).toEqual([]);
    const text = r.outputFiles![0].text;
    for (const host of ["databento.com", "api.anthropic.com", "finance.yahoo.com", "api.telegram.org"]) expect(text).not.toContain(host);
  }, 60_000);

  it("self-heal (paid Claude) no longer fires on its own", () => {
    const yml = read(".github/workflows/self-heal.yml");
    expect(yml).not.toMatch(/^\s*workflow_run:/m);
    expect(yml).toMatch(/workflow_dispatch/);
  });
});

describe("historical study isolation", () => {
  const historyFiles = readdirSync(join(root, "lib", "history")).filter((f) => f.endsWith(".ts")).map((f) => `lib/history/${f}`);

  it("writes only its private history_* tables", () => {
    for (const f of [...historyFiles, "scripts/history/run.ts"]) {
      const src = read(f);
      const writes = [...src.matchAll(/\b(INSERT\s+INTO|UPDATE(?!\s+SET\b)|DELETE\s+FROM)\s+([a-z_]+)/g)].map((m) => m[2].toLowerCase());
      for (const table of writes) expect(table, `${f} writes ${table}`).toMatch(/^history_[a-z_]+$/);
    }
  });

  it("downloads nothing and calls no paid service: it only reads the archive it already holds", () => {
    for (const f of [...historyFiles, "scripts/history/run.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bfetch\(|fetchChart|from\s+"[^"]*(databento|anthropic|claude|telegram|notify|yahoo)[^"]*"/i);
    }
    const yml = read(".github/workflows/historical-study.yml");
    expect(yml).toMatch(/workflow_dispatch/);
    expect(yml).not.toMatch(/^\s*schedule:/m);
    expect(yml).not.toMatch(/DATABENTO|ANTHROPIC|TELEGRAM/);
  });

  it("stays out of the research-code hash and out of the live function bundle", async () => {
    expect(read("scripts/engine/research-code.ts")).not.toContain("lib/history");
    const r = await build({
      entryPoints: [join(root, "functions/aegisexp/index.ts")], bundle: true, platform: "node", target: "node24", format: "esm",
      write: false, metafile: true, external: ["pg-native", "cloudflare:sockets"], tsconfig: join(root, "tsconfig.json"), logLevel: "silent",
    });
    expect(Object.keys(r.metafile!.inputs).filter((p) => /lib[\/]history[\/]/.test(p))).toEqual([]);
  }, 60_000);

  it("the new tables are private; only the totals view is public", () => {
    const sql = read("db/migrations/20261007_historical_study.sql");
    expect(sql).toContain("ARRAY['history_studies','history_runs','history_leases','history_chunks','history_examples','history_trials','history_finals']");
    expect(sql).toMatch(/REVOKE ALL ON public.%I FROM anonymous, authenticated/);
    const grants = [...sql.matchAll(/GRANT\s+\w+\s+ON\s+([^;]+?)\s+TO/g)].map((m) => m[1].trim());
    expect(grants).toEqual(["public.history_overview"]);
  });
});
