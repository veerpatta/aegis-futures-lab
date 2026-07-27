import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = (name: string) =>
  readFileSync(resolve(process.cwd(), ".github", "workflows", name), "utf8");

describe("automated learning workflow contracts", () => {
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
});
