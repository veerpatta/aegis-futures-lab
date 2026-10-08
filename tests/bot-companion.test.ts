import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { botActivity, checkedLearningExamples, learningMilestone, nextLearningCheck } from "@/lib/plain/companion";
import type { ExpLearning, ExpOverview } from "@/lib/experiment/view";

const now = Date.parse("2026-10-08T14:00:00Z") / 1000;
const overview = {
  experiment: { status: "active", mode: "live" },
  account: { last_ok_tick_at: new Date((now - 60) * 1000).toISOString(), open_risk: 0, stale_symbols: [] },
  last_runs: { tick: { status: "ok", started_at: new Date((now - 60) * 1000).toISOString() } },
  open_positions: [], quota_level: "normal", today_reasons: {},
} as unknown as ExpOverview;

describe("the bot's activity is evidence, not a pretend training animation", () => {
  it("is quiet for missing, failed and offline reads", () => {
    expect(botActivity(null, now, true, false).moving).toBe(false);
    expect(botActivity(overview, now, false, false).mood).toBe("offline");
    expect(botActivity(overview, now, true, true).moving).toBe(false);
    expect(botActivity(overview, now, true, false).title).toBe("Watching for ideas");
  });
  it("distinguishes data preparation from model review and refuses stale running claims", () => {
    const run = { status: "running", started_at: new Date((now - 60) * 1000).toISOString(), finished_at: null, counts: {}, message: null, quota_level: null };
    expect(botActivity({ ...overview, last_runs: { ...overview.last_runs, learn: run } }, now, true, false).mood).toBe("organising");
    expect(botActivity({ ...overview, last_runs: { ...overview.last_runs, review: run } }, now, true, false).mood).toBe("reviewing");
    const stale = { ...run, started_at: new Date((now - 1900) * 1000).toISOString() };
    expect(botActivity({ ...overview, last_runs: { ...overview.last_runs, review: stale } }, now, true, false)).toMatchObject({ mood: "attention", moving: false });
    expect(botActivity({ ...overview, experiment: { ...overview.experiment, status: "paused" } }, now, true, false).moving).toBe(false);
  });
  it("keeps absent evidence unknown and training thresholds separate from improvement", () => {
    expect(learningMilestone(null, 50, null).remaining).toBeNull();
    const learning = { progress: { closed_outcomes: 8 }, versions: [] } as unknown as ExpLearning;
    expect(learningMilestone(learning, 50, 8).remaining).toBe(42);
    expect(learningMilestone(learning, 50, 60).title).toBe("Enough examples to start training");
    // Raw closed outcomes may include unaffordable or unusable examples.
    expect(checkedLearningExamples(learning, null)).toBeNull();
    expect(checkedLearningExamples({ ...learning, latest_dataset: { id: "d", built_at: "2026-10-08T06:45:00Z", cutoff: "2026-10-08T06:45:00Z", row_count: 6, rows_hash: "x" } }, null)?.count).toBe(6);
  });
  it("displays the deployed UTC schedules across weekends and DST changes", () => {
    const triggers = JSON.parse(readFileSync("scripts/experiment/triggers.json", "utf8")).triggers;
    expect(triggers.find((t: { function_path: string }) => t.function_path === "/learn").cron).toBe("45 6 * * 2-6");
    expect(triggers.find((t: { function_path: string }) => t.function_path === "/review").cron).toBe("0 7 * * 0");
    expect(new Date(nextLearningCheck(Date.parse("2026-10-10T06:45:00Z") / 1000, "learn") * 1000).toISOString()).toBe("2026-10-13T06:45:00.000Z");
    expect(new Date(nextLearningCheck(Date.parse("2026-11-01T06:59:00Z") / 1000, "review") * 1000).toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });
});
