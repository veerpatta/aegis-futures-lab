import { evidenceForPrompt, type Evidence, type ResearchAnswer } from './core';

export type AuthResult = { ok: true; userId: string } | { ok: false; status: 401 | 503; error: string };
export type ResearchDepth = 'standard' | 'deep';
export interface ResearchDeps {
  authenticate(request: Request): Promise<AuthResult>;
  evidence(): Promise<Evidence[]>;
  saveRequest(input: { id: string; userId: string; question: string; evidence: Evidence[]; depth: ResearchDepth }): Promise<unknown>;
  runBudgeted(input: { id: string; userId: string; question: string; evidence: Evidence[]; depth: ResearchDepth; beforeInvoke(): Promise<void> }): Promise<ResearchAnswer>;
  saveResult(input: { id: string; userId: string; result: ResearchAnswer }): Promise<unknown>;
  status(userId: string): Promise<{ remainingUsd: number; resetAt: string; timezone: string }>;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

async function readBody(request: Request): Promise<string> {
  if (!request.body) throw new Error('Invalid request');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 12000) { await reader.cancel(); throw new Error('Request too large'); }
    chunks.push(part.value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(data);
}

export function makeResearchPost(deps: ResearchDeps) {
  return async (request: Request): Promise<Response> => {
    const identity = await deps.authenticate(request).catch(() => ({ ok: false as const, status: 503 as const, error: 'Sign-in verification is temporarily unavailable.' }));
    if (!identity.ok) return json({ error: identity.error }, identity.status);
    let question: string;
    let depth: ResearchDepth;
    try {
      const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
      if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.trim().length > 2000 || Object.keys(body).some(k => k !== 'question' && k !== 'depth') || (body.depth !== undefined && body.depth !== 'standard' && body.depth !== 'deep')) throw new Error('Invalid question');
      question = body.question.trim();
      depth = body.depth === 'deep' ? 'deep' : 'standard';
    } catch { return json({ error: 'Enter a research question of at most 2,000 characters.' }, 400); }
    const id = crypto.randomUUID();
    try {
      const evidence = evidenceForPrompt(await deps.evidence());
      // UTF-8 bytes conservatively bound provider input, including JSON framing.
      if (new TextEncoder().encode(JSON.stringify({ question, evidence })).length > 36000) throw new Error('Evidence exceeds safe input limit');
      const result = await deps.runBudgeted({ id, userId: identity.userId, question, evidence, depth,
        beforeInvoke: async () => { await deps.saveRequest({ id, userId: identity.userId, question, evidence, depth }); } });
      await deps.saveResult({ id, userId: identity.userId, result });
      const usage = await deps.status(identity.userId).catch(() => undefined);
      return json({ ...result, ...(usage ? { usage } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'Daily AI request limit reached.' || message === 'Monthly AI budget exhausted.') return json({ error: message }, 429);
      return json({ error: 'Research is temporarily unavailable. Please try again later.' }, 503);
    }
  };
}
