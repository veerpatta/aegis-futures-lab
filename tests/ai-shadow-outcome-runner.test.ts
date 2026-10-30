import { describe, expect, it, vi } from 'vitest';
import { processShadowOutcomes } from '@/lib/ai-shadow/outcome-runner';
import { captureShadowIdea, type ShadowSourceIdea } from '@/lib/ai-shadow/study';
const responseAt=Date.parse('2026-10-07T15:02:00Z')/1000, first=Date.parse('2026-10-07T15:05:00Z')/1000;
const idea:ShadowSourceIdea={key:'x',symbol:'MES',side:'LONG',strategy:'zone',tier:'A',status:'triggered',signalTs:responseAt-900,observedAt:responseAt-300,dataAsOf:responseAt-300,stale:false,orphaned:false,suppressed:false,entry:6000,stop:5990,target:6020,score:3,rr:2};
const result=captureShadowIdea(idea,responseAt-1000);
if(result.kind!=='eligible') throw new Error('invalid fixture');
const decision={opportunity_key:'x',payload:result.snapshot,decision_payload:{responseAt,decision:{decision:'skip',rationale:'test'}},orphaned:false,entry_price:6000,stop_price:5990,target_price:6020};
const bar={bar_time:first,symbol:'MES',source:'yahoo',open:6000,high:6021,low:5998,close:6000,observed_at:new Date((first+301)*1000),revised:false};
function setup(currentBar:typeof bar|null,source=decision){const query=vi.fn(async(sql:string,values:unknown[])=>{
  if(sql.includes('outcome-invalidated')) return {rows:[]};
  if(sql.includes('FROM public.ai_shadow_snapshots s JOIN')) return {rows:[source]};
  if(sql.includes('FROM public.ai_shadow_bars b')) return {rows:currentBar?[currentBar]:[]};
  if(sql.includes('VALUES($1,$2,$3,$4')) return {rows:[{event_key:values[0]}]};
  throw Error('Unexpected SQL');
});return {query};}
describe('shadow outcome materialization',()=>{
  it('appends a virtual result for skip on the same rules as take',async()=>{
    const db=setup(bar); expect(await processShadowOutcomes(db,'study',first+500)).toMatchObject({closed:1});
    const event=db.query.mock.calls.find(c=>c[0].includes('VALUES($1,$2,$3,$4'))!;
    const payload=JSON.parse(event[1][4] as string);
    expect(payload).toMatchObject({status:'closed',firstBar:first,trade:{exitReason:'target'}});
    expect(db.query.mock.calls.map(c=>c[0]).join('\n')).not.toContain('bars_5m');
  });
  it('leaves missing bars unresolved and invalidates revisions or orphaned source',async()=>{
    expect(await processShadowOutcomes(setup(null),'study',first+500)).toMatchObject({waiting:1});
    expect(await processShadowOutcomes(setup(null),'study',first+49*3600)).toMatchObject({invalid:1});
    expect(await processShadowOutcomes(setup({...bar,revised:true}),'study',first+500)).toMatchObject({invalid:1});
    expect(await processShadowOutcomes(setup(bar,{...decision,orphaned:true}),'study',first+500)).toMatchObject({invalid:1});
  });
});
