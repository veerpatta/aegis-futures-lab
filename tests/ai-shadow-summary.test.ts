import { describe,expect,it,vi } from 'vitest';
import { readShadowSummary } from '@/lib/ai-shadow/summary';
import type { ShadowStudy } from '@/lib/ai-shadow/processor';
const study:ShadowStudy={id:'study',registeredAt:1790000000,model:'gpt-6.1-sol',promptVersion:'shadow-v1',featureVersion:'shadow-features-v1'};
const snapshot=(key:string,suppressed=false)=>({key,entry:6000,stop:5990,target:6020,suppressed,observedAt:1793442000});
const row=(key:string,net:number)=>({opportunity_key:key,observed_at:new Date('2026-10-30T15:00:00Z'),eligibility:'eligible',payload:snapshot(key),decision_payload:{decision:{decision:'take',rationale:'ok'}},outcome_payload:{status:'closed',trade:{net}},invalidation_kind:null,source_key:key,orphaned:false,entry_price:6000,stop_price:5990,target_price:6020,bar_revised:false});
describe('shadow summary',()=>{
 it('uses only current valid outcomes and never includes paused observations in controls',async()=>{
  const rows=[row('a',20),{...row('b',100),bar_revised:true},{...row('c',100),orphaned:true},{...row('d',100),payload:snapshot('d',true)},{...row('e',100),outcome_payload:null},{...row('f',100),eligibility:'rejected'}];
  const query=vi.fn(async(_sql:string,_values:unknown[])=>({rows}));
  const summary=await readShadowSummary({query},study);
  expect(summary).toMatchObject({rejected:1,invalidated:2,unresolved:1,comparison:{eligible:5,scored:4,resolved:1,modelNet:20,takeAllNet:20,verdict:'inconclusive'}});
  expect(query.mock.calls[0][0]).toContain('ai_shadow_bar_revisions');
 });
 it('treats a valid cancelled entry as zero for all matched controls',async()=>{
  const cancelled={...row('a',10),outcome_payload:{status:'cancelled',trade:{net:null}}};
  const result=await readShadowSummary({query:async()=>({rows:[cancelled]})},study);
  expect(result).toMatchObject({cancelled:1,comparison:{resolved:1,modelNet:0,takeAllNet:0}});
 });
});
