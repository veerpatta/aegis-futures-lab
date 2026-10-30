import { describe, it, expect } from 'vitest';
import { authorizeShadowScheduler, processShadowIdea } from '@/lib/ai-shadow/processor';
import type { ShadowSourceIdea } from '@/lib/ai-shadow/study';
import { stableHash } from '@/lib/experiment/hash';
const idea:ShadowSourceIdea={key:'A:zone:MES:1',symbol:'MES',side:'LONG',strategy:'zone',tier:'A',status:'triggered',signalTs:1793441100,observedAt:1793442000,dataAsOf:1793441700,stale:false,orphaned:false,suppressed:false,entry:6000,stop:5990,target:6020,score:4,rr:2};
const model='gpt-6.1-sol';
const study={id:'study-1',registeredAt:1793440000,model,promptVersion:'shadow-v1',featureVersion:'shadow-features-v1'};
const price={model,inputMicrosPerMillion:2000000,outputMicrosPerMillion:10000000,verifiedAt:1793440000000,expiresAt:1794000000000};
const setupHash=stableHash({entry:idea.entry,stop:idea.stop,target:idea.target});
function fixture() {
  let now=1793442010000,calls=0,claimed=false,reads=0;
  const events: {kind:string;payload:Record<string,unknown>}[]=[];
  const store={claim:async()=>{if(claimed)return false;claimed=true;return true;},sourceState:async()=>{reads++;return {status:'triggered',stale:false,orphaned:false,suppressed:false,dataAsOf:1793442000,setupHash};},append:async(e:{kind:string;payload:Record<string,unknown>})=>{events.push(e);}};
  const budget={reserve:async(x:{id:string})=>({id:x.id}),settle:async()=>{}};
  const provider=async(_input:unknown)=>{calls++;now+=1000;return {value:JSON.stringify({decision:'take',rationale:'testable'}),usage:{inputTokens:100,outputTokens:20}};};
  return {store,budget,provider,clock:()=>now,price,events,calls:()=>calls,reads:()=>reads};
}
describe('shadow processor isolation',()=>{
 it('uses a constant-time, fail-closed scheduler secret',()=>{
  const secret='x'.repeat(40);
  expect(authorizeShadowScheduler(`Bearer ${secret}`,secret)).toBe(true);
  expect(authorizeShadowScheduler('Bearer wrong',secret)).toBe(false);
  expect(authorizeShadowScheduler('Bearer x','x')).toBe(false);
 });
 it('scores once after budget reservation and only transmits sanitized features',async()=>{
  const f=fixture();let payload=''; const provider=async(input:unknown)=>{payload=JSON.stringify(input);return f.provider(input);};
  const result=await processShadowIdea({study,idea},{...f,provider});
  expect(result.status).toBe('decided');expect(f.calls()).toBe(1);expect(f.reads()).toBe(2);
  expect(payload).not.toContain('6000');expect(payload).not.toContain('5990');expect(payload).not.toContain('pnl');
  expect(f.events.map(e=>e.kind)).toContain('decision');
  expect((await processShadowIdea({study,idea},f)).status).toBe('duplicate');expect(f.calls()).toBe(1);
 });
 it('does not call the model when the source is stale or already closed',async()=>{
  const f=fixture();f.store.sourceState=async()=>({status:'hit_stop',stale:false,orphaned:false,suppressed:false,dataAsOf:1793442000,setupHash});
  expect((await processShadowIdea({study,idea},f)).status).toBe('skipped');expect(f.calls()).toBe(0);
 });
 it('quarantines a model result when source revision occurs while the call is running',async()=>{
  const f=fixture();let n=0;f.store.sourceState=async()=>({status:'triggered',stale:false,orphaned:++n>1,suppressed:false,dataAsOf:1793442000,setupHash});
  expect((await processShadowIdea({study,idea},f)).status).toBe('quarantined');expect(f.events.some(e=>e.kind==='decision')).toBe(false);
 });
 it('records a paused opportunity but never calls the model or simulates it',async()=>{
  const f=fixture();const paused={...idea,suppressed:true};f.store.sourceState=async()=>({status:'triggered',stale:false,orphaned:false,suppressed:true,dataAsOf:1793442000,setupHash});
  expect((await processShadowIdea({study,idea:paused},f)).status).toBe('skipped');expect(f.calls()).toBe(0);
 });
 it('fails closed on budget failure without contacting the provider',async()=>{
  const f=fixture();f.budget.reserve=async()=>{throw new Error('exhausted');};
  expect((await processShadowIdea({study,idea},f)).status).toBe('error');expect(f.calls()).toBe(0);
 });
});
