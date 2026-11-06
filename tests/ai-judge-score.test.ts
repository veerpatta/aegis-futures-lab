import { describe, expect, it } from "vitest";
import { lookWindow, nextLookIndex, sortForLooks, verdictFromLooks, type StoredLook } from "@/lib/ai-judge/looks";
import { dueJudgeLook, evaluateJudgeLook, runningJudge, type JudgeScoreRow } from "@/lib/ai-judge/score";
import { JUDGE_RULES } from "@/lib/ai-judge/studies";

const HOUR = 3600;
const T0 = Date.parse("2026-12-01T15:00:00Z") / 1000;

/** `sessions` days of 4 decisions: two win $100, two lose $100. `pick` says which the AI takes. */
function rows(sessions: number, pick: (net: number, i: number) => boolean, startDay = 0): JudgeScoreRow[] {
  const out: JudgeScoreRow[] = [];
  for (let s = 0; s < sessions; s++) {
    const day = startDay + s;
    [100, -100, 100, -100].forEach((net, i) => out.push({ key: `d${String(day).padStart(3, "0")}:${i}`, session: `S${String(day).padStart(3, "0")}`, order: T0 + day * 86400 + i * 60, state: "resolved", decision: pick(net, i) ? "take" : "skip", net }));
  }
  return out;
}
const later = (r: readonly JudgeScoreRow[]) => r[r.length - 1].order + 3 * HOUR;
const look1 = JUDGE_RULES.looks[0];

describe("frozen looks (review fix 1)", () => {
  it("does not take a look while any decision inside its window is still open", () => {
    const r = rows(15, (net) => net > 0);
    r[9] = { ...r[9], state: "open", net: null };
    const w = lookWindow(sortForLooks(r), 60, 15, later(r), 2 * HOUR);
    expect(w).toEqual({ taken: false, waiting: expect.stringMatching(/^(1 earlier decision is still open|59 of 60)/) });
  });

  it("gives the same window and verdict whatever order the trades resolved in", () => {
    // 20 days of decisions; the look's window is the first 60 by decision time.
    const all = rows(20, (net) => net > 0);
    const first = dueJudgeLook(all, [], "study", JUDGE_RULES, later(all), 2 * HOUR);
    // Same decisions, but an early one was still open while later ones resolved:
    // the look waits instead of sliding its window onto later decisions.
    const early = all.map((r, i) => (i === 3 ? { ...r, state: "open" as const, net: null } : r));
    expect(dueJudgeLook(early, [], "study", JUDGE_RULES, later(all), 2 * HOUR)).toEqual({ waiting: expect.stringContaining("still open") });
    // Once it resolves, the look is exactly the one taken without the delay.
    expect(dueJudgeLook(all, [], "study", JUDGE_RULES, later(all) + 999, 2 * HOUR)).toEqual(first);
    expect("due" in first && first.due.lastDecisionKey).toBe(all[59].key);
  });

  it("waits until no answer about an earlier decision can still be recorded", () => {
    const r = rows(15, (net) => net > 0);
    const last = r[59].order;
    expect(dueJudgeLook(r, [], "study", JUDGE_RULES, last + HOUR, 2 * HOUR)).toEqual({ waiting: expect.stringContaining("may still be recorded") });
    expect("due" in dueJudgeLook(r, [], "study", JUDGE_RULES, last + 2 * HOUR, 2 * HOUR)).toBe(true);
  });

  it("skips excluded decisions (void, too large) and fills the window with the next ones", () => {
    const r = rows(16, (net) => net > 0).map((x, i) => (i < 4 ? { ...x, state: "excluded" as const, net: null } : x));
    const w = lookWindow(sortForLooks(r), 60, 15, later(r), 0);
    expect(w.taken && w.rows[0].key).toBe(r[4].key);
    expect(w.taken && w.rows.length).toBe(60);
  });

  it("reads the verdict only from stored looks, and moves to look 2 after an inconclusive look 1", () => {
    const stored: StoredLook[] = [{ look: 1, verdict: "inconclusive", takenAt: "t" }];
    expect(verdictFromLooks([], [60, 150])).toEqual({ verdict: "too-early", nextLook: 60 });
    expect(verdictFromLooks(stored, [60, 150])).toEqual({ verdict: "inconclusive", nextLook: 150 });
    expect(verdictFromLooks([{ look: 1, verdict: "pass", takenAt: "t" }], [60, 150])).toEqual({ verdict: "pass", nextLook: null });
    expect(nextLookIndex(stored, 2)).toBe(2);
    expect(nextLookIndex([{ look: 1, verdict: "fail", takenAt: "t" }], 2)).toBeNull();
    expect(nextLookIndex([...stored, { look: 2, verdict: "inconclusive", takenAt: "t" }], 2)).toBeNull();
  });
});

describe("the preregistered rule on a look's window", () => {
  it("passes only a filter that beats take-all, random picks and costs", () => {
    const r = rows(15, (net) => net > 0);
    const res = evaluateJudgeLook(r, 1, look1, "study", JUDGE_RULES);
    expect(res).toMatchObject({ verdict: "pass", aiNet: 3000, takeAllNet: 0, takeRate: 0.5, resolved: 60 });
    expect(res.randomPercentile).toBeGreaterThanOrEqual(99);
  });
  it("fails a filter that keeps the losers", () => {
    expect(evaluateJudgeLook(rows(15, (net) => net < 0), 1, look1, "study", JUDGE_RULES).verdict).toBe("fail");
  });
  it("never passes taking everything or nothing", () => {
    expect(evaluateJudgeLook(rows(15, () => true), 1, look1, "study", JUDGE_RULES).verdict).not.toBe("pass");
    expect(evaluateJudgeLook(rows(15, () => false), 1, look1, "study", JUDGE_RULES).verdict).not.toBe("pass");
  });
  it("shows running totals as information, counting every answer as a call", () => {
    const r = [...rows(2, (net) => net > 0), { key: "x", session: "S9", order: T0 + 9e6, state: "excluded" as const, decision: "take" as const, net: null }];
    expect(runningJudge(r, "study", JUDGE_RULES)).toMatchObject({ calls: 9, resolved: 8, taken: 5, skipped: 4, aiNet: 400, takeAllNet: 0 });
  });
});
