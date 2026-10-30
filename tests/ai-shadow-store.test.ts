import { describe, expect, it, vi } from 'vitest';
import { SHADOW_STUDY_CONFIG, ShadowStore } from '../lib/ai-store/shadow';
import { captureShadowIdea } from '../lib/ai-shadow/study';
import { stableHash } from '../lib/experiment/hash';

const heartbeat = (time: string) => `activity_v1=${JSON.stringify({version:1,codeSha:null,observedAt:time,marketAsOf:{MES:time},tradingDay:'2026-10-30',state:'ideas-available',reasonCodes:[],pausedStreams:[],simulatedIdeas:1,eligibleIdeas:1})}`;

describe('private shadow evidence store', () => {
  it('accepts only the exact frozen study configuration', async () => {
    const row={id:'study',registered_at:new Date('2026-10-30T10:00:00Z'),model:'gpt-6.1-sol',prompt_version:'shadow-v1',feature_version:'shadow-features-v1',config:SHADOW_STUDY_CONFIG};
    const query=vi.fn().mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{...row,config:{...SHADOW_STUDY_CONFIG,costVersion:'other'}}]});
    const store=new ShadowStore({query});
    expect((await store.getStudy('study'))?.id).toBe('study');
    expect(await store.getStudy('study')).toBeNull();
  });
  it('claims eligible first receipts exactly once using a unique event', async () => {
    const query=vi.fn().mockResolvedValueOnce({rows:[{event_key:'x'}]}).mockResolvedValueOnce({rows:[]});
    const store=new ShadowStore({query});
    expect(await store.claim('study','key',1793368800000)).toBe(true);
    expect(await store.claim('study','key',1793368800000)).toBe(false);
    expect(query.mock.calls[0][0]).toMatch(/eligibility\s*=\s*'eligible'/i);
    expect(query.mock.calls[0][0]).toMatch(/ON CONFLICT\s*\(event_key\) DO NOTHING/i);
    expect(query.mock.calls[0][1][0]).toBe(query.mock.calls[1][1][0]);
  });
  it('uses authoritative source and observed bar freshness, normalizing postgres numerics', async () => {
    const time='2026-10-30T10:00:00.000Z';
    const query=vi.fn().mockResolvedValue({rows:[{status:'triggered',stale_data:false,orphaned:false,suppressed:false,symbol:'MES',entry_price:'100',stop_price:'98',target_price:'104',message:heartbeat(time)}]});
    const result=await new ShadowStore({query}).sourceState('key');
    expect(result).toEqual({status:'triggered',stale:false,orphaned:false,suppressed:false,dataAsOf:Date.parse(time)/1000,setupHash:stableHash({entry:100,stop:98,target:104})});
    expect(query.mock.calls[0][0]).toMatch(/exit_ts IS NULL/i);
    expect(query.mock.calls[0][1]).toEqual(['key']);
  });
  it('fails closed for missing heartbeat, invalid levels or unavailable source', async () => {
    const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{status:'triggered',stale_data:false,orphaned:false,suppressed:false,symbol:'MES',entry_price:'bad',stop_price:'98',target_price:null,message:null}]});
    const store=new ShadowStore({query});
    expect(await store.sourceState('key')).toBeNull();
    expect(await store.sourceState('key')).toBeNull();
  });
  it('rejects pending payloads whose identity differs from immutable receipt metadata', async () => {
    const observed=1793355300;
    const input={key:'key',symbol:'MES' as const,side:'LONG' as const,strategy:'orb',tier:'A' as const,status:'triggered',signalTs:observed-300,observedAt:observed,dataAsOf:observed,stale:false,orphaned:false,suppressed:false,entry:100,stop:98,target:104,score:1,rr:2};
    const captured=captureShadowIdea(input,observed-600);
    if (captured.kind!=='eligible') throw new Error(captured.reason);
    const row={opportunity_key:'different',symbol:'MES',side:'LONG',observed_at:new Date(observed*1000),source_signal_at:new Date((observed-300)*1000),data_as_of:new Date(observed*1000),source_paused:false,source_fresh:true,payload:captured.snapshot};
    const query=vi.fn().mockResolvedValue({rows:[row,{...row,opportunity_key:'key'}]});
    const study={id:'study',registeredAt:observed-600,model:'gpt-6.1-sol',promptVersion:'shadow-v1',featureVersion:'shadow-features-v1'};
    expect(await new ShadowStore({query}).pending(study,10)).toEqual([input]);
  });
  it('records a single immutable terminal event and refuses duplicates', async () => {
    const query=vi.fn().mockResolvedValueOnce({rows:[{event_key:'x'}]}).mockResolvedValueOnce({rows:[]});
    const store=new ShadowStore({query});
    const event={studyId:'study',key:'key',kind:'decision' as const,at:1793368800000,payload:{decision:'skip'}};
    await store.append(event);
    await expect(store.append(event)).rejects.toThrow();
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO public.ai_shadow_events/i);
  });
});
