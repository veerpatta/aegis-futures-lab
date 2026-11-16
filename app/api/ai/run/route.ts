/* One pass of the free AI helper, started by the `ai-helper` job of
   signal-engine.yml after a successful engine pass (docs/AI-HELPER.md).

   Only a GitHub Actions OIDC token for this repository's signal-engine.yml on
   main is accepted, so no shared secret exists. The response goes to a public
   Actions log: it carries counts and fixed codes only, never AI text. */

import { verifyGithubOidc } from "@/lib/ai-auth/github-oidc";
import { HealthBook, PgHealthStore } from "@/lib/ai-free/health";
import { chat, findFreeAiKey, freeAiEnabled, modelChain, type ChatRequest } from "@/lib/ai-free/nvidia";
import { aiDatabaseConfigured, aiPool } from "@/lib/ai-free/pool";
import { runJudge } from "@/lib/ai-judge/runner";
import { PgJudgeStore } from "@/lib/ai-judge/store-pg";
import { JUDGE_STUDIES } from "@/lib/ai-judge/studies";
import { runCoach } from "@/lib/ai-coach/runner";
import { PgCoachStore } from "@/lib/ai-coach/store-pg";
import { runIdeas } from "@/lib/ai-ideas/runner";
import { PgIdeasStore } from "@/lib/ai-ideas/store-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** No new AI call starts after 35 s, and every call must end by 47 s (Vercel
    stops the function at 60 s). The clock starts when the request arrives.
    The last 13 s are kept for the database writes that follow a call (the
    answer, the model health record): aegis_ai_app's statement timeout is 10 s,
    and a cold database can take seconds to wake. Until 2026-11-16 the hard stop
    was 55 s, which left 5 s for those writes; on 2026-11-13 a pass ran past 60 s
    and Vercel killed it ("Task timed out after 60 seconds" on /api/ai/run). */
const CALL_WINDOW_MS = 35_000;
const HARD_STOP_MS = 47_000; // pinned by tests/ai-helper-routes.test.ts
const MAX_CALLS = 4;

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const auth = await verifyGithubOidc(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!freeAiEnabled()) return json({ status: "disabled" });
  const key = findFreeAiKey();
  if (!key) return json({ status: "no-key" }, 503);
  if (!aiDatabaseConfigured()) return json({ status: "no-database" }, 503);
  const budget = { deadline: started + CALL_WINDOW_MS, hardStop: started + HARD_STOP_MS, calls: MAX_CALLS };
  try {
    const db = aiPool();
    // Which models are answering, shared across instances (lib/ai-free/health.ts):
    // a resting model is not asked, and every attempt is recorded.
    const health = await HealthBook.open(new PgHealthStore(db));
    const ask = (req: ChatRequest) => chat(req, { health });
    const available = (model: string, now: number) => health.usable(model, now);
    const judge = await runJudge({ store: new PgJudgeStore(db), chat: ask, now: Date.now, available }, budget);
    const coach = await runCoach({ store: new PgCoachStore(db), chat: ask, now: Date.now }, budget);
    const ideas = await runIdeas({ store: new PgIdeasStore(db), chat: ask, now: Date.now }, budget);
    const models = [...new Set([...modelChain(), ...JUDGE_STUDIES.map((s) => s.model)])];
    return json({ status: "ok", keyName: key.name, judge, coach, ideas, resting: health.resting(models, Date.now()), callsLeft: budget.calls, ms: Date.now() - started });
  } catch {
    console.error("[AI helper] pass failed");
    return json({ status: "unavailable" }, 503);
  }
}
