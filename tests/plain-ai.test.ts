import { describe, expect, it } from "vitest";
import {
  AI_VERDICT_WORDS, IDEA_VERDICT_WORDS, aiAgreement, aiCallWords, aiComparison, aiModelName, aiProgress, aiSummaryLine, callForDecision, ideaConditionWords,
  ideaProgress, ideaRuleWords, primaryStudy, waitingStudyWords, waitingWords, type AiCall, type AiStudyScore,
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
    expect(aiModelName("deepseek-ai/deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
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
    expect(aiSummaryLine(study({ status: "waiting-for-model", model: "moonshotai/kimi-k3.1-pro" }))).toBe("Kimi K3.1 Pro: waiting for its first answer on NVIDIA");
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

  it("lets a running DeepSeek study speak after Kimi and before Nemotron, as the owner asked for it next", () => {
    const nemo = study();
    const deepseek = study({ id: "ai-judge-deepseek-v4.1-flash-v1", model: "deepseek-ai/deepseek-v4.1-flash", calls: 3 });
    const kimi = study({ id: "ai-judge-kimi-k3.1-pro-v1", model: "moonshotai/kimi-k3.1-pro", calls: 1 });
    expect(primaryStudy([nemo, deepseek])?.id).toBe("ai-judge-deepseek-v4.1-flash-v1");
    expect(primaryStudy([nemo, kimi, deepseek])?.id).toBe("ai-judge-kimi-k3.1-pro-v1");
    expect(primaryStudy([nemo, { ...deepseek, calls: 0 }])?.id).toBe("ai-judge-nemotron-ultra-v1");
  });

  it("says why a model waits and what its last check found, in plain words", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    const base = "NVIDIA lists this model, but it has not answered the helper's checks yet. The helper checks every six hours and starts this model's own study the moment it answers.";
    expect(waitingStudyWords({ lastCheck: null }, now)).toBe(base);
    expect(waitingStudyWords({ lastCheck: { at: "2026-11-07T10:00:00Z", outcome: "timeout" } }, now)).toBe(`${base} Last check 2 h ago: NVIDIA's servers for it did not answer.`);
    expect(waitingStudyWords({ lastCheck: { at: "2026-11-07T11:35:00Z", outcome: "not-found" } }, now)).toBe(`${base} Last check 25 min ago: NVIDIA does not offer it to free keys yet.`);
    expect(waitingStudyWords({ lastCheck: { at: "garbage", outcome: "busy" } }, now)).toBe(base);
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

describe("AI research ideas in plain words", () => {
  it("turns each rule condition into words a non-trader can read", () => {
    expect(ideaConditionWords({ field: "side", op: "=", value: "SHORT" })).toBe("the bot would sell (bet on a fall)");
    expect(ideaConditionWords({ field: "side", op: "!=", value: "SHORT" })).toBe("the bot would buy (bet on a rise)");
    expect(ideaConditionWords({ field: "vwap_atr", op: ">", value: 3 })).toBe("price is more than 3 typical swings above the day's average price");
    expect(ideaConditionWords({ field: "vwap_atr", op: "<", value: -2 })).toBe("price is more than 2 typical swings below the day's average price");
    expect(ideaConditionWords({ field: "paused", op: "=", value: "true" })).toBe("its method is paused after a losing streak");
    expect(ideaConditionWords({ field: "hour_ny", op: ">", value: 13 })).toBe("it is after 13:00 New York time");
    expect(ideaConditionWords({ field: "regime", op: "=", value: "range-high-vol" })).toBe("the market is going sideways with big swings");
    expect(ideaConditionWords({ field: "risk_usd", op: ">", value: 120 })).toBe("one contract risks above $120");
    expect(ideaConditionWords({ field: "weekday", op: "=", value: 1 })).toBe("it is a Monday");
  });

  it("joins conditions into one skip rule", () => {
    expect(ideaRuleWords({ when: [{ field: "side", op: "=", value: "SHORT" }, { field: "vwap_atr", op: ">", value: 3 }] }))
      .toBe("Skip the idea when the bot would sell (bet on a fall) and price is more than 3 typical swings above the day's average price.");
    expect(ideaRuleWords({ when: [] })).toBe("—");
  });

  it("adds a waiting line only when it says more than the progress count", () => {
    expect(waitingWords("Look 1: 12 of 60 resolved over 4 of 15 sessions.")).toBeNull();
    expect(waitingWords("Look 1: 2 earlier decisions are still open.")).toBe("Waiting: 2 earlier decisions are still open.");
    expect(waitingWords("Look 2 is complete and will be recorded at the next pass.")).toBe("Waiting: look 2 is complete and will be recorded at the next pass.");
    expect(waitingWords(null)).toBeNull();
  });

  it("keeps a too-early rule amber and counts its fresh trades with n", () => {
    expect(IDEA_VERDICT_WORDS["too-early"].tone).toBe("amber");
    expect(IDEA_VERDICT_WORDS.inconclusive.tone).toBe("amber");
    expect(IDEA_VERDICT_WORDS.fail.tone).toBe("red");
    expect(ideaProgress({ resolved: 12, sessions: 4, skipped: 3, nextLook: 60, status: "testing" }))
      .toBe("12 of 60 fresh trades tested · it would have skipped 3 · 4 of 15 trading days");
    expect(ideaProgress({ resolved: 150, sessions: 40, skipped: 30, nextLook: null, status: "retired" })).toBe("150 fresh trades tested · finished");
  });

  it("parses public idea scores and owner-only rule text strictly", () => {
    const score = { id: "idea-1", proposedAt: "2026-11-09T00:00:00Z", model: "nvidia/nemotron-3-ultra-550b-a55b", status: "testing", tested: 14, resolved: 12,
      skipped: 3, sessions: 4, keptNet: -80, takeAllNet: -150, delta: null, randomPercentile: 64, verdict: "too-early", nextLook: 60 };
    const board = parseScoreboard({ available: true, updatedAt: "x", studies: [], ideas: [score, { ...score, id: 7 }] });
    expect(board?.ideas.map((i) => i.id)).toEqual(["idea-1"]);
    const owner = parseOwnerAi({ calls: [], notes: [{ kind: "week", subject: "2026-W46", text: "Shorts lost more.", model: "m", createdAt: "t" }], ideas: [
      { id: "idea-1", name: "Skip stretched shorts", why: "They lost most.", when: [{ field: "side", op: "=", value: "SHORT" }], proposedAt: "t", model: "m" },
      { id: "idea-2", name: "Bad", why: "x", when: [{ field: "side", op: "≈", value: "SHORT" }], proposedAt: "t", model: "m" },
      { id: "idea-3", name: "Too long", why: "x", when: [1, 2, 3, 4].map(() => ({ field: "rr", op: ">", value: 1 })), proposedAt: "t", model: "m" },
    ] });
    expect(owner?.ideas.map((i) => i.id)).toEqual(["idea-1"]);
    expect(owner?.notes[0].kind).toBe("week");
  });
});

describe("AI helper replies are parsed strictly", () => {
  it("accepts the documented scoreboard and drops malformed studies", () => {
    const parsed = parseScoreboard({ updatedAt: "2026-11-07T10:00:00Z", available: true, studies: [study(), { ...study(), calls: -1 }, { id: "x" }] });
    expect(parsed?.studies).toHaveLength(1);
    expect(parsed?.studies[0].nextLook).toBe(60);
    expect(parseScoreboard({ available: "yes", studies: [] })).toBeNull();
    // A look whose calls are not all final yet is never shown as a verdict.
    expect(parseScoreboard({ available: true, studies: [{ ...study(), verdict: "waiting" }] })?.studies[0].verdict).toBe("too-early");
    expect(parseScoreboard({ available: true, studies: [{ ...study(), verdict: "maybe" }] })?.studies).toEqual([]);
    expect(parseScoreboard(null)).toBeNull();
  });

  it("reads a waiting study's last check only in the documented shape", () => {
    const waiting = { ...study(), status: "waiting-for-model", calls: 0, resolved: 0 };
    const good = parseScoreboard({ available: true, studies: [{ ...waiting, lastCheck: { at: "2026-11-07T10:00:00.000Z", outcome: "timeout" } }] });
    expect(good?.studies[0].lastCheck).toEqual({ at: "2026-11-07T10:00:00.000Z", outcome: "timeout" });
    for (const bad of [{ at: "x", outcome: "timeout" }, { at: "2026-11-07T10:00:00.000Z", outcome: "Upstream <b>failed</b>" }, "timeout", null])
      expect(parseScoreboard({ available: true, studies: [{ ...waiting, lastCheck: bad }] })?.studies[0].lastCheck).toBeNull();
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
