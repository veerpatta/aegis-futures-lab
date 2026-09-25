import {describe,it,expect} from "vitest";
import {botState,freshTraining,type BotOverview} from "@/lib/paper/overview";
import {reserveCost} from "@/scripts/engine/databento-purchase";
const base:BotOverview={account:{equity:10000,peak:10000,daily_pnl:0,open_risk:0,locked:false,day_key:"2026-09-25",updated_at:"2026-09-25"},release:null,positions:[],learning:null,model:null};
describe("trader status",()=>{
 it("does not confuse research with account activity",()=>expect(botState(base).label).toBe("Researching"));
 it("distinguishes probation and active",()=>{for(const status of ["probation","active"] as const)expect(botState({...base,release:{candidate_key:"x",status,reason:"passed",activated_at:"2026-09-25"}}).label).toBe(status==="probation"?"Paper probation":"Paper active");});
 it("risk lock outranks an active release",()=>expect(botState({...base,account:{...base.account!,locked:true},release:{candidate_key:"x",status:"active",reason:"passed",activated_at:"2026-09-25"}}).label).toBe("Paused"));
 it("failed reads are unknown even if the cached release was active",()=>expect(botState(base,true).label).toBe("Status unavailable"));
 it("absent account is not a zero balance",()=>expect(botState({...base,account:null}).label).toBe("Status unavailable"));
 it("successful but old training is stale",()=>expect(freshTraining({status:"ok",finished_at:"2026-09-01",started_at:"2026-09-01"},Date.parse("2026-09-25"))).toBe(false));
 it("a failed recent training is not healthy",()=>expect(freshTraining({status:"error",finished_at:"2026-09-25",started_at:"2026-09-25"},Date.parse("2026-09-25"))).toBe(false));
});
describe("credit reservations",()=>{
 it("reserves a quarter beyond the quote",()=>expect(reserveCost(.4,0)).toBe(.5));
 it("counts earlier purchases and in-flight reservations",()=>expect(()=>reserveCost(3,100)).toThrow());
 it("blocks invalid quotes",()=>{for(const v of [NaN,Infinity,-1])expect(()=>reserveCost(v,0)).toThrow();});
});
