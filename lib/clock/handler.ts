/* The engine clock — a few-kilobyte Neon Function that starts the GitHub
   signal-engine workflow on time.

   WHY. The engine (Yahoo delayed bars → method ideas → published batch →
   virtual account) runs in GitHub Actions on an every-15-minutes cron. On 2026-11-02 at
   about 12:47 UTC GitHub stopped firing this repository's schedules on time:
   from 70–93 engine runs a weekday the count fell to 2–4, every 4–8 hours, so
   the app showed hours-old prices and "waiting for data". GitHub documents
   that scheduled runs may be delayed or dropped under load; many repositories
   reported the same in late 2026. Neon's own scheduler has fired the learner
   function at :07/:22/:37/:52 to the minute all along.

   So Neon keeps the time and GitHub does the work: on each trigger this asks
   GitHub's API to start the workflow (a `workflow_dispatch`, which GitHub
   runs at once). The cron in the workflow stays as a slow fallback.

   COST. Zero. Neon Free includes 1M function invocations and 10 active
   capacity-hours a month; this uses ~2,300 invocations of well under a second.
   Actions minutes are free on a public repository. The triggers fire at
   :06/:21/:36/:51 so the database wakes ONCE per quarter hour for both the
   engine and the learner's own :07 tick (Neon Free allows 100 CU-hours a
   month and keeps a woken database up for 5 minutes).

   KEY. GitHub only starts a workflow for a caller holding a key. The owner
   stores a fine-grained token (this repository, Actions: read and write) as
   the Actions secret ENGINE_DISPATCH_TOKEN; the engine workflow copies it into
   aegis_private.engine_clock_token (scripts/experiment/clock-token.ts), which
   only the database owner can read. Without a key every trigger is a logged
   no-op and the slow cron keeps working as before. The key never leaves this
   function except in the Authorization header to api.github.com, and it is
   never written to the public log.

   Only genuine Neon trigger calls start anything: Neon strips client-sent
   x-neon-* headers at its edge, so the invocation header proves the caller. */

import { parseTriggerDelivery } from "@neon/functions/triggers";
import type { SqlFn } from "./neon-http";
import { TOKEN_PATTERN } from "./token";

export { TOKEN_PATTERN };

export const CLOCK_REPO = "veerpatta/aegis-futures-lab";
export const CLOCK_REF = "main";

export type ClockRoute = "engine" | "learn" | "review";

/** Trigger name → what it starts. The name decides, so a trigger pointed at the
    wrong path cannot start a different job. Pinned to scripts/clock/triggers.json. */
export const CLOCK_TRIGGERS: Readonly<Record<string, ClockRoute>> = Object.freeze({
  "aegisclock-engine-day": "engine",
  "aegisclock-engine-night": "engine",
  "aegisclock-engine-sunday": "engine",
  "aegisclock-learn": "learn",
  "aegisclock-review": "review",
});

export const CLOCK_WORKFLOWS: Readonly<Record<ClockRoute, { workflow: string; inputs?: Readonly<Record<string, string>> }>> = Object.freeze({
  engine: { workflow: "signal-engine.yml" },
  learn: { workflow: "experiment-fallback.yml", inputs: { job: "learn" } },
  review: { workflow: "experiment-fallback.yml", inputs: { job: "review" } },
});

/** A delivery older than this is not acted on: a late engine start is pointless and
    a burst of retried deliveries must not queue a burst of runs. */
export const MAX_TRIGGER_AGE_MS = 10 * 60_000;
const MAX_EARLY_MS = 60_000;

export type ClockOutcome = "dispatched" | "not-configured" | "rejected" | "failed" | "stale-trigger";

export interface ClockDeps {
  /** Null when the function has no DATABASE_URL (it then cannot read its key). */
  sql: SqlFn | null;
  fetch: typeof fetch;
  now: () => number;
}

export const READ_TOKEN_SQL = "SELECT token FROM aegis_private.engine_clock_token WHERE id = 1";
export const LOG_SQL =
  "WITH pruned AS (DELETE FROM public.engine_clock WHERE fired_at < now() - interval '14 days') " +
  "INSERT INTO public.engine_clock(invocation_id, trigger_name, route, scheduled_at, outcome, http_status, message) " +
  "VALUES ($1, $2, $3, $4, $5, $6, $7)";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The GitHub request for one route. Exported so tests can pin it exactly. */
export function dispatchRequest(route: ClockRoute, token: string): { url: string; init: RequestInit } {
  const { workflow, inputs } = CLOCK_WORKFLOWS[route];
  return {
    url: `https://api.github.com/repos/${CLOCK_REPO}/actions/workflows/${workflow}/dispatches`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "aegis-engine-clock",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(inputs ? { ref: CLOCK_REF, inputs } : { ref: CLOCK_REF }),
      redirect: "manual",
    },
  };
}

async function githubMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message.slice(0, 120) : "";
  } catch {
    return "";
  }
}

export async function handleClock(req: Request, deps: ClockDeps): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  if (req.method === "GET" && (path === "/" || path === "/health"))
    return json({ ok: true, service: "aegis engine clock (starts the GitHub engine; virtual only)", triggers: Object.keys(CLOCK_TRIGGERS) });
  if (req.method !== "POST") return json({ error: "not found" }, 404);

  const parsed = await parseTriggerDelivery(req);
  if (!parsed.ok) return json({ error: "not a trigger call" }, parsed.error === "invalid_body" ? 400 : 403);
  const inv = parsed.invocation;
  if (inv.type !== "schedule") return json({ error: "not a schedule trigger" }, 403);
  const route = CLOCK_TRIGGERS[inv.trigger.name];
  if (!route) return json({ error: "unknown trigger" }, 403);
  if (!deps.sql) return json({ error: "The clock has no database connection." }, 503);
  const sql = deps.sql;

  const log = async (outcome: ClockOutcome, httpStatus: number | null, message: string) => {
    try {
      await sql(LOG_SQL, [inv.invocationId, inv.trigger.name, route, inv.data.scheduledAt, outcome, httpStatus, message.slice(0, 300)]);
    } catch {
      /* the log is best effort; the outcome is still returned */
    }
  };

  const now = deps.now();
  const scheduled = Date.parse(inv.data.scheduledAt);
  if (!Number.isFinite(scheduled) || scheduled > now + MAX_EARLY_MS || now - scheduled > MAX_TRIGGER_AGE_MS) {
    await log("stale-trigger", null, "Delivery too old or not yet due; nothing started.");
    return json({ outcome: "stale-trigger" });
  }

  let token: string | null = null;
  try {
    token = (await sql(READ_TOKEN_SQL))[0]?.[0] ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : "database unreachable";
    return json({ outcome: "failed", error: message }, 502);
  }
  if (!token || !TOKEN_PATTERN.test(token)) {
    await log("not-configured", null, token ? "The stored GitHub key has an unexpected format." : "No GitHub key stored; the slow GitHub schedule still runs.");
    return json({ outcome: "not-configured" });
  }

  const { url, init } = dispatchRequest(route, token);
  let res: Response;
  try {
    res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    await log("failed", null, `GitHub unreachable: ${err instanceof Error ? err.message.slice(0, 120) : "network error"}`);
    return json({ outcome: "failed" }, 502);
  }
  if (res.status === 204 || res.status === 200) {
    await log("dispatched", res.status, `Started ${CLOCK_WORKFLOWS[route].workflow}.`);
    return json({ outcome: "dispatched", route });
  }
  const detail = await githubMessage(res);
  // 401 expired or revoked key, 403 missing permission, 404 wrong repository or no
  // access, 422 workflow cannot be started: retrying cannot help.
  if ([401, 403, 404, 422].includes(res.status)) {
    await log("rejected", res.status, `GitHub refused (${res.status})${detail ? `: ${detail}` : ""}`);
    return json({ outcome: "rejected", status: res.status });
  }
  await log("failed", res.status, `GitHub error (${res.status})${detail ? `: ${detail}` : ""}`);
  return json({ outcome: "failed", status: res.status }, 502);
}
