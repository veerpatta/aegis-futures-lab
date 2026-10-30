import { describe, expect, it } from "vitest";
import { learningOutcomeWords, learningOutcomeState, learningPracticeNet } from "@/lib/plain/experiment";

const result = { shadow_status: "closed", shadow_qty: 1, shadow_net_per_contract: -5, features: { x: 1 }, provenance: "prospective" as const };

describe("trade learning explanation", () => {
  it("does not count a result when even one contract is too risky", () => {
    expect(learningOutcomeWords({ ...result, shadow_qty: 0 })).toMatch(/too risky.*not.*learn/i);
  });
  it("does not claim an example was included without the saved features", () => {
    expect(learningOutcomeWords({ ...result, features: null })).toMatch(/missing.*not.*learn/i);
  });
  it("labels replay results as non-fresh and subject to dataset checks", () => {
    expect(learningOutcomeWords({ ...result, provenance: "replay" })).toMatch(/next.*check/i);
    expect(learningOutcomeWords({ ...result, provenance: "replay" })).toMatch(/not fresh/i);
  });
  it("does not call a missing outcome a completed example", () => {
    expect(learningOutcomeWords({ ...result, shadow_status: null })).toMatch(/not.*finished/i);
  });
  it("separates ready, waiting, excluded and unknown outcomes", () => {
    expect(learningOutcomeState(result)).toBe("ready");
    expect(learningOutcomeState({ ...result, shadow_status: "open" })).toBe("waiting");
    expect(learningOutcomeState({ ...result, shadow_qty: 0 })).toBe("excluded");
    expect(learningOutcomeState({ ...result, shadow_qty: null })).toBe("unknown");
  });
  it("only shows a saved standalone practice amount when it is closed and sized", () => {
    expect(learningPracticeNet({ ...result, shadow_qty: 2 })).toBe(-10);
    expect(learningPracticeNet({ ...result, shadow_qty: 0 })).toBeNull();
    expect(learningPracticeNet({ ...result, shadow_status: "open" })).toBeNull();
  });
});
