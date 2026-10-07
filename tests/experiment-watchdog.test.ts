import { describe, expect, it } from "vitest";
import { findLearnerProblems } from "../scripts/engine/watchdog.mjs";

const now = new Date("2026-10-07T15:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const health = (over: Record<string, unknown> = {}) => ({
  lineage: "learner", status: "active", last_ok_tick_at: ago(10),
  runs: [{ job: "tick", status: "ok", message: "Watching" }, { job: "tick", status: "ok", message: "Watching" }], ...over,
});

describe("watchdog: experimental learner", () => {
  it("is quiet while the learner checks in", () => {
    expect(findLearnerProblems([health()], now)).toEqual([]);
  });

  it("alerts when no successful check for 90 minutes inside the futures week", () => {
    expect(findLearnerProblems([health({ last_ok_tick_at: ago(120) })], now)[0].reason).toMatch(/no successful learner check for 120 min/);
    expect(findLearnerProblems([health({ last_ok_tick_at: ago(120) })], now, { active: false })).toEqual([]);
    expect(findLearnerProblems([health({ last_ok_tick_at: ago(120) })], now, { warmingUp: true })).toEqual([]);
  });

  it("alerts on two failed checks in a row, even outside the window", () => {
    const runs = [{ job: "tick", status: "error", message: "boom" }, { job: "learn", status: "ok" }, { job: "tick", status: "error", message: "boom" }];
    expect(findLearnerProblems([health({ runs })], now, { active: false })[0].reason).toMatch(/last two learner checks failed/);
  });

  it("does not alert for a campaign registered before its first scheduled check", () => {
    expect(findLearnerProblems([health({ last_ok_tick_at: null, runs: [] })], now)).toEqual([]);
  });
});
