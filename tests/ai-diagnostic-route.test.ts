import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({verify:vi.fn(),query:vi.fn(),reserve:vi.fn(),settle:vi.fn(),request:vi.fn(),result:vi.fn(),provider:vi.fn()}));
vi.mock('pg',()=>({Pool:class {query=mocks.query;}}));
vi.mock('@/lib/ai-auth/verify',()=>({verifyNeonResearchUser:mocks.verify}));
vi.mock('@/lib/ai-budget/pg',()=>({PgBudgetStore:class {reserve=mocks.reserve;settle=mocks.settle;}}));
vi.mock('@/lib/ai-store/research',()=>({ResearchStore:class {saveRequest=mocks.request;saveResult=mocks.result;}}));
vi.mock('@/lib/ai-research/diagnostic',async original=>({...await original<typeof import('@/lib/ai-research/diagnostic')>(),callDiagnostic:mocks.provider}));
import {POST} from '@/app/api/ai/diagnostic/route';
const saved={...process.env};
beforeEach(()=>{
  vi.clearAllMocks();process.env.AI_DATABASE_URL='postgres://example';process.env.OPENAI_API_SECRET='test-key';
  mocks.verify.mockResolvedValue({ok:true,userId:'owner'});mocks.query.mockResolvedValue({rows:[{ok:1}]});
  mocks.reserve.mockImplementation(async ({id}:{id:string})=>({id}));mocks.settle.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue(true);mocks.result.mockResolvedValue(true);
  const usage={inputTokens:8,outputTokens:3};mocks.provider.mockResolvedValue({value:{status:'connected',usage},usage});
});
afterEach(()=>{process.env=saved;});
const req=()=>new Request('https://aegis.test/api/ai/diagnostic',{method:'POST'});
describe('diagnostic route accounting',()=>{
  it('records the fixed request before the provider and stores only safe outcome metadata',async()=>{
    const res=await POST(req());expect(res.status).toBe(200);
    expect(await res.json()).toEqual({status:'connected',inputTokens:8,outputTokens:3,countedMicrodollars:608});
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({reservedMicros:6864,userId:'owner'}));
    expect(mocks.request.mock.invocationCallOrder[0]).toBeLessThan(mocks.provider.mock.invocationCallOrder[0]);
    expect(mocks.result).toHaveBeenCalledWith(expect.objectContaining({status:'complete',response:expect.objectContaining({status:'connected'})}));
    expect(JSON.stringify(mocks.result.mock.calls)).not.toContain('test-key');
  });
  it('does not call the provider when owner access is revoked or the attempt is already reserved',async()=>{
    mocks.query.mockResolvedValueOnce({rows:[]});expect((await POST(req())).status).toBe(401);expect(mocks.provider).not.toHaveBeenCalled();
    mocks.reserve.mockRejectedValueOnce(Error('Request already reserved; do not retry the provider call.'));
    expect((await POST(req())).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();
  });
});
