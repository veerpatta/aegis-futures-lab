import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { verifyNeonResearchUser } from '@/lib/ai-auth/verify';
import { requireOwner } from '@/lib/ai-auth/owner';
import { budgetedRequest, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from '@/lib/ai-budget';
import { PgBudgetStore } from '@/lib/ai-budget/pg';
import { loadResearchEvidence } from '@/lib/ai-research/evidence';
import { makeResearchPost } from '@/lib/ai-research/handler';
import { callOpenAiResearch, DEEP_RESEARCH_MODEL, RESEARCH_MODEL, RESEARCH_PROMPT_VERSION } from '@/lib/ai-research/provider';
import { ResearchStore } from '@/lib/ai-store/research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Deliberately require a dedicated server credential, never a public URL.
let connection: Pool | undefined;
function pool(): Pool {
  const url = process.env.AI_DATABASE_URL;
  if (!url) throw new Error('AI database is not configured');
  if (!connection) connection = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, allowExitOnIdle: true });
  return connection;
}
async function status(userId: string) {
  const current = await new PgBudgetStore(pool()).status(userId);
  const [year, month] = current.month.split('-').map(Number);
  return { remainingUsd: current.remainingMicros / 1_000_000, resetAt: new Date(Date.UTC(year, month, 1)).toISOString(), timezone: 'UTC', usedUsd: current.usedMicros / 1_000_000, userRequests: current.userRequests, dailyLimit: current.dailyLimit };
}
async function authenticate(request: Request) {
  const identity = await verifyNeonResearchUser(request);
  return requireOwner(identity, async id => (await pool().query('SELECT 1 FROM public.admin_control_authorized WHERE user_id=$1', [id])).rows.length === 1);
}

const post = makeResearchPost({
  authenticate,
  evidence: () => loadResearchEvidence(pool()),
  async saveRequest({ id, userId, question, evidence, depth }) {
    const hash = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
    const saved = await new ResearchStore(pool()).saveRequest({ id, userId, question, snapshot: evidence, snapshotHash: hash, model: depth === 'deep' ? DEEP_RESEARCH_MODEL : RESEARCH_MODEL, promptVersion: RESEARCH_PROMPT_VERSION });
    if (!saved) throw new Error('Unable to record request');
  },
  async runBudgeted({ id, userId, question, evidence, depth, beforeInvoke }) {
    const key = process.env.OPENAI_API_SECRET;
    if (!key) throw new Error('OpenAI is not configured');
    const model = depth === 'deep' ? DEEP_RESEARCH_MODEL : RESEARCH_MODEL;
    return budgetedRequest(new PgBudgetStore(pool()), {
      requestId: id, userId, model, inputLimit: MAX_INPUT_TOKENS, outputLimit: MAX_OUTPUT_TOKENS,
      // Include the documented 10% regional processing premium as a safety
      // margin, whether or not this project actually incurs that premium.
      price: { model, inputMicrosPerMillion: depth === 'deep' ? 11_000_000 : 2_200_000, outputMicrosPerMillion: depth === 'deep' ? 55_000_000 : 11_000_000, verifiedAt: Date.parse('2026-10-30T00:00:00Z'), expiresAt: Date.parse('2026-11-30T00:00:00Z') }, now: Date.now(),
    }, async () => { await beforeInvoke(); return callOpenAiResearch({ key, question, evidence, model }); });
  },
  async saveResult({ id, userId, result }) {
    const saved = await new ResearchStore(pool()).saveResult({ requestId: id, userId, response: result.answer, citations: result.citations, status: 'complete' });
    if (!saved) throw new Error('Unable to record result');
  },
  async saveFailure({ id, userId, diagnostic }) {
    await new ResearchStore(pool()).saveResult({ requestId: id, userId, response: diagnostic, citations: [], status: 'error' });
  },
  status,
});

export const POST = post;
export async function GET(request: Request): Promise<Response> {
  const identity = await authenticate(request).catch(() => ({ ok: false as const, status: 503 as const, error: 'Sign-in verification is temporarily unavailable.' }));
  if (!identity.ok) return Response.json({ error: identity.error }, { status: identity.status, headers: { 'Cache-Control': 'no-store' } });
  try { return Response.json({ usage: await status(identity.userId) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Research is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
