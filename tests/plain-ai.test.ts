import { describe, expect, it } from "vitest";
import {
  AI_VERDICT_WORDS, aiAgreement, aiCallWords, aiComparison, aiModelName, aiProgress, aiSummaryLine, callForDecision, primaryStudy,
  type AiCall, type AiStudyScore,
} from "@/lib/plain/ai";
import { parseOwnerAi, parseScoreboard } from "@/components/ai/AiProvider";

const study = (over: Partial<AiStudyScore> = {}): AiStudyScore => ({
  id: "ai-judge-nemotron-ultra-v1", label: "Nemotron 3 Ultra", model: "nvidia/nemotron-3-ultra-550b-a55b", status: "active",
  startedAt: "2026-11-07T00:00:00Z", calls: 12, resolved: 8, taken: 3, skipped: 9, sessions: 4, aiNet: -40, takeAllNet: -220,
  randomPercentile: 71.4, delta: null, verdict: "too-early", nextLook: 60, ...over,
});

describe("AI helper wording", () => {
  it("keeps too little evidence amber, never red, and only a measured loss red", () => {
    expect(AI_VERDICT_WORDS["too-early"].tone).toBe("amber");
    expect(AI_VERDICT_WORDS.inconclusive.tone).toBe("amber");
    expect(AI_VERDICT_WORDS.fail.tone).toBe("red");
    expect(AI_VERDICT_WORDS.pass.tone).toBe("green");
  });

  it("names models in plain words and says how sure the AI was", () => {
    expect(aiModelName("moonshotai/kimi-k3.1-pro")).toBe("Kimi K3.1 Pro");
    expect(aiModelName("nvidia/nemotron-3-ultra-550b-a55b")).toBe("Nemotron 3 Ultra");
    expect(aiModelName("acme/new-model")).toBe("new-model");
    expect(aiCallWords({ decision: "skip", confidence: 84.6 })).toBe("Would skip it · 85% sure");
    expect(aiCallWords({ decision: "take", confidence: 140 })).toBe("Would take it · 100% sure");
    expect(aiAgreement({ decision: "skip" }, "take")).toBe("The bot took it anyway");
    expect(aiAgreement({ decision: "take" }, "take")).toBe("Agrees with the bot");
  });

  it("never shows a rate without its n, and colours early numbers amber", () => {
    const lines = aiComparison(study(), (n) => `$${n}`);
    expect(lines.map((l) => l.label)).toEqual(["Following the AI", "Taking every idea", "Random picks of the same size"]);
    expect(lines[2]).toMatchObject({ value: "beat 71% of them", note: "n=3", tone: "amber" });
    expect(lines.every((l) => l.tone === "amber" || l.value === "—")).toBe(true);
    const judged = aiComparison(study({ verdict: "inconclusive", randomPercentile: 40 }), (n) => `$${n}`);
    expect(judged[0].tone).toBe("bad");
    expect(judged[2].tone).toBe("bad");
    expect(aiComparison(study({ taken: 0, randomPercentile: null }), String)[2].value).toBe("—");
  });

  it("counts progress toward the preregistered looks", () => {
    expect(aiProgress(study())).toBe("8 of 60 finished calls · 4 of 15 trading days");
    expect(aiProgress(study({ resolved: 90, nextLook: 150 }))).toBe("90 of 150 finished calls for the final check");
    expect(aiSummaryLine(null)).toBe("AI second opinion: not running yet");
    expect(aiSummaryLine(study({ status: "waiting-for-model", model: "moonshotai/kimi-k3.1-pro" }))).toBe("Kimi K3.1 Pro: waiting for NVIDIA to switch it on");
    expect(aiSummaryLine(study())).toBe("AI second opinion: too early to tell · 12 calls, 8 finished");
  });

  it("lets a running Kimi study speak first, as the owner asked for Kimi", () => {
    const nemo = study();
    const kimi = study({ id: "ai-judge-kimi-k3.1-pro-v1", model: "moonshotai/kimi-k3.1-pro", calls: 2 });
    const waiting = study({ id: "ai-judge-kimi-k3.1-pro-v1", model: "moonshotai/kimi-k3.1-pro", status: "waiting-for-model", calls: 0 });
    expect(primaryStudy([nemo, kimi])?.id).toBe("ai-judge-kimi-k3.1-pro-v1");
    expect(primaryStudy([nemo, waiting])?.id).toBe("ai-judge-nemotron-ultra-v1");
    expect(primaryStudy([])).toBeNull();
  });

  it("picks the primary study's call on a decision, else the newest", () => {
    const calls: AiCall[] = [
      { decisionKey: "k1", studyId: "a", model: "m", decision: "take", confidence: 60, reason: "r", calledAt: "2026-11-07T10:00:00Z" },
      { decisionKey: "k1", studyId: "b", model: "m", decision: "skip", confidence: 70, reason: "r", calledAt: "2026-11-07T10:05:00Z" },
    ];
    expect(callForDecision(calls, "k1", "a")?.studyId).toBe("a");
    expect(callForDecision(calls, "k1", null)?.studyId).toBe("b");
    expect(callForDecision(calls, "k2")).toBeNull();
  });
});

describe("AI helper replies are parsed strictly", () => {
  it("accepts the documented scoreboard and drops malformed studies", () => {
    const parsed = parseScoreboard({ updatedAt: "2026-11-07T10:00:00Z", available: true, studies: [study(), { ...study(), calls: -1 }, { id: "x" }] });
    expect(parsed?.studies).toHaveLength(1);
    expect(parsed?.studies[0].nextLook).toBe(60);
    expect(parseScoreboard({ available: "yes", studies: [] })).toBeNull();
    expect(parseScoreboard(null)).toBeNull();
  });

  it("keeps only well-formed owner calls and notes, and trims long text", () => {
    const parsed = parseOwnerAi({
      calls: [
        { decisionKey: "k", studyId: "s", model: "m", decision: "skip", confidence: 70, reason: "x".repeat(900), calledAt: "2026-11-07T10:00:00Z" },
        { decisionKey: "k", studyId: "s", model: "m", decision: "maybe", confidence: 70, reason: "r", calledAt: "t" },
      ],
      notes: [{ kind: "day", subject: "2026-11-06", text: "Quiet day.", model: "m", createdAt: "2026-11-07T10:00:00Z" }, { kind: "week" }],
    });
    expect(parsed?.calls).toHaveLength(1);
    expect(parsed?.calls[0].reason).toHaveLength(600);
    expect(parsed?.notes).toEqual([{ kind: "day", subject: "2026-11-06", text: "Quiet day.", model: "m", createdAt: "2026-11-07T10:00:00Z" }]);
    expect(parseOwnerAi({ calls: "nope", notes: [] })).toBeNull();
  });
});
