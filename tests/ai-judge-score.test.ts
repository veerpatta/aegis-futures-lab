import { describe, expect, it } from "vitest";
import { lookSize, scoreJudge, type JudgeScoreRow } from "@/lib/ai-judge/score";
import { JUDGE_RULES } from "@/lib/ai-judge/studies";

/** `sessions` days of 4 ideas: two win $100, two lose $100. `pick` says which the AI takes. */
function rows(sessions: number, pick: (net: number, i: number) => boolean, startDay = 1): JudgeScoreRow[] {
  const out: JudgeScoreRow[] = [];
  for (let s = 0; s < sessions; s++) {
    const day = `2026-12-${String(startDay + s).padStart(2, "0")}`;
    [100, -100, 100, -100].forEach((net, i) => out.push({ key: `${day}:${i}`, session: day, at: (startDay + s) * 86400 + i, decision: pick(net, i) ? "take" : "skip", net }));
  }
  return out;
}

describe("AI second opinion: preregistered verdict", () => {
  it("is too early before 60 resolved calls over 15 sessions", () => {
    const s = scoreJudge(rows(14, (net) => net > 0), "study", JUDGE_RULES);
    expect(s.resolved).toBe(56);
    expect(s.verdict).toBe("too-early");
    expect(s.nextLook).toBe(60);
  });

  it("passes look 1 only for a filter that beats take-all, random picks and costs", () => {
    const s = scoreJudge(rows(15, (net) => net > 0), "study", JUDGE_RULES);
    expect(s.resolved).toBe(60);
    expect(s.aiNet).toBe(3000);
    expect(s.takeAllNet).toBe(0);
    expect(s.randomPercentile).toBeGreaterThanOrEqual(99);
    expect(s.verdict).toBe("pass");
    expect(s.nextLook).toBeNull();
  });

  it("fails a filter that keeps the losers", () => {
    const s = scoreJudge(rows(15, (net) => net < 0), "study", JUDGE_RULES);
    expect(s.verdict).toBe("fail");
  });

  it("does not pass a filter that takes everything (no selection) or nothing", () => {
    expect(scoreJudge(rows(15, () => true), "study", JUDGE_RULES).verdict).not.toBe("pass");
    expect(scoreJudge(rows(15, () => false), "study", JUDGE_RULES).verdict).not.toBe("pass");
  });

  it("freezes a decided look: later losses never overturn a pass", () => {
    const early = rows(15, (net) => net > 0);
    const later = rows(40, (net) => net < 0, 16);
    const s = scoreJudge([...early, ...later], "study", JUDGE_RULES);
    expect(s.verdict).toBe("pass");
    expect(s.resolved).toBe(220);
    // Running totals keep moving and are shown, but they are not the verdict.
    expect(s.aiNet).toBe(3000 - 40 * 200);
  });

  it("leaves unresolved calls out of the comparison", () => {
    const r = rows(15, (net) => net > 0);
    r[0] = { ...r[0], net: null };
    const s = scoreJudge(r, "study", JUDGE_RULES);
    expect(s.calls).toBe(60);
    expect(s.resolved).toBe(59);
    expect(s.verdict).toBe("too-early");
  });

  it("takes a look at the first moment both minimums are met", () => {
    // 60 calls on one day, then one call a day.
    const sessions = Array.from({ length: 80 }, (_, i) => ({ session: i < 60 ? "a" : `b${i}` }));
    expect(lookSize(sessions, 60, 2)).toBe(61);
    expect(lookSize(sessions, 60, 15)).toBe(74);
    expect(lookSize(sessions.slice(0, 73), 60, 15)).toBeNull();
    expect(lookSize([{ session: "x" }], 60, 1)).toBeNull();
  });
});
