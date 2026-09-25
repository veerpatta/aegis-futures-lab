import { describe, expect, it } from "vitest";
import { databaseValue } from "@/lib/neon/server";
import { buildModelRows, type RealTrainRow } from "@/scripts/engine/train-set";
import { marketContexts, vwapPullback } from "@/lib/strategies/research-v2";
import { sizePaperTrade, freshWeeklyEvidence, releaseEligible, type ForwardEvidence } from "@/lib/paper/policy";
import { exitForPaper } from "@/scripts/engine/paper-broker";
import { featuresV2 } from "@/scripts/engine/winprob-v2";
import { normalizerOf, type ModelRow } from "@/scripts/engine/winprob";
import type { Bar } from "@/lib/types";
import fixture from "./fixtures/bars-mes.json";

describe("training recovery boundaries",()=>{
  it("encodes coefficient and calibration arrays as JSON without corrupting PostgreSQL text arrays",()=>{
    expect(databaseValue("coefficients",[.2,-.3])).toBe("[0.2,-0.3]");
    expect(databaseValue("calibration",[{n:10}])).toBe('[{"n":10}]');
    expect(databaseValue("symbols",["MES","MNQ"])).toEqual(["MES","MNQ"]);
    expect(databaseValue("coefficients",null)).toBeNull();
  });
  const row:RealTrainRow={tier:"A",symbol:"MES",dedupe_key:"A:zone-v5:MES:1",signal_ts:"2026-09-01T14:00:00Z",exit_ts:"2026-09-01T16:00:00Z",regime:null,vix_bucket:null,score:4,rr:2,pnl_usd:20,fill_confidence:"clean"};
  it("cannot learn from a later exit, unknown exit or reversed interval",()=>{
    expect(buildModelRows([row],[],"2026-09-01T15:00:00Z")).toHaveLength(0);
    expect(buildModelRows([{...row,exit_ts:null}],[],"2026-09-02T00:00:00Z")).toHaveLength(0);
    expect(buildModelRows([{...row,exit_ts:"2026-09-01T13:00:00Z"}],[],"2026-09-02T00:00:00Z")).toHaveLength(0);
    expect(buildModelRows([row],[],"2026-09-02T00:00:00Z")[0]).toMatchObject({symbol:"MES",strategy:"zone-v5",exit_ts:row.exit_ts});
  });
  it("does not label overnight trading as the morning session in v2",()=>{
    const r:ModelRow={...row,signal_ts:"2026-09-01T06:00:00Z"};
    expect(featuresV2(r,normalizerOf([r]))[11]).toBe(0);
  });
  it("future bars cannot change past context or VWAP pullback decisions",()=>{
    const bars=(fixture.bars as Bar[]).slice(0,1800),prefix=bars.slice(0,1200);
    expect(marketContexts(bars).slice(0,prefix.length)).toEqual(marketContexts(prefix));
    const execution={cost:2.4,slippage:.25,maxRisk:50,sizing:"risk" as const};
    const full=vwapPullback.prepare({MES:bars},{},execution),past=vwapPullback.prepare({MES:prefix},{},execution);
    for(let i=0;i<prefix.length;i++){
      const snap={time:prefix[i].time,bySymbol:{MES:{bars:prefix,index:i}}};
      expect(vwapPullback.onSnapshot(full,snap,{},()=>{})).toEqual(vwapPullback.onSnapshot(past,snap,{},()=>{}));
    }
  });
});
describe("paper portfolio gates",()=>{
  const state={equity:10000,peak:10000,dailyPnl:0,openRisk:0,locked:false};
  it("counts costs and concurrent risk, and refuses oversized single contracts",()=>{
    expect(sizePaperTrade(state,26,true).qty).toBe(0);
    expect(sizePaperTrade(state,24,true).qty).toBe(1);
    expect(sizePaperTrade({...state,openRisk:90},12,false).qty).toBe(0);
    expect(sizePaperTrade({...state,dailyPnl:-190},12,false).qty).toBe(0);
  });
  it("keeps a drawdown lock even if equity later recovers",()=>{
    expect(sizePaperTrade({...state,equity:9000},10,false).qty).toBe(0);
    expect(sizePaperTrade({...state,locked:true},10,false).qty).toBe(0);
    expect(sizePaperTrade({...state,dailyPnl:NaN},10,false).qty).toBe(0);
  });
  const evidence:ForwardEvidence={closed:60,days:20,net:200,pf:1.4,fingerprint:"first",evaluatedAt:"2026-09-01T00:00:00Z"};
  it("a rerun or a week with no new trades cannot promote",()=>{
    expect(freshWeeklyEvidence(evidence,{...evidence,evaluatedAt:"2026-09-08T00:00:00Z"})).toBe(false);
    expect(freshWeeklyEvidence(evidence,{...evidence,closed:70,fingerprint:"new",evaluatedAt:"2026-09-02T00:00:00Z"})).toBe(false);
    expect(freshWeeklyEvidence(evidence,{...evidence,closed:70,fingerprint:"new",evaluatedAt:"2026-09-08T00:00:00Z"})).toBe(true);
    expect(releaseEligible({},200,evidence,{...evidence,closed:70,fingerprint:"new",evaluatedAt:"2026-09-08T00:00:00Z"})).toBe(false);
  });
  it("fills a gap through a stop at the traded open and resolves ambiguous bars stop-first",()=>{
    const p={symbol:"MES",side:"LONG" as const,stop:100,target:110};
    const b={time:Date.parse("2026-09-01T15:00:00Z")/1000,open:95,high:111,low:94,close:105};
    const exit=exitForPaper(p,b)!;
    expect(exit.reason).toBe("Stop");expect(exit.price).toBeLessThan(95);
    expect(exitForPaper(p,{...b,open:105,low:99})?.reason).toBe("Stop");
  });
});
