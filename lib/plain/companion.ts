import { executionState, freshnessState, type ExpLearning, type ExpOverview } from "@/lib/experiment/view";

export type BotMood = "watching" | "managing" | "organising" | "reviewing" | "resting" | "attention" | "offline" | "loading";
export interface BotActivity { mood: BotMood; title: string; detail: string; moving: boolean }

/** Animation is a view of recorded work, never evidence that a job is running. */
export function botActivity(o: ExpOverview | null, now: number | null, online: boolean, failed: boolean): BotActivity {
  if (!online) return { mood: "offline", title: "Offline for now", detail: "Showing the saved record. Activity cannot be checked while this phone is offline.", moving: false };
  if (failed) return { mood: "attention", title: "Update unavailable", detail: "The latest check could not be read. These figures may be old.", moving: false };
  if (!o || now === null) return { mood: "loading", title: "Checking in", detail: "Waiting for the bot's recorded activity.", moving: false };
  const execution = executionState(o, now);
  if (["paused", "blocked", "error", "unknown"].includes(execution.state))
    return { mood: "attention", title: execution.state === "paused" ? "Taking a pause" : "Needs attention", detail: execution.reason, moving: false };
  for (const job of ["review", "learn"] as const) {
    const run = o.last_runs[job];
    if (run?.status === "running") {
      const age = now - Date.parse(run.started_at) / 1000;
      if (age < 0 || age > 30 * 60) return { mood: "attention", title: "Waiting for a report", detail: "A learning job has not reported back recently. Its progress is unknown.", moving: false };
      return job === "review"
        ? { mood: "reviewing", title: "Testing new versions", detail: "Comparing results on later days and checking costs and risk. The current model stays in charge until all checks pass.", moving: true }
        : { mood: "organising", title: "Organising examples", detail: "Checking finished outcomes and updating the learning record. This is preparation for training.", moving: true };
    }
  }
  const fresh = freshnessState(o, now, online, failed);
  if (fresh.state === "stale" || fresh.state === "unavailable") return { mood: "attention", title: "Waiting for usable data", detail: fresh.reason, moving: false };
  if (execution.state === "managing") return { mood: "managing", title: "Following virtual trades", detail: execution.reason, moving: true };
  if (execution.state === "waiting") return { mood: "resting", title: "Waiting with a purpose", detail: execution.reason, moving: false };
  return { mood: "watching", title: "Watching for ideas", detail: "Between scheduled checks. Every eligible finished idea can add an example, even when the bot skipped the trade.", moving: true };
}

/** Existing UTC schedules, displayed through the user's ET/IST preference. */
export function nextLearningCheck(now: number, job: "learn" | "review"): number {
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now * 1000);
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(job === "learn" ? 6 : 7, job === "learn" ? 45 : 0, 0, 0);
    const day = d.getUTCDay(), t = d.getTime() / 1000;
    if (t > now && (job === "review" ? day === 0 : day >= 2 && day <= 6)) return t;
  }
  return now;
}

export function checkedLearningExamples(data: ExpLearning | null, overview: ExpOverview | null): { count: number; at: string } | null {
  if (!data || (overview && data.experiment_id !== overview.experiment.id)) return null;
  const sources: { count: number; at: string }[] = [];
  if (data.latest_dataset) sources.push({ count: data.latest_dataset.row_count, at: data.latest_dataset.built_at });
  for (const key of ["learn", "review"] as const) {
    const run = overview?.last_runs[key];
    const audit = run?.counts.learning as { usable?: number } | undefined;
    if (run?.status === "ok" && run.finished_at && typeof audit?.usable === "number") sources.push({ count: audit.usable, at: run.finished_at });
  }
  return sources.filter(x => Number.isFinite(x.count) && x.count >= 0 && Number.isFinite(Date.parse(x.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

export function learningMilestone(data: ExpLearning | null, minimum: number, usable: number | null) {
  if (!data || usable === null) return { title: "Waiting for an example check", detail: "The next notebook update will count which finished outcomes can be used for training.", remaining: null };
  const remaining = Math.max(0, minimum - usable);
  if (remaining) return { title: `${remaining} more examples to begin training`, detail: `Training can start with ${minimum} usable outcomes. The weekly review also needs a free testing slot.`, remaining };
  const shadowing = data.versions.filter(v => v.status === "shadowing").length;
  return shadowing
    ? { title: `${shadowing} version${shadowing === 1 ? " is" : "s are"} being tested`, detail: "The next hurdle is a passing review and enough fresh results. More examples alone do not prove a better model.", remaining: 0 }
    : { title: "Enough examples to start training", detail: "The weekly review can train an untried version when a testing slot and the free usage allowance permit it.", remaining: 0 };
}
