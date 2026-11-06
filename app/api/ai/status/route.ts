/* Is the free AI helper configured? Cheap and public: it never calls a model
   or the database, and reports the key's variable NAME, never its value. */

import { findFreeAiKey, freeAiEnabled, modelChain } from "@/lib/ai-free/nvidia";
import { aiDatabaseConfigured } from "@/lib/ai-free/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const key = findFreeAiKey();
  return Response.json(
    { freeAi: freeAiEnabled() ? "on" : "off", keyFound: key !== null, keyName: key?.name ?? null, models: modelChain(), database: aiDatabaseConfigured() },
    { headers: { "Cache-Control": "public, s-maxage=60" } });
}
