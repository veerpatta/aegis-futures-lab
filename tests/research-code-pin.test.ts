import { describe, expect, it } from "vitest";
import { researchCodeHash } from "@/scripts/engine/research-code";

/* The research code hash keys every forward observation and every paper
   release. Editing any file it covers (lib/strategies, lib/backtest, lib/costs,
   lib/indicators, lib/time, lib/market, lib/validation, lib/paper/policy.ts,
   lib/types.ts, regime.ts, research-observer.ts, paper-broker.ts) restarts the
   forward evidence at zero and pauses any release on its next engine pass.

   That is sometimes the right call — but it must be a decision, never a side
   effect of UI work that happened to reword a label in a hashed folder. So the
   hash is pinned here. A deliberate research-code revision updates this value
   in the same commit and says why in docs/research/. */
// 2026-10-03 research-code revision (docs/research/2026-10-03-research-code-revision.md).
const PINNED = "702840b7633f7da54d29c46c63a779389ad7b6d497405e78f3f768aade0a8b46";

describe("research code hash", () => {
  it("only changes in a deliberate research-code revision", () => {
    expect(researchCodeHash()).toBe(PINNED);
  });
});
