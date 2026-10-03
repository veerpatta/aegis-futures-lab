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
// 2026-10-03: research-code revision, risk-cap change, then the cross-platform hash fix
// (docs/research/2026-10-03-risk-cap.md). The same value on Windows and Linux — if this
// passes on one and fails on the other, the hash has become platform-dependent again.
const PINNED = "c933481bea2ceb4856d136be58e88bfffe50a5bd30ee88bbe740ba54f947a9ab";

describe("research code hash", () => {
  it("only changes in a deliberate research-code revision", () => {
    expect(researchCodeHash()).toBe(PINNED);
  });
});
