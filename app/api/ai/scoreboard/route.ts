/* The AI scoreboard: numbers our own code computes from the second-opinion
   studies and the AI research ideas, never AI-written text, so it may be
   public. Verdicts come from the stored looks. Cached at the edge for five
   minutes so visitors cannot keep the database awake. */

import { aiDatabaseConfigured, aiPool } from "@/lib/ai-free/pool";
import { readScoreboard } from "@/lib/ai-judge/store-pg";
import { readIdeasScoreboard } from "@/lib/ai-ideas/store-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHED = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };

export async function GET(): Promise<Response> {
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  if (!aiDatabaseConfigured()) return Response.json({ updatedAt, available: false, studies: [], ideas: [] }, { headers: CACHED });
  try {
    const db = aiPool();
    const studies = (await readScoreboard(db, now)).map((s) => ({
      id: s.id, label: s.label, model: s.model, status: s.status, startedAt: s.startedAt,
      calls: s.calls, resolved: s.resolved, taken: s.taken, skipped: s.skipped, sessions: s.sessions,
      aiNet: s.aiNet, takeAllNet: s.takeAllNet, randomPercentile: s.randomPercentile, delta: s.delta,
      verdict: s.verdict, nextLook: s.nextLook, waiting: s.waiting, lastCheck: s.lastCheck ?? null,
    }));
    const ideas = (await readIdeasScoreboard(db, now)).map((i) => ({
      id: i.id, proposedAt: i.proposedAt, model: i.model, status: i.status, tested: i.tested, resolved: i.resolved, skipped: i.skipped,
      sessions: i.sessions, keptNet: i.keptNet, takeAllNet: i.takeAllNet, delta: i.delta, randomPercentile: i.randomPercentile,
      verdict: i.verdict, nextLook: i.nextLook, waiting: i.waiting,
    }));
    return Response.json({ updatedAt, available: true, studies, ideas }, { headers: CACHED });
  } catch {
    console.error("[AI scoreboard] unavailable");
    return Response.json({ updatedAt, available: false, studies: [], ideas: [] }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
