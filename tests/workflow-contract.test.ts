import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = (name: string) =>
  readFileSync(resolve(process.cwd(), ".github", "workflows", name), "utf8");

describe("automated learning workflow contracts", () => {
  it("publishes the learner batch only after a successful source engine step", () => {
    const source = workflow("signal-engine.yml");
    const engine = source.indexOf("- run: npx tsx scripts/engine/run-live.ts");
    const publish = source.indexOf("- name: Publish complete market batch");
    expect(engine).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(engine);
    expect(source).not.toMatch(/continue-on-error:\s*true/);
    const publishStep = source.slice(publish);
    expect(publishStep).not.toMatch(/\bif:\s*\$?\{?\{?\s*(?:always|failure)\s*\(/);
    expect(publishStep).toContain("npx tsx scripts/experiment/publish.ts");
  });
  it("runs the free AI helper only after a successful engine pass, without secrets, never failing", () => {
    const source = workflow("signal-engine.yml");
    const start = source.indexOf("\n  ai-helper:");
    expect(start).toBeGreaterThan(-1);
    const job = source.slice(start, source.indexOf("\n  ai-shadow-scheduler:"));
    expect(job).toContain("needs: run");
    expect(job).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/);
    expect(job).toContain("audience=aegis-ai-helper");
    expect(job).toContain("https://aegis-futures-lab-khaki.vercel.app/api/ai/run");
    // Tokens go to curl through --config on stdin, never argv; the step always exits 0.
    expect(job).toContain("curl --config - --proto '=https'");
    const lines = job.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    expect(lines.at(-1)).toBe("exit 0");
    expect(job).not.toMatch(/secrets\./);
    expect(job).not.toMatch(/continue-on-error/);
  });

  it("runs deterministic learning daily and only permits deployment weekly", () => {
    const daily = workflow("nightly-learn.yml");
    const weekly = workflow("weekly-challenger.yml");

    expect(daily).toContain("LEARNING_CADENCE: daily");
    expect(weekly).toContain("LEARNING_CADENCE: weekly");
    expect(weekly).toContain("issues: write");
    expect(weekly).toContain('cron: "0 4 * * 0"');
  });

  it("keeps optional LLM research manual and paid-minute jobs weekly", () => {
    const research = workflow("claude-research.yml");
    const autopilot = workflow("autopilot.yml");
    const ci = workflow("ci.yml");

    expect(research).not.toMatch(/^\s+schedule:/m);
    expect(autopilot).toContain('cron: "30 4 * * 0"');
    expect(ci).toContain('cron: "15 5 * * 0"');
  });

  it("uses Node 24-compatible official actions in every workflow", () => {
    const directory = resolve(process.cwd(), ".github", "workflows");
    const combined = readdirSync(directory)
      .filter((name) => name.endsWith(".yml"))
      .map((name) => readFileSync(resolve(directory, name), "utf8"))
      .join("\n");

    expect(combined).not.toContain("actions/checkout@v4");
    expect(combined).not.toContain("actions/setup-node@v4");
  });
});
