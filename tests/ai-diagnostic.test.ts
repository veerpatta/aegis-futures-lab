import { describe, expect, it, vi } from 'vitest';
import { budgetedRequest, worstCaseMicros } from '@/lib/ai-budget';
import { callDiagnostic, DIAGNOSTIC_INPUT_LIMIT, DIAGNOSTIC_OUTPUT_LIMIT, DIAGNOSTIC_REQUEST_ID, makeDiagnosticPost } from '@/lib/ai-research/diagnostic';
import { shadowOpenAiProvider } from '@/lib/ai-shadow/processor';
import { requestOneTimeAiCheck } from '@/components/bot/OwnerControls';

const price={model:'gpt-6.1-sol',inputMicrosPerMillion:13_200_000,outputMicrosPerMillion:66_000_000,verifiedAt:1,expiresAt:10000};
const budgetRequest={requestId:DIAGNOSTIC_REQUEST_ID,userId:'owner',model:'gpt-6.1-sol',inputLimit:DIAGNOSTIC_INPUT_LIMIT,outputLimit:DIAGNOSTIC_OUTPUT_LIMIT,price,now:100};
const good = () => new Request('https://example.test/api/ai/diagnostic',{method:'POST'});
describe('one-time AI connectivity diagnostic',()=>{
  it('never invokes the provider for an unauthorized caller',async()=>{
    const run=vi.fn();const handler=makeDiagnosticPost({authenticate:async()=>({ok:false,status:401,error:'Sign in'}),run});
    expect((await handler(good())).status).toBe(401);expect(run).not.toHaveBeenCalled();
  });
  it('uses only the fixed synthetic prompt, standard tier and a 128-token output cap',async()=>{
    let sent:Record<string,unknown>={};
    const transport:typeof fetch=async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response(JSON.stringify({status:'completed',service_tier:'default',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:8,output_tokens:3}}));};
    const result=await callDiagnostic('test-key',transport);
    expect(sent).toEqual({model:'gpt-6.1-sol',service_tier:'default',store:false,max_output_tokens:128,input:'Reply OK.',reasoning:{effort:'low'}});
    expect(JSON.stringify(sent)).not.toContain('test-key');expect(result.value.status).toBe('connected');expect(result.usage).toEqual({inputTokens:8,outputTokens:3});
    expect(worstCaseMicros(budgetRequest)).toBe(9768);
  });
  it('does not leak provider errors and retains an uncertain reservation',async()=>{
    const transport:typeof fetch=async()=>new Response(JSON.stringify({error:{code:'invalid_api_key',message:'private key text'}}),{status:401});
    const store={reserve:vi.fn(async()=>({id:DIAGNOSTIC_REQUEST_ID})),settle:vi.fn()};
    await expect(budgetedRequest(store,budgetRequest,()=>callDiagnostic('test-key',transport))).rejects.toMatchObject({status:401,code:'invalid_api_key'});
    expect(store.settle).not.toHaveBeenCalled();
    const handler=makeDiagnosticPost({authenticate:async()=>({ok:true,userId:'owner'}),run:async()=>{throw new Error('private key text');}});
    const res=await handler(good());expect(res.status).toBe(503);expect(await res.text()).not.toContain('private');
  });
  it('allows at most one concurrent invocation and no retry',async()=>{
    let claimed=false,calls=0;
    const store={reserve:async()=>{if(claimed)throw Error('Request already reserved; do not retry the provider call.');claimed=true;return{id:DIAGNOSTIC_REQUEST_ID};},settle:async()=>{}};
    const run=async()=>{const v=await budgetedRequest(store,budgetRequest,async()=>{calls++;return{value:'connected' as const,usage:{inputTokens:8,outputTokens:3}};});return{status:v,inputTokens:8,outputTokens:3,countedMicrodollars:51};};
    const handler=makeDiagnosticPost({authenticate:async()=>({ok:true,userId:'owner'}),run});
    const responses=await Promise.all([handler(good()),handler(good())]);
    expect(responses.map(x=>x.status).sort()).toEqual([200,409]);expect(calls).toBe(1);
    expect((await handler(good())).status).toBe(409);expect(calls).toBe(1);
  });
  it('requires the shadow provider to request the standard tier',async()=>{
    let sent:Record<string,unknown>={};
    const transport:typeof fetch=async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}],usage:{input_tokens:3,output_tokens:2}}));};
    await shadowOpenAiProvider('test-key',transport)({} as never);
    expect(sent.service_tier).toBe('default');
  });
  it('uses the existing signed-in session and reports the one-time result safely',async()=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({status:'connected',inputTokens:8,outputTokens:3,countedMicrodollars:304}),{status:200}));
    expect(await requestOneTimeAiCheck('test-session',transport)).toContain('OpenAI responded');
    expect(transport).toHaveBeenCalledWith('/api/ai/diagnostic',expect.objectContaining({method:'POST',headers:{Authorization:'Bearer test-session'}}));
    const already=vi.fn(async()=>new Response('{}',{status:409}));
    expect(await requestOneTimeAiCheck('test-session',already)).toContain('already attempted');
  });
});
