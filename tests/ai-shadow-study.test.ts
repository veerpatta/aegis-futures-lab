import { describe, it, expect } from 'vitest';
import { captureShadowIdea, parseShadowDecision, nextShadowBar, compareShadowResults } from '@/lib/ai-shadow/study';
import type { ShadowSourceIdea } from '@/lib/ai-shadow/study';

const signal: ShadowSourceIdea & {exit_ts:string; pnl_usd:number} = { key:'A:zone:MES:1', symbol:'MES', side:'LONG', strategy:'zone', tier:'A', status:'triggered',
  signalTs:1793441100, observedAt:1793442000, dataAsOf:1793441700, stale:false, orphaned:false, suppressed:true,
  entry:6000, stop:5990, target:6020, score:4, rr:2, exit_ts:'SECRET', pnl_usd:999 };

describe('prospective isolated shadow research', () => {
  it('retains a paused idea and removes outcomes and raw prices from model input', () => {
    const result = captureShadowIdea(signal,1793440000);
    expect(result.kind).toBe('eligible');
    if(result.kind==='eligible') {
      expect(result.snapshot.suppressed).toBe(true);
      const body=JSON.stringify(result.snapshot.modelInput);
      for(const forbidden of ['SECRET','pnl_usd','exit_ts','6000','5990','6020']) expect(body).not.toContain(forbidden);
    }
  });
  it('rejects closed, stale, revised, late, missing and pre-study data', () => {
    const reason=(row:ShadowSourceIdea, started=1793440000)=>captureShadowIdea(row,started).reason;
    expect(reason({...signal,status:'hit_stop'})).toBe('already-closed');
    expect(reason({...signal,stale:true})).toBe('stale');
    expect(reason({...signal,orphaned:true})).toBe('revised');
    expect(reason({...signal,observedAt:1793450000})).toBe('late');
    expect(reason({...signal,dataAsOf:null})).toBe('missing-data');
    expect(reason(signal,1793442001)).toBe('before-study');
  });
  it('rejects malformed or unbounded AI output', () => {
    expect(parseShadowDecision({decision:'take',rationale:'The snapshot is consistent.'})).toEqual({decision:'take',rationale:'The snapshot is consistent.'});
    expect(parseShadowDecision({decision:'buy',rationale:'x'})).toBeNull();
    expect(parseShadowDecision({decision:'take',rationale:'x'.repeat(1201)})).toBeNull();
    expect(parseShadowDecision({decision:'take',rationale:'x',trade:true})).toBeNull();
  });
  it('cannot use a bar whose open preceded the model response or was not received', () => {
    const responseAt=1793442000;
    const bars=[{time:1793441700,observedAt:1793442100},{time:1793442000,observedAt:1793442400},{time:1793442300,observedAt:1793442700}];
    expect(nextShadowBar(bars,responseAt,1793442300)).toBeNull();
    expect(nextShadowBar(bars,responseAt,1793442500)).toBeNull();
    expect(nextShadowBar(bars,responseAt,1793442800)).toEqual(bars[2]);
    expect(nextShadowBar(bars,1793442001,1793442800)).toEqual(bars[2]);
  });
  it('uses the same resolved scored cases for all controls and reports abstention and coverage', () => {
    const data=[{key:'a',session:'2026-10-30',decision:'take',net:20},{key:'b',session:'2026-10-30',decision:'skip',net:-10},{key:'c',session:'2026-10-30',decision:'abstain',net:5},{key:'d',session:'2026-10-30',decision:null,net:30},{key:'e',session:'2026-10-30',decision:'take',net:null}] as const;
    const result=compareShadowResults(data,'study-seed',100);
    expect(result).toMatchObject({ eligible:5,scored:4,resolved:3,abstained:1,taken:1,modelNet:20,takeAllNet:15,noTradeNet:0 });
    expect(result.randomN).toBe(1);
    expect(compareShadowResults(data,'study-seed',100)).toEqual(result);
    expect(compareShadowResults([...data].reverse(),'study-seed',100)).toEqual(result);
    expect(()=>compareShadowResults([...data,data[0]],'study-seed',100)).toThrow(/duplicate/i);
  });
});
