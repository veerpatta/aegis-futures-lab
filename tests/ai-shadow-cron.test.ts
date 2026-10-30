import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({pool:vi.fn(), study:vi.fn(), pending:vi.fn(), process:vi.fn(), provider:vi.fn()}));
vi.mock('pg',()=>({Pool:class { constructor(){mocks.pool();} }}));
vi.mock('@/lib/ai-store/shadow',()=>({ShadowStore:class {getStudy=mocks.study;pending=mocks.pending}}));
vi.mock('@/lib/ai-budget/pg',()=>({PgBudgetStore:class {}}));
vi.mock('@/lib/ai-shadow/outcome-runner',()=>({processShadowOutcomes:vi.fn().mockResolvedValue({closed:0,cancelled:0,waiting:0,invalid:0})}));
vi.mock('@/lib/ai-shadow/processor',async (importOriginal)=>({...await importOriginal<typeof import('@/lib/ai-shadow/processor')>(),processShadowIdea:mocks.process,shadowOpenAiProvider:mocks.provider}));
import { GET } from '@/app/api/ai/shadow/cron/route';
const secret='a'.repeat(40);
const request=(s:string)=>new Request('http://localhost/api/ai/shadow/cron',{headers:{authorization:s}});
const saved={...process.env};
beforeEach(()=>{vi.clearAllMocks();process.env.AI_SHADOW_CRON_SECRET=secret;process.env.AI_SHADOW_ENABLED='true';process.env.AI_SHADOW_STUDY_ID='study';process.env.OPENAI_API_SECRET='test';process.env.AI_DATABASE_URL='postgres://example';mocks.study.mockResolvedValue({id:'study'});mocks.pending.mockResolvedValue([{key:'idea'}]);mocks.provider.mockReturnValue(vi.fn());mocks.process.mockResolvedValue({status:'decided'});});
afterEach(()=>{process.env=saved;});
describe('shadow scheduler route',()=>{
  it('rejects unauthenticated requests before any database or provider call',async()=>{
    expect((await GET(request('Bearer invalid'))).status).toBe(401);
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it('does nothing unless explicitly enabled',async()=>{
    process.env.AI_SHADOW_ENABLED='false';
    expect(await (await GET(request(`Bearer ${secret}`))).json()).toEqual({status:'disabled'});
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it('loads only a preregistered study and processes a bounded batch',async()=>{
    const response=await GET(request(`Bearer ${secret}`));
    expect(await response.json()).toEqual({status:'ok',processed:1,results:['decided'],outcomes:{closed:0,cancelled:0,waiting:0,invalid:0}});
    expect(mocks.pending).toHaveBeenCalledWith({id:'study'},1);
    expect(mocks.process).toHaveBeenCalledOnce();
    mocks.study.mockResolvedValue(null);
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503);
  });
});
