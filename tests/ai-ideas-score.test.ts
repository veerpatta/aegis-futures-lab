import { describe, expect, it } from "vitest";
import { dueIdeaLook, evaluateIdeaLook, retireReason, runningIdea, type IdeaRow } from "@/lib/ai-ideas/score";
import { IDEAS_RULES } from "@/lib/ai-ideas/rules";
import type { StoredLook } from "@/lib/ai-judge/looks";

const T0 = Date.parse("2026-12-01T15:00:00Z") / 1000;
/** `sessions` days of 5 ideas: one big loser (-300) and four results of +50/-50. `skipIt` picks the skips. */
function rows(sessions: number, skipIt: (net: number, i: number) => boolean, startDay = 0): IdeaRow[] {
  const out: IdeaRow[] = [];
  for (let s = 0; s < sessions; s++) {
    const day = startDay + s;
    [-300, 50, -50, 50, 50].forEach((net, i) => out.push({ key: `d${String(day).padStart(3, "0")}:${i}`, session: `S${String(day).padStart(3, "0")}`, order: T0 + day * 86400 + i * 60, state: "resolved", skip: skipIt(net, i), net }));
  }
  return out;
}
const look1 = IDEAS_RULES.looks[0];

describe("AI ideas: prospective scoring", () => {
  it("passes a rule that skips the losers it should, within the 10-60% skip band", () => {
    const r = evaluateIdeaLook(rows(15, (net) => net === -300), 1, look1, "idea-aaaaaaaaaaaa", IDEAS_RULES);
    expect(r).toMatchObject({ verdict: "pass", skipped: 15, skipRate: 0.2, keptNet: 1500, takeAllNet: -3000 });
    expect(r.randomPercentile).toBeGreaterThanOrEqual(99.5);
  });

  it("fails a rule that skips the winners", () => {
    expect(evaluateIdeaLook(rows(15, (net) => net === 50), 1, look1, "idea-aaaaaaaaaaaa", IDEAS_RULES).verdict).toBe("fail");
  });

  it("does not pass a rule that skips too much, even if it helps", () => {
    const skipMost = rows(15, (net, i) => net === -300 || i >= 2);
    const r = evaluateIdeaLook(skipMost, 1, look1, "idea-aaaaaaaaaaaa", IDEAS_RULES);
    expect(r.skipRate).toBeGreaterThan(0.6);
    expect(r.verdict).not.toBe("pass");
  });

  it("waits while any decision in the look's window is open, then takes the same window (review fix 1)", () => {
    const all = rows(15, (net) => net === -300);
    const open = all.map((r, i) => (i === 7 ? { ...r, state: "open" as const, net: null } : r));
    expect(dueIdeaLook(open, [], "idea-aaaaaaaaaaaa", IDEAS_RULES, T0 + 99e6)).toEqual({ waiting: expect.stringContaining("still open") });
    const due = dueIdeaLook(all, [], "idea-aaaaaaaaaaaa", IDEAS_RULES, T0 + 99e6);
    // Five ideas a day: the 15-session minimum is met at the 71st decision.
    expect("due" in due && due.due).toMatchObject({ look: 1, resolved: 71, lastDecisionKey: all[70].key });
  });

  it("retires from stored looks only: a decided look, the final look, or 26 weeks", () => {
    const at = (look: number, verdict: StoredLook["verdict"]): StoredLook => ({ look, verdict, takenAt: "t" });
    expect(retireReason([], T0, T0 + 86400, IDEAS_RULES)).toBeNull();
    expect(retireReason([at(1, "pass")], T0, T0, IDEAS_RULES)).toBe("pass at look 1");
    expect(retireReason([at(1, "fail")], T0, T0, IDEAS_RULES)).toBe("fail at look 1");
    expect(retireReason([at(1, "inconclusive")], T0, T0, IDEAS_RULES)).toBeNull();
    expect(retireReason([at(1, "inconclusive"), at(2, "inconclusive")], T0, T0, IDEAS_RULES)).toBe("final look: inconclusive");
    expect(retireReason([], T0, T0 + 26 * 7 * 86400, IDEAS_RULES)).toBe("26 weeks without a final look");
  });

  it("shows running totals as information, never counting excluded decisions as tested", () => {
    const r = [...rows(1, (net) => net === -300), { key: "x", session: "S", order: T0 + 9e6, state: "excluded" as const, skip: false, net: null }];
    expect(runningIdea(r, "idea-aaaaaaaaaaaa", IDEAS_RULES)).toMatchObject({ tested: 5, resolved: 5, skipped: 1, keptNet: 100, takeAllNet: -200 });
  });
});
