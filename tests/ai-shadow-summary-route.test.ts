import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({verify:vi.fn(),study:vi.fn(),read:vi.fn(),pool:vi.fn()}));
vi.mock('pg',()=>({Pool:class {constructor(){mocks.pool();}}}));
vi.mock('@/lib/ai-auth/verify',()=>({verifyNeonResearchUser:mocks.verify}));
vi.mock('@/lib/ai-store/shadow',()=>({ShadowStore:class {getStudy=mocks.study}}));
vi.mock('@/lib/ai-shadow/summary',()=>({readShadowSummary:mocks.read}));
import {GET} from '@/app/api/ai/shadow/summary/route';
const saved={...process.env};
beforeEach(()=>{vi.clearAllMocks();process.env.AI_DATABASE_URL='postgres://example';process.env.AI_SHADOW_STUDY_ID='study';mocks.verify.mockResolvedValue({ok:true,userId:'user'});mocks.study.mockResolvedValue({id:'study'});mocks.read.mockResolvedValue({status:'available'});});
afterEach(()=>{process.env=saved;});
const req=()=>new Request('http://localhost/api/ai/shadow/summary');
describe('shadow summary authorization',()=>{
  it('requires a signed-in user before reading the study',async()=>{
    mocks.verify.mockResolvedValue({ok:false,status:401,error:'Sign in'});
    const res=await GET(req());expect(res.status).toBe(401);expect(mocks.pool).not.toHaveBeenCalled();expect(mocks.study).not.toHaveBeenCalled();
  });
  it('says not-configured without exposing a database and returns authorized summary with no caching',async()=>{
    delete process.env.AI_SHADOW_STUDY_ID;
    const missing=await GET(req());expect(await missing.json()).toEqual({status:'not-configured'});expect(mocks.pool).not.toHaveBeenCalled();
    process.env.AI_SHADOW_STUDY_ID='study';const res=await GET(req());expect(await res.json()).toEqual({status:'available'});expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
