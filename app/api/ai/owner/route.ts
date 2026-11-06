/* AI-written words (the second opinion's reasons and the coach notes), for the
   signed-in owner only. NVIDIA's trial terms forbid making generated content
   available to others, so this never goes to the public site. */

import { verifyNeonResearchUser } from "@/lib/ai-auth/verify";
import { requireOwner } from "@/lib/ai-auth/owner";
import { aiDatabaseConfigured, aiPool } from "@/lib/ai-free/pool";
import { readOwnerCalls } from "@/lib/ai-judge/store-pg";
import { readOwnerNotes } from "@/lib/ai-coach/store-pg";
import { readOwnerIdeas } from "@/lib/ai-ideas/store-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  if (!aiDatabaseConfigured()) return json({ error: "The AI helper is not configured." }, 503);
  const identity = await verifyNeonResearchUser(request)
    .then((id) => requireOwner(id, async (userId) => (await aiPool().query("SELECT 1 FROM public.admin_control_authorized WHERE user_id=$1", [userId])).rows.length === 1))
    .catch(() => ({ ok: false as const, status: 503 as const, error: "Sign-in verification is temporarily unavailable." }));
  if (!identity.ok) return json({ error: identity.error }, identity.status);
  try {
    const db = aiPool();
    const [calls, notes, ideas] = await Promise.all([readOwnerCalls(db), readOwnerNotes(db), readOwnerIdeas(db)]);
    return json({ calls, notes, ideas });
  } catch {
    console.error("[AI owner] unavailable");
    return json({ error: "The AI helper is temporarily unavailable." }, 503);
  }
}
