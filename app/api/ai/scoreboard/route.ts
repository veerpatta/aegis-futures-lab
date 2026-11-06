/* The AI second opinion's scoreboard: numbers our own code computes from the
   study's records, never AI-written text, so it may be public. Cached at the
   edge for five minutes so visitors cannot keep the database awake. */

import { aiDatabaseConfigured, aiPool } from "@/lib/ai-free/pool";
import { readScoreboard } from "@/lib/ai-judge/store-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHED = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };

export async function GET(): Promise<Response> {
  const updatedAt = new Date().toISOString();
  if (!aiDatabaseConfigured()) return Response.json({ updatedAt, available: false, studies: [] }, { headers: CACHED });
  try {
    const studies = (await readScoreboard(aiPool())).map((s) => ({
      id: s.id, label: s.label, model: s.model, status: s.status, startedAt: s.startedAt,
      calls: s.calls, resolved: s.resolved, taken: s.taken, skipped: s.skipped, sessions: s.sessions,
      aiNet: s.aiNet, takeAllNet: s.takeAllNet, randomPercentile: s.randomPercentile, delta: s.delta,
      verdict: s.verdict, nextLook: s.nextLook,
    }));
    return Response.json({ updatedAt, available: true, studies }, { headers: CACHED });
  } catch {
    console.error("[AI scoreboard] unavailable");
    return Response.json({ updatedAt, available: false, studies: [] }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
