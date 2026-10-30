import { describe, expect, it, vi } from 'vitest';
import { makeResearchPost } from '@/lib/ai-research/handler';
import { OpenAiHttpError } from '@/lib/ai-research/provider';

const goodRequest = () => new Request('https://aegis.test/api/ai/research', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer example' }, body: JSON.stringify({ question: 'Why paused?' }) });
function deps() {
  return { authenticate: vi.fn(async () => ({ ok: true as const, userId: 'user-1' })), evidence: vi.fn(async () => [{ id: 'run:1', label: 'Run', text: 'paused' }]), saveRequest: vi.fn(async () => {}), runBudgeted: vi.fn(async (input: {beforeInvoke(): Promise<void>}) => { await input.beforeInvoke(); return { answer: 'Paused.', citations: [{ id: 'run:1', label: 'Run' }] }; }), saveResult: vi.fn(async () => {}), saveFailure: vi.fn(async () => {}), status: vi.fn(async () => ({ remainingUsd: 24.9, resetAt: '2026-11-01', timezone: 'UTC' })) };
}
describe('paid research endpoint', () => {
  it('rejects unauthorized callers before reading evidence or making paid requests', async () => {
    const d = { ...deps(), authenticate: vi.fn(async () => ({ ok: false as const, status: 401 as const, error: 'Sign in.' })) };
    const res = await makeResearchPost(d)(goodRequest()); expect(res.status).toBe(401); expect(d.evidence).not.toHaveBeenCalled(); expect(d.runBudgeted).not.toHaveBeenCalled();
  });
  it('saves the owner request before invoking the budgeted provider and returns only that response', async () => {
    const d = deps(); const res = await makeResearchPost(d)(goodRequest());
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ answer: 'Paused.', citations: [{ id: 'run:1' }], usage: { remainingUsd: 24.9 } });
    expect(d.runBudgeted.mock.invocationCallOrder[0]).toBeLessThan(d.saveRequest.mock.invocationCallOrder[0]);
    expect(d.saveResult).toHaveBeenCalled();
  });
  it('fails closed when storage fails and never exposes the internal error', async () => {
    const d = deps(); d.saveRequest.mockRejectedValueOnce(new Error('secret database info'));
    const res = await makeResearchPost(d)(goodRequest()); expect(res.status).toBe(503); expect(await res.text()).not.toContain('secret'); expect(d.saveResult).not.toHaveBeenCalled();
  });
  it('does not persist a request if the budget reservation is denied', async () => {
    const d = deps(); d.runBudgeted.mockRejectedValueOnce(new Error('Daily AI request limit reached.'));
    const res = await makeResearchPost(d)(goodRequest()); expect(res.status).toBe(429); expect(d.saveRequest).not.toHaveBeenCalled();
  });
  it('records only safe failure metadata after the request was recorded', async () => {
    const d = deps();
    d.runBudgeted.mockImplementationOnce(async input => { await input.beforeInvoke(); throw new OpenAiHttpError(403, 'model_not_allowed'); });
    expect((await makeResearchPost(d)(goodRequest())).status).toBe(503);
    expect(d.saveFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', diagnostic: { kind: 'provider_http', status: 403, code: 'model_not_allowed' } }));
    expect(JSON.stringify(d.saveFailure.mock.calls)).not.toContain('Why paused');
  });
  it('accepts only the two server-defined research depths', async () => {
    const d = deps();
    const request = (depth: string) => new Request('https://aegis.test/api/ai/research', {method:'POST', body:JSON.stringify({question:'What changed?', depth})});
    expect((await makeResearchPost(d)(request('deep'))).status).toBe(200);
    expect(d.runBudgeted.mock.calls[0][0]).toMatchObject({depth:'deep'});
    expect((await makeResearchPost(d)(request('arbitrary-model'))).status).toBe(400);
  });
  it('logs only an allowlisted provider status and never arbitrary error details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const d = deps(); d.runBudgeted.mockRejectedValueOnce(new Error('OpenAI request failed (401)'));
      expect((await makeResearchPost(d)(goodRequest())).status).toBe(503);
      expect(log).toHaveBeenCalledWith('[AI research] provider HTTP 401');
      d.runBudgeted.mockRejectedValueOnce(new OpenAiHttpError(403, 'unsupported_country_region_territory'));
      expect((await makeResearchPost(d)(goodRequest())).status).toBe(503);
      expect(log).toHaveBeenCalledWith('[AI research] provider HTTP 403 code unsupported_country_region_territory');
      d.runBudgeted.mockRejectedValueOnce(new Error('secret question and key'));
      expect((await makeResearchPost(d)(goodRequest())).status).toBe(503);
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    } finally { log.mockRestore(); }
  });
});
