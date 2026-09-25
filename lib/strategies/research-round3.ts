/** Frozen before measurement: two ideas, one rule set each, no tuning controls. */
import type {Bar} from "@/lib/types";
import {atr} from "@/lib/indicators";
import {nyMeta,tradingDayKey} from "@/lib/time/ny";
import {holidayFor,flattenMinuteNy} from "@/lib/market/holidays";
import type {EntrySignal,Strategy} from "./types";
export const ROUND3_IDS=["opening-continuation-v1","overnight-rejection-v1"] as const;
type Context=Record<string,Map<number,EntrySignal>>;
function prepare(series:Record<string,Bar[]>,opening:boolean):Context {
 const result:Context={};
 for(const [symbol,bars] of Object.entries(series)) {
  const signals=new Map<number,EntrySignal>(),vol=atr(bars,14),closes:number[]=[];
  let day="",session="",rthOpen:number|null=null,rthCount=0,onHigh=-Infinity,onLow=Infinity,onCount=0,used=false,prior:number|null=null;
  for(let i=0;i<bars.length;i++){
   const b=bars[i],m=nyMeta(b.time),td=tradingDayKey(b.time);
   if(td!==session){session=td;onHigh=-Infinity;onLow=Infinity;onCount=0;}
   if(m.dateKey!==day){day=m.dateKey;rthOpen=null;rthCount=0;used=false;prior=closes.length>=21?Math.sign(closes.at(-1)!-closes.at(-21)!):null;}
   const contiguous=i>0&&b.time-bars[i-1].time===300;
   if(m.minutes>=1080||m.minutes<570){if(onCount&&!contiguous)onCount=-10000;onHigh=Math.max(onHigh,b.high);onLow=Math.min(onLow,b.low);onCount++;}
   if(m.minutes===570){rthOpen=b.open;rthCount=0;}
   if(m.minutes>=570&&m.minutes<960){if(rthCount&&!contiguous)rthCount=-10000;rthCount++;}
   const flatten=flattenMinuteNy(day,925);
   if(!used&&holidayFor(day)?.kind!=="closed"&&m.minutes<flatten){
    if(opening&&m.minutes===595&&rthCount===6&&rthOpen!==null&&prior&&vol[i]!=null&&vol[i]!>0){
     const direction=Math.sign(b.close-rthOpen);
     if(direction===prior){signals.set(b.time,{symbol,side:direction>0?"LONG":"SHORT",stop:b.close-direction*1.5*vol[i]!,target:{kind:"rMultiple",r:2},tags:{trigger:"Opening half-hour agrees with the prior 20-session trend"}});used=true;}
    }
    if(!opening&&m.minutes>=570&&m.minutes<660&&onCount===186&&rthCount>0){
     const short=b.high>onHigh&&b.close<=onHigh,long=b.low<onLow&&b.close>=onLow;
     if(long!==short){signals.set(b.time,{symbol,side:long?"LONG":"SHORT",stop:long?b.low-.25:b.high+.25,target:{kind:"rMultiple",r:2},tags:{trigger:"First rejection back inside the completed overnight range"}});used=true;}
    }
   }
   // Only an actual complete regular session close joins the trend history.
   if(m.minutes===955&&rthCount===78)closes.push(b.close);
  }
  result[symbol]=signals;
 }
 return result;
}
const base={symbolMode:"single" as const,feeds:["MES","MNQ"] as ("MES"|"MNQ")[],params:[],onSnapshot:(ctx:Context,snap:Parameters<Strategy<Context>["onSnapshot"]>[1])=>Object.values(ctx).flatMap(m=>m.has(snap.time)?[m.get(snap.time)!]:[])};
export const openingContinuation:Strategy<Context>={...base,id:ROUND3_IDS[0],name:"Opening continuation",blurb:"Research only. Opening direction agrees with the prior 20-session trend. One next-open entry, 1.5 ATR stop, 2R target.",prepare:s=>prepare(s,true)};
export const overnightRejection:Strategy<Context>={...base,id:ROUND3_IDS[1],name:"Failed overnight breakout",blurb:"Research only. First rejection of the completed overnight range before 11:00 ET. One next-open entry, rejection-bar stop, 2R target.",prepare:s=>prepare(s,false)};
