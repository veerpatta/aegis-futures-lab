/* HTTP entry for the Neon Function (functions/aegisexp/index.ts).

   POST /tick, /learn and /review only run for genuine Neon trigger calls:
   Neon strips any client-sent X-Neon-* header at its edge, so the presence of
   X-Neon-Trigger-Invocation-Id (equal to the body's invocation_id) proves the
   call came from Neon's scheduler. The invocation id is stable across Neon's
   retries, which is what makes a retried run a no-op. GET /health only reads. */

import { runJob, type JobInput } from "./jobs";
import type { ExperimentStore, JobName } from "./store";

const JOBS = new Set<JobName>(["tick", "learn", "review"]);
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export interface HandlerDeps {
  store: () => ExperimentStore;
  health: () => Promise<unknown>;
  lineage?: string;
  codeSha?: string | null;
  now?: () => number;
}

export function makeHandler(deps: HandlerDeps) {
  return async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      try {
        return jsonResponse({ ok: true, service: "aegis experimental learner (virtual only)", health: await deps.health() });
      } catch (err) {
        return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 503);
      }
    }
    const job = path.slice(1) as JobName;
    if (req.method !== "POST" || !JOBS.has(job)) return jsonResponse({ error: "not found" }, 404);
    const headerId = req.headers.get("x-neon-trigger-invocation-id");
    if (!headerId) return jsonResponse({ error: "not a trigger call" }, 403);
    let body: { invocation_id?: string; data?: { scheduled_at?: string } } = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "bad body" }, 400);
    }
    if (body.invocation_id && body.invocation_id !== headerId) return jsonResponse({ error: "invocation id mismatch" }, 403);
    const scheduledAt = body.data?.scheduled_at ? Math.floor(Date.parse(body.data.scheduled_at) / 1000) : null;
    const input: JobInput = {
      job, invocationId: `neon:${headerId}`, trigger: "neon", store: deps.store(), lineage: deps.lineage, scheduledAt,
      codeSha: deps.codeSha ?? null, nowSec: deps.now ? deps.now() : undefined,
    };
    const result = await runJob(input);
    console.log(`aegisexp ${job} ${body.data?.scheduled_at ?? ""}: ${result.status} — ${result.message}`);
    return jsonResponse(result, result.status === "error" ? 500 : 200);
  };
}
