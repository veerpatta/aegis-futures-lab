import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IDEAS_PREREG_DOC, IDEAS_RULES, ideasRulesHash } from "@/lib/ai-ideas/rules";
import { FIELD_NAMES } from "@/lib/ai-ideas/dsl";

/* AI research ideas are frozen before the first proposal
   (docs/research/2026-11-07-ai-ideas-preregistration.md). Changing a rule means a new
   version and a new preregistration, never an edit of these pins. */
const RULES_HASH = "4ec78bd9173d5e3518a4c734b0b5ab58b27628f988c062171b6cb1d4be1ff71a";
const DOC_SHA256 = "87827956cc51e5a5caaa76de9c592ae535252b850fde8be972beaed3e9588b1a";

const doc = () => readFileSync(resolve(process.cwd(), IDEAS_PREREG_DOC), "utf8").replace(/\r\n/g, "\n");

describe("AI ideas: frozen rules", () => {
  it("pins the configuration hash and the preregistration document", () => {
    expect(ideasRulesHash()).toBe(RULES_HASH);
    expect(createHash("sha256").update(doc()).digest("hex")).toBe(DOC_SHA256);
    expect(doc()).toContain(RULES_HASH);
  });

  it("uses stricter looks than the second opinion, because three rules run at once", () => {
    expect(IDEAS_RULES.looks).toEqual([
      { resolved: 60, sessions: 15, alpha: 0.005, percentile: 99.5 },
      { resolved: 150, sessions: 15, alpha: 0.015, percentile: 98.5 },
    ]);
    expect(IDEAS_RULES).toMatchObject({ maxTesting: 3, proposalEveryDays: 7, minFinishedForProposal: 20, maxWeeks: 26, skipRate: { min: 0.1, max: 0.6 } });
  });

  it("states every rule and every allowed field in the document", () => {
    const text = doc();
    for (const t of ["99.5%", "98.5%", "≥ 99.5", "≥ 98.5", "10% and 60%", "26 weeks", "20", "7 days", "**3**", "stored once", "backdated"]) expect(text).toContain(t);
    for (const f of FIELD_NAMES) expect(text).toContain(`\`${f}\``);
  });
});
