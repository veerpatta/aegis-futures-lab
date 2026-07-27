/* Item 2.6 — nightly consistency pass. Makes SILENCE ITSELF ALARMING.

   Both audits of this system found the same shape of bug: a structural failure
   that produced no error, no empty screen and no alert — just a number that
   was quietly meaningless. `score_calibration` returning {total: 0} forever
   while its precondition rows piled up. A shadow stream reporting a win rate
   that no row could ever satisfy. A scheduled workflow that had stopped firing.
   Every one of them was visible in the data and reported by nobody.

   So this pass asserts the invariants those bugs violated, and it FAILS LOUDLY
   — a watchdog issue plus Telegram — never a silent console line. A violation
   that only shows up in CI logs is the exact failure mode being fixed.

   Pure checks live in `checkInvariants` so they are unit-tested directly; the
   reporting side does the I/O. */

export interface InvariantInput {
  /** Every signals row (only the fields the checks need). */
  signals: {
    tier: string;
    dedupe_key: string;
    status: string;
    pnl_usd: number | null;
    score: number | null;
    target_price: number | null;
    stale_data?: boolean | null;
  }[];
  /** Every shadow_signals row. */
  shadow: {
    strategy: string;
    symbol: string;
    status: string;
    pnl_usd: number | null;
    target_price?: number | null;
  }[];
  /** stat_key → the payload written for the most recent date_key. */
  latestStats: Record<string, unknown>;
  /* Scheduled workflow name → how long since it last ran and how long it is
     ALLOWED to be quiet. The limit is per workflow because the crons differ by
     two orders of magnitude: a flat 48h would call weekly-digest (168h by
     design) stale on nearly every nightly run. */
  workflowAgeHours: Record<string, WorkflowAge>;
}

export interface WorkflowAge {
  /** Hours since the last run; null = no run ever recorded. */
  ageHours: number | null;
  /** Hours this cron may go quiet before it counts as a fault. */
  maxAgeHours: number;
}

export interface Violation {
  code: string;
  /** One sentence a human can act on, with the counts that prove it. */
  detail: string;
}

const isEmptyPayload = (payload: unknown): boolean => {
  if (payload === null || payload === undefined) return true;
  if (typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  // The shapes learn.ts writes: {total, deciles}, {streams}, {weeks}, {gates}.
  if (Array.isArray(p.deciles)) return p.deciles.length === 0;
  if (Array.isArray(p.streams)) return p.streams.length === 0;
  if (Array.isArray(p.weeks)) return p.weeks.length === 0;
  if (Array.isArray(p.gates)) return p.gates.length === 0;
  if (p.real && typeof p.real === "object") {
    const real = p.real as Record<string, unknown>;
    return Array.isArray(real.deciles) && real.deciles.length === 0;
  }
  return Object.keys(p).length === 0;
};

export function checkInvariants(input: InvariantInput): Violation[] {
  const out: Violation[] = [];
  const { signals, shadow, latestStats, workflowAgeHours } = input;

  /* 1) A stream whose rows are 100% null-target must not be presented with a
        win rate. promotionReport enforces this now (item 2.2b); this asserts
        the enforcement is actually in place rather than trusting it. */
  const byStream = new Map<string, typeof shadow>();
  for (const r of shadow) {
    const key = `${r.strategy}|${r.symbol}`;
    const arr = byStream.get(key) ?? [];
    arr.push(r);
    byStream.set(key, arr);
  }
  const scoreboard = latestStats.shadow_scoreboard as
    | { streams?: { strategy: string; symbol: string; winRate: number | null }[] }
    | undefined;
  for (const s of scoreboard?.streams ?? []) {
    const rows = byStream.get(`${s.strategy}|${s.symbol}`) ?? [];
    const targetless = rows.length > 0 && rows.every((r) => r.target_price === null);
    if (targetless && s.winRate !== null)
      out.push({
        code: "winrate_without_target",
        detail:
          `shadow stream ${s.strategy}/${s.symbol} prints a win rate of ${s.winRate}% while ` +
          `all ${rows.length} of its rows have a null target — a target-hit rate that no row ` +
          `can satisfy. The 2.2b guard should have withheld it.`,
      });
  }

  /* 2) A learned_stats payload must not be empty while its PRECONDITION rows
        exist. This is the score_calibration bug: {total: 0, deciles: []} for
        weeks while scored closed signals accumulated, and nothing said so. */
  const freshSignals = signals.filter((s) => !s.stale_data);
  const scoredClosed = freshSignals.filter((s) => s.pnl_usd !== null && s.score !== null).length;
  const closedShadow = shadow.filter((s) => s.pnl_usd !== null).length;
  const preconditions: { key: string; n: number; what: string }[] = [
    { key: "score_calibration", n: scoredClosed, what: "closed signals carrying a score" },
    { key: "shadow_scoreboard", n: shadow.length, what: "shadow rows" },
    { key: "condition_ledger", n: freshSignals.filter((s) => s.pnl_usd !== null).length, what: "closed signals" },
    { key: "fill_reality", n: freshSignals.filter((s) => s.pnl_usd !== null).length, what: "closed signals" },
  ];
  for (const p of preconditions) {
    if (p.n === 0) continue; // legitimately empty — nothing to compute from
    if (!(p.key in latestStats))
      out.push({
        code: "stat_missing",
        detail: `learned_stats has no ${p.key} row at all, but ${p.n} ${p.what} exist.`,
      });
    else if (isEmptyPayload(latestStats[p.key]))
      out.push({
        code: "stat_empty_with_data",
        detail:
          `learned_stats.${p.key} is empty while ${p.n} ${p.what} exist — the stat is not being ` +
          `computed from data that is already there.`,
      });
  }
  void closedShadow;

  /* 3) A scheduled workflow that has gone quiet for longer than its own
        cadence allows. A cron GitHub silently disabled for inactivity looks
        exactly like a quiet week. */
  for (const [name, { ageHours, maxAgeHours }] of Object.entries(workflowAgeHours)) {
    if (ageHours === null)
      out.push({
        code: "workflow_never_ran",
        detail: `scheduled workflow ${name} has no recorded run at all.`,
      });
    else if (ageHours > maxAgeHours)
      out.push({
        code: "workflow_stale",
        detail:
          `scheduled workflow ${name} last ran ${Math.round(ageHours)}h ago, over its ` +
          `${maxAgeHours}h limit.`,
      });
  }

  return out;
}

/* ── Reporting ─────────────────────────────────────────────────────────────
   Violations go to Telegram AND a GitHub issue under the `watchdog` family, so
   they surface exactly where a dead cron would. Never a bare console.log: the
   whole point of 2.6 is that a silent structural failure is the bug. */

export const INVARIANT_LABEL = "watchdog-invariant";

/* Hours since each scheduled workflow last ran, from the GitHub Actions API.
   Returns null for a workflow with no runs. A token-less environment gets an
   empty map — the check then simply has nothing to say about workflows rather
   than inventing a violation. */
export async function workflowAges(
  repo: string,
  token: string,
  nowMs: number
): Promise<Record<string, WorkflowAge>> {
  if (!token) return {};
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "aegis-invariants",
  };
  const listed = await fetch(`https://api.github.com/repos/${repo}/actions/workflows?per_page=100`, {
    headers,
  });
  if (!listed.ok) throw new Error(`workflows list → HTTP ${listed.status}`);
  const body = (await listed.json()) as {
    workflows?: { id: number; name: string; path: string; state: string }[];
  };
  const out: Record<string, WorkflowAge> = {};
  for (const wf of body.workflows ?? []) {
    // Only cron-scheduled workflows have an expectation of firing on their own.
    if (wf.state !== "active") continue;
    const expected = SCHEDULED_WORKFLOWS.find((s) => wf.path.endsWith(s.file));
    if (!expected) continue;
    const runs = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${wf.id}/runs?per_page=1`,
      { headers }
    );
    if (!runs.ok) continue;
    const rbody = (await runs.json()) as { workflow_runs?: { created_at: string }[] };
    const latest = rbody.workflow_runs?.[0];
    out[wf.name] = {
      ageHours: latest ? (nowMs - Date.parse(latest.created_at)) / 3_600_000 : null,
      maxAgeHours: expected.maxAgeHours,
    };
  }
  return out;
}

/* The crons that must keep firing, each with the longest silence its own
   schedule can legitimately produce plus margin — GitHub delays public-repo
   crons by 15-60 minutes and skips slots under load.

   A single flat limit (it was 48h) was wrong in both directions: it called
   weekly-digest stale on nearly every nightly run, and it would have let a
   dead daily cron sit unnoticed for two days.

   signal-engine is deliberately excluded — the dead-cron watchdog owns it at
   45-minute resolution and duplicating it here would double-alert. self-heal
   is excluded because it is `workflow_run`-triggered, not scheduled: never
   firing is its healthy state. */
export interface ScheduledWorkflow {
  file: string;
  /** Longest legitimate gap in hours, including margin. */
  maxAgeHours: number;
  /** The cron, so the number above can be re-derived rather than trusted. */
  cadence: string;
}

export const SCHEDULED_WORKFLOWS: ScheduledWorkflow[] = [
  // Tue-Sat 05:30 → longest gap is Sat→Tue, 72h.
  { file: "nightly-learn.yml", maxAgeHours: 84, cadence: "30 5 * * 2-6" },
  // Mirrors the engine's Globex-week window → longest gap is Fri 23:47 UTC to
  // Sun 22:17 UTC, ~46h.
  { file: "watchdog.yml", maxAgeHours: 60, cadence: "17,47 * * * 1-5 + 17,47 22-23 * * 0" },
  { file: "autopilot.yml", maxAgeHours: 36, cadence: "30 4 * * *" },
  { file: "claude-research.yml", maxAgeHours: 36, cadence: "15 6 * * * + 0 7 * * 0" },
  { file: "weekly-digest.yml", maxAgeHours: 192, cadence: "30 6 * * 6" },
  { file: "weekly-challenger.yml", maxAgeHours: 192, cadence: "0 4 * * 0" },
  // Day-of-month ORs with day-of-week, so it fires at least every Saturday.
  { file: "monthly-tune.yml", maxAgeHours: 192, cadence: "0 6 1-7 * 6" },
];

/* Raise or clear the invariant issue and send Telegram. Never throws — a
   reporting failure must not fail the nightly job, but it IS logged as an
   error so it shows up red in the Actions log. */
export async function reportInvariants(
  violations: Violation[],
  opts: { repo: string; token: string; nowIso: string; sendTelegram: (t: string) => Promise<void> }
): Promise<void> {
  const { repo, token, nowIso } = opts;
  const gh = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "aegis-invariants",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 422)
      throw new Error(`GitHub ${method} ${path} → ${res.status}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  };
  const openIssue = async () => {
    const issues = (await gh(
      "GET",
      `/repos/${repo}/issues?labels=${INVARIANT_LABEL}&state=open&per_page=5`
    )) as { number: number }[] | null;
    return Array.isArray(issues) && issues.length ? issues[0] : null;
  };

  if (!violations.length) {
    console.log("invariants: all clear");
    if (!token) return;
    try {
      const issue = await openIssue();
      if (issue) {
        await gh("POST", `/repos/${repo}/issues/${issue.number}/comments`, {
          body: `All invariants clean at ${nowIso}.`,
        });
        await gh("PATCH", `/repos/${repo}/issues/${issue.number}`, { state: "closed" });
        console.log(`closed invariant issue #${issue.number}`);
      }
    } catch (e) {
      console.error(`invariant issue cleanup failed: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }

  // Loud on stderr as well, so the Actions log is red even with no token.
  console.error(`invariants: ${violations.length} VIOLATION(S)`);
  for (const v of violations) console.error(`  ${v.code}: ${v.detail}`);

  await opts.sendTelegram(
    `🚨 <b>Invariant check</b>: ${violations.length} structural violation(s).\n` +
      violations.map((v) => `• ${v.detail}`).join("\n") +
      `\nThese are the failures that produce no error and no empty screen. Paper only.`
  );

  if (!token) return;
  try {
    const existing = await openIssue();
    if (existing) {
      await gh("POST", `/repos/${repo}/issues/${existing.number}/comments`, {
        body: formatInvariantReport(violations, nowIso),
      });
      console.log(`commented on invariant issue #${existing.number}`);
    } else {
      await gh("POST", `/repos/${repo}/labels`, { name: INVARIANT_LABEL, color: "b60205" });
      const issue = (await gh("POST", `/repos/${repo}/issues`, {
        title: `Invariant check: ${violations.length} structural violation(s)`,
        body: formatInvariantReport(violations, nowIso),
        labels: [INVARIANT_LABEL],
      })) as { number?: number } | null;
      console.log(`opened invariant issue #${issue?.number}`);
    }
  } catch (e) {
    console.error(`invariant issue alert failed: ${e instanceof Error ? e.message : e}`);
  }
}

export function formatInvariantReport(violations: Violation[], nowIso: string): string {
  return (
    `The nightly invariant check found ${violations.length} violation(s) at ${nowIso}.\n\n` +
    `Each of these is a structural failure that produces no error and no empty screen — just a ` +
    `number that is quietly meaningless. Both prior audits of this system found exactly this ` +
    `shape of bug, which is why silence is now alarming.\n\n` +
    violations.map((v) => `- **${v.code}** — ${v.detail}`).join("\n") +
    `\n\nThis issue closes itself on the next clean nightly run.`
  );
}

