import type { AiIdentity } from "@/lib/ai-auth/verify";

type Deps = {
  authenticate(request: Request): Promise<AiIdentity>;
  list(userId: string): Promise<{ commands: unknown[]; campaign: { id: string; status: string } | null }>;
  enqueue(input: { id: string; userId: string; action: string; reason: string; expectedId: string | null }): Promise<void>;
};
const json = (body: unknown, status=200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 2048) { await reader.cancel().catch(()=>{}); return null; }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export function controlApi(deps: Deps) {
  return async (request: Request): Promise<Response> => {
    const identity = await deps.authenticate(request).catch(() => ({ok:false as const,status:503 as const,error:"Owner verification is temporarily unavailable."}));
    if (!identity.ok) return json({error:identity.error},identity.status);
    try {
      if (request.method === "GET") return json(await deps.list(identity.userId));
      if (request.method !== "POST") return json({error:"Method not allowed."},405);
      const body = await readBody(request);
      if (body === null) return json({error:"Invalid command."},400);
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return json({error:"Invalid command."},400); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({error:"Invalid command."},400);
      const {action,reason,expectedId} = parsed as Record<string,unknown>;
      if (Object.keys(parsed).some(k=>!["action","reason","expectedId"].includes(k)) || typeof action !== "string" || !["pause","resume","stop","start"].includes(action)
        || typeof reason !== "string" || reason.trim().length < 8 || reason.trim().length > 500
        || !(expectedId === null || typeof expectedId === "string" && expectedId.length > 0 && expectedId.length <= 128)) return json({error:"Invalid command."},400);
      const id = crypto.randomUUID();
      await deps.enqueue({id,userId:identity.userId,action,reason:reason.trim(),expectedId});
      return json({id,status:"pending"},202);
    } catch { return json({error:"The command could not be recorded. Refresh and check for a pending command."},503); }
  };
}
