import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runEngineStages } from "@/lib/resilience/pipeline";

const workflow = (name: string) =>
  readFileSync(resolve(process.cwd(), ".github", "workflows", name), "utf8");

describe("automated learning workflow contracts", () => {
  it("runs guarded engine stages in order, publishing only after success", () => {
    const source = workflow("signal-engine.yml");
    const primary = readFileSync(resolve(process.cwd(), "scripts/resilience/primary.ts"), "utf8");
    expect(source).toContain("npx tsx scripts/resilience/primary.ts engine");
    expect(source).not.toMatch(/continue-on-error:\s*true/);
    expect(source).not.toMatch(/\bif:\s*\$?\{?\{?\s*(?:always|failure)\s*\(/);
    expect(primary.indexOf("await claim(")).toBeLessThan(primary.indexOf("runEngineStages(run)"));
    expect(primary.indexOf("await release(")).toBeGreaterThan(primary.indexOf("runEngineStages(run)"));
    expect(primary).toContain("r.status!==0");
    const called:string[]=[];
    runEngineStages((p,...args)=>called.push([p,...args].join(" ")));
    expect(called).toEqual(["scripts/engine/run-live.ts","scripts/experiment/publish.ts","scripts/experiment/run.ts tick","scripts/tm-study/forward.ts"]);
  });
  it("a failed engine or publication cannot advance the learner", () => {
    for (const failAt of [0,1]) {
      const called:string[]=[];
      expect(()=>runEngineStages(p=>{
        called.push(p); if(called.length===failAt+1) throw Error("failed");
      })).toThrow("failed");
      expect(called).toHaveLength(failAt+1);
      expect(called).not.toContain("scripts/experiment/run.ts");
    }
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
    // The route stops by 55 s and Vercel at 60 s; the client waits 75 s at most.
    expect(job).toContain("--fail --max-time 75");
    expect(job).not.toContain("--max-time 110");
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
