import { describe, expect, it } from 'vitest';
import { evaluateShadowOutcome, type ReceivedShadowBar } from '@/lib/ai-shadow/outcome';
import { captureShadowIdea, type ShadowSourceIdea } from '@/lib/ai-shadow/study';

const responseAt=Date.parse('2026-10-07T15:02:00Z')/1000;
const idea:ShadowSourceIdea={key:'x',symbol:'MES',side:'LONG',strategy:'zone',tier:'A',status:'triggered',signalTs:responseAt-900,observedAt:responseAt-300,dataAsOf:responseAt-300,stale:false,orphaned:false,suppressed:false,entry:6000,stop:5990,target:6020,score:3,rr:2};
const captured=captureShadowIdea(idea,responseAt-1000);
if(captured.kind!=='eligible') throw new Error('Bad test fixture');
const snapshot=captured.snapshot;
const bar=(at:number,hi=6002,lo=5998):ReceivedShadowBar=>({symbol:'MES',source:'yahoo',time:at,observedAt:at+301,open:6000,high:hi,low:lo,close:6000});
const first=Date.parse('2026-10-07T15:05:00Z')/1000;
const evaluate=(bars:ReceivedShadowBar[], now=first+1000)=>evaluateShadowOutcome({snapshot,responseAt,source:'yahoo',bars,now});

describe('prospective shadow outcomes',()=>{
  it('waits for the first actual future bar receipt; never fills from the response bar or an unreceived bar',()=>{
    expect(evaluate([bar(first-300),bar(first)],first+300).status).toBe('waiting');
    expect(evaluate([bar(first-300)],first+1000).status).toBe('waiting');
    expect(evaluate([bar(first,6021,5998)],first+301)).toMatchObject({status:'closed',trade:{fillTs:first,exitReason:'target'}});
  });
  it('uses the existing costs and conservative same-bar stop/target resolution',()=>{
    const result=evaluate([bar(first,6021,5989)]);
    expect(result).toMatchObject({status:'closed',trade:{exitReason:'stop',ambiguous:true,fees:2.4}});
    if(result.status==='closed') expect(result.trade.net).toBeLessThan(0);
  });
  it('does not skip missing or conflicting bars to improve results',()=>{
    expect(evaluate([bar(first+300,6021)])).toMatchObject({status:'waiting'});
    expect(evaluate([bar(first),bar(first+600,6021)])).toMatchObject({status:'waiting'});
    expect(evaluate([bar(first),bar(first,6021)])).toMatchObject({status:'invalid'});
  });
  it('rejects impossible receipt, source and price data and marks cancelled trades separately',()=>{
    expect(evaluate([{...bar(first),observedAt:first+299}])).toMatchObject({status:'invalid'});
    expect(evaluate([{...bar(first),source:'databento'}])).toMatchObject({status:'invalid'});
    expect(evaluate([{...bar(first),low:6001}])).toMatchObject({status:'invalid'});
    expect(evaluate([{...bar(first),open:5989,low:5988}])).toMatchObject({status:'cancelled',trade:{cancelReason:'stop-breached'}});
    expect(evaluateShadowOutcome({snapshot:{...snapshot,suppressed:true},responseAt,source:'yahoo',bars:[bar(first)],now:first+500})).toMatchObject({status:'invalid'});
  });
});
