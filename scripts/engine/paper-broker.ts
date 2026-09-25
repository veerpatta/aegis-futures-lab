/** Delayed simulation only. There is no broker API or real-money order path. */
import { transaction } from "@/lib/neon/server";
import type { Bar } from "@/lib/types";
import { PAPER_RISK, sizePaperTrade } from "@/lib/paper/policy";
import { researchCodeHash } from "./research-code";
import { researchConfigHash } from "./research-observer";
import { EXECUTION } from "./tiers";
import { slippagePointsAt } from "@/lib/costs/slippage";
import { nyMeta } from "@/lib/time/ny";
import { flattenMinuteNy, holidayFor } from "@/lib/market/holidays";
type Position={id:string;release_id:number;symbol:string;side:"LONG"|"SHORT";qty:number;entry:number;stop:number;target:number;risk:number;mark:number;opened_at:string;last_mark_ts:string|null;closed_at:string|null;pnl:number|null;reason:string};
const pv=(s:string)=>s==="MES"?5:2;
const slip=(s:string,t:number)=>slippagePointsAt(EXECUTION.friction!,s,t);
const value=(p:Position,price:number)=>(price-p.entry)*(p.side==="LONG"?1:-1)*pv(p.symbol)*p.qty-EXECUTION.cost*p.qty;
export function exitForPaper(p:Pick<Position,"side"|"stop"|"target"|"symbol">,b:Bar):{price:number;reason:string}|null {
  const long=p.side==="LONG",d=long?1:-1;
  if(long?b.low<=p.stop:b.high>=p.stop) return {price:(long?Math.min(b.open,p.stop):Math.max(b.open,p.stop))-d*slip(p.symbol,b.time),reason:"Stop"};
  if(long?b.high>=p.target:b.low<=p.target) return {price:p.target,reason:"Target"};
  const m=nyMeta(b.time);
  if(m.minutes>=flattenMinuteNy(m.dateKey,925) || holidayFor(m.dateKey)?.kind==="closed") return {price:b.close-d*slip(p.symbol,b.time),reason:"Session close"};
  return null;
}
export async function runPaperBroker(bySymbol:Record<string,Bar[]>,nowSec:number) {
  return transaction(async c=>{
    const account=(await c.query("SELECT * FROM paper_account WHERE id=1 FOR UPDATE")).rows[0];
    if(!account) throw new Error("Paper account missing");
    const release=(await c.query("SELECT * FROM paper_releases WHERE status IN ('probation','active') FOR UPDATE")).rows[0];
    const existing=(await c.query("SELECT * FROM paper_positions WHERE closed_at IS NULL FOR UPDATE")).rows as Position[];
    const resetIdleDay=async()=>{
      const today=nyMeta(nowSec).dateKey;
      if(account.day_key!==today) await c.query("UPDATE paper_account SET day_key=$1,day_start_equity=equity,daily_pnl=0,updated_at=now() WHERE id=1",[today]);
    };
    if(!release && !existing.length) {await resetIdleDay();return {active:false,positions:0};}
    const fresh=["MES","MNQ"].every(s=>bySymbol[s]?.length && nowSec-bySymbol[s].at(-1)!.time<=1800);
    const evaluation=release?(await c.query("SELECT evaluated_at,evidence FROM paper_evaluations WHERE id=$1",[release.evaluation_id])).rows[0]:null;
    const learning=(await c.query("SELECT finished_at FROM learning_runs WHERE status='ok' ORDER BY finished_at DESC LIMIT 1")).rows[0];
    const evidenceFresh=!!evaluation?.evidence?.pass && Date.now()-Date.parse(evaluation.evaluated_at)<8*86400000 &&
      !!learning?.finished_at && Date.now()-Date.parse(learning.finished_at)<4*86400000;
    let valid=!!release && release.config_hash===researchConfigHash && release.code_hash===researchCodeHash() && fresh && evidenceFresh && !account.locked;
    if(release && !valid) await c.query("UPDATE paper_releases SET status='paused',reason=$2 WHERE id=$1",[release.id,!fresh?"Price data is stale":!evidenceFresh?"Training or qualification evidence is stale":"Risk lock or registered code changed"]);
    const observations=valid?(await c.query(`SELECT o.* FROM research_observations o WHERE o.candidate_key=$1 AND provenance='forward'
      AND first_seen_at >= $2 AND code_hash=$3 AND config_hash=$4 AND intent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM paper_entry_decisions p WHERE p.observation_key=o.observation_key)
      ORDER BY signal_ts`,[release.candidate_key,release.activated_at,release.code_hash,release.config_hash])).rows:[];
    const pending=new Map(observations.map(o=>[Date.parse(o.signal_ts)/1000,o]));
    let realized=Number((await c.query("SELECT coalesce(sum(pnl),0) total FROM paper_positions WHERE closed_at IS NOT NULL")).rows[0].total);
    let equity=Number(account.equity),peak=Number(account.peak),day=String(account.day_key),dayStart=Number(account.day_start_equity),locked=!!account.locked;
    const positions:Position[]=existing.map(p=>({...p,qty:Number(p.qty),entry:Number(p.entry),stop:Number(p.stop),target:Number(p.target),risk:Number(p.risk),mark:Number(p.mark)}));
    const from=Math.max(account.last_bar_ts?Date.parse(account.last_bar_ts)/1000:0,Math.min(...positions.map(p=>Date.parse(p.last_mark_ts??p.opened_at)/1000),...pending.keys()));
    if(!Number.isFinite(from)) {await resetIdleDay();return {active:valid,positions:positions.length};}
    const timeline=[...new Set(Object.values(bySymbol).flatMap(bars=>bars.filter(b=>b.time>=from&&b.time+300<=nowSec).map(b=>b.time)))].sort((a,b)=>a-b);
    const indices=Object.fromEntries(Object.entries(bySymbol).map(([s,bars])=>[s,new Map(bars.map(b=>[b.time,b]))]));
    const finish=async(p:Position,price:number,time:number,reason:string)=>{
      p.pnl=value(p,price);realized+=p.pnl;p.closed_at=new Date((time+300)*1000).toISOString();p.mark=price;p.last_mark_ts=p.closed_at;
      await c.query("UPDATE paper_positions SET closed_at=$2,pnl=$3,mark=$4,last_mark_ts=$2,reason=reason||$5 WHERE id=$1",[p.id,p.closed_at,p.pnl,p.mark,` · ${reason}`]);
    };
    for(const time of timeline) {
      const m=nyMeta(time);
      if(m.dateKey!==day){day=m.dateKey;dayStart=equity;}
      const o=pending.get(time);
      let decision="Skipped: account is paused, locked, or outside its entry session";
      if(o && valid && !locked && m.minutes>=120 && m.minutes<flattenMinuteNy(m.dateKey,925) && holidayFor(m.dateKey)?.kind!=="closed") {
        const symbol=o.candidate_key.endsWith(":MES")?"MES":"MNQ",b=indices[symbol]?.get(time),s=o.intent;
        if(b && ["LONG","SHORT"].includes(s.side) && Number.isFinite(s.stop)) {
          const direction=s.side==="LONG"?1:-1,entry=b.open+direction*slip(symbol,time),distance=(entry-s.stop)*direction;
          const openRisk=positions.filter(p=>!p.closed_at).reduce((a,p)=>a+p.risk,0);
          const perRisk=distance*pv(symbol)+EXECUTION.cost+slip(symbol,time)*pv(symbol);
          decision="Skipped: entry bar or trade instruction is unavailable";
          const sized=sizePaperTrade({equity,peak,dailyPnl:equity-dayStart,openRisk,locked},perRisk,release.status==="probation");
          decision=distance<2?"Skipped: stop is too close or the market opened beyond it":sized.reason??"Paper entry opened within the account risk budget";
          if(distance>=2 && sized.qty>0){
            const ratio=release.candidate_key.includes("rsi-context")?1.5:2;
            const p:Position={id:o.observation_key,release_id:release.id,symbol,side:s.side,qty:sized.qty,entry,stop:s.stop,target:entry+direction*distance*ratio,
              risk:perRisk*sized.qty,mark:entry,opened_at:new Date(time*1000).toISOString(),last_mark_ts:null,closed_at:null,pnl:null,reason:String(s.reason??s.tags?.trigger??"Registered strategy passed every gate")};
            await c.query(`INSERT INTO paper_positions(id,release_id,opened_at,symbol,side,qty,entry,stop,target,risk,mark,reason)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,[p.id,p.release_id,p.opened_at,p.symbol,p.side,p.qty,p.entry,p.stop,p.target,p.risk,p.mark,p.reason]);positions.push(p);
          }
        }
      }
      if(o) await c.query("INSERT INTO paper_entry_decisions(observation_key,reason) VALUES($1,$2) ON CONFLICT DO NOTHING",[o.observation_key,decision]);
      for(const p of positions.filter(p=>!p.closed_at)) {
        const b=indices[p.symbol]?.get(time);if(!b || (p.last_mark_ts && time < Date.parse(p.last_mark_ts)/1000)) continue;
        const exit=exitForPaper(p,b);
        if(exit) await finish(p,exit.price,time,exit.reason);
        else {p.mark=b.close;p.last_mark_ts=new Date((time+300)*1000).toISOString();await c.query("UPDATE paper_positions SET mark=$2,last_mark_ts=$3 WHERE id=$1",[p.id,p.mark,p.last_mark_ts]);}
      }
      equity=PAPER_RISK.capital+realized+positions.filter(p=>!p.closed_at).reduce((a,p)=>a+value(p,p.mark),0);
      peak=Math.max(peak,equity);locked ||= peak-equity>=PAPER_RISK.maxDrawdown;
      if(locked || equity-dayStart<=-PAPER_RISK.dailyLoss) {
        for(const p of positions.filter(p=>!p.closed_at)) await finish(p,p.mark-(p.side==="LONG"?1:-1)*slip(p.symbol,time),time,locked?"Drawdown lock":"Daily loss limit");
        equity=PAPER_RISK.capital+realized;
        if(locked){valid=false;await c.query("UPDATE paper_releases SET status='paused',reason='Drawdown lock; explicit reset required' WHERE status IN ('active','probation')");}
      }
    }
    const openRisk=positions.filter(p=>!p.closed_at).reduce((a,p)=>a+p.risk,0);
    await c.query("UPDATE paper_account SET equity=$1,peak=$2,day_key=$3,day_start_equity=$4,daily_pnl=$5,open_risk=$6,locked=$7,last_bar_ts=coalesce(to_timestamp($8),last_bar_ts),updated_at=now() WHERE id=1",[equity,peak,day,dayStart,equity-dayStart,openRisk,locked,timeline.length?timeline.at(-1)!+300:null]);
    return {active:valid,positions:positions.filter(p=>!p.closed_at).length};
  });
}
