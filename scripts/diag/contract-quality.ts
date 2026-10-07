/** Audit the private downloads against stored aggregates without another purchase.

   The preregistered confirmation window is fixed: 2026-07-30 → 2026-09-24,
   40 daily `.c.0` requests per symbol. Purchases outside it (a later refresh
   extending the archive) are counted separately and never change the window.

   Roll-day fills (lib/data/roll-fill.ts) are counted APART from the 40: on
   the 2026-09-18 quarterly expiry the continuous series stops at the 09:30 ET
   settlement, and a fill supplies the rest of that day from the next
   contract. Each fill must match exactly the request the fill code issues for
   a real expiry day, its bars must match what is stored, and it is listed
   under `rollFills`. Bars a fill supplied are stored, so they are no longer
   missing; a raw-symbol purchase that is NOT a valid fill blocks qualification. */
import {writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {transaction} from "@/lib/neon/server";
import {parseOhlcv1mCsv,parseTsEvent,bars5mFromOhlcv1mCsv,DATABENTO_SUNDAY_GAP} from "@/lib/data/databento";
import {matchRollFill,parseContractSymbol,type RollFillPlan} from "@/lib/data/roll-fill";
import {nyMeta} from "@/lib/time/ny";
import {holidayFor,flattenMinuteNy} from "@/lib/market/holidays";
import {stableHash} from "../engine/learning-audit";
import type {Bar} from "@/lib/types";
import type {PromotionVerdict} from "@/lib/validation/promotionGate";

export function requireCompleteContractData(gate:PromotionVerdict,ready:boolean):PromotionVerdict {
 if(ready)return gate;
 return {...gate,promote:false,evidenceGaps:[...gate.evidenceGaps,"contract-data"],
  checks:[...gate.checks,{key:"contract-data",label:"Complete contract data",status:"not-measured",value:null,threshold:0,
   detail:"The refreshed archive has missing session bars. Results are provisional and cannot qualify a strategy."}],
  summary:"Blocked: incomplete contract data."};
}

/** Daily `.c.0` requests the preregistered window must contain, per symbol. */
export const DAILY_REQUESTS_EXPECTED=40;
export const QUALITY_WINDOW={from:"2026-07-30T00:00:00Z",to:"2026-09-24T00:00:00Z"} as const;

export interface ManifestRow{id:string;status:string;request:{dataset?:string;schema?:string;stype_in?:string;symbols?:string;start?:string;end?:string}}

/** Sort one symbol's ohlcv-1m purchases into the window's daily requests, its
    valid roll-day fills, raw-symbol purchases that are NOT valid fills, and
    everything outside the window. Pure, so the counting is pinned by tests. */
export function classifyPurchases(rows:readonly ManifestRow[],symbol:string,fromSec:number,toSec:number){
 const inWindow=(r:ManifestRow)=>{const t=Date.parse(r.request.start??"")/1000;return t>=fromSec&&t<toSec;};
 const daily:ManifestRow[]=[],rollFills:{row:ManifestRow;plan:RollFillPlan}[]=[],invalidRollFills:ManifestRow[]=[];let outsideWindow=0;
 for(const r of rows){
  if(r.request.symbols===symbol+".c.0"){if(inWindow(r))daily.push(r);else outsideWindow++;continue;}
  if(r.request.stype_in!=="raw_symbol"||parseContractSymbol(r.request.symbols??"")?.root!==symbol)continue;
  if(!inWindow(r)){outsideWindow++;continue;}
  const plan=matchRollFill(r.request);
  if(plan)rollFills.push({row:r,plan});else invalidRollFills.push(r);
 }
 return {daily,rollFills,invalidRollFills,outsideWindow};
}

const SAME=(a:Bar|undefined,b:Bar)=>!!a&&(["open","high","low","close","volume"] as const).every(k=>Math.abs(Number(a[k])-Number(b[k]))<=1e-8);

export async function auditContractQuality(){
 const from=Date.parse(QUALITY_WINDOW.from)/1000,to=Date.parse(QUALITY_WINDOW.to)/1000;
 const manifest=await transaction(c=>c.query("SELECT id,request,status FROM private_research.data_purchases WHERE request->>'schema'='ohlcv-1m' ORDER BY request->>'symbols',request->>'start'"));
 const results=[];
 for(const symbol of ["MES","MNQ"]){
  const saved=await transaction(c=>c.query("SELECT time,open,high,low,close,volume FROM bars_5m WHERE symbol=$1 AND source='databento' AND time >= $2 AND time < $3 ORDER BY time",[symbol,from,to]));
  const stored=new Map<number,Bar>(saved.rows.map(b=>[Number(b.time),b]));
  const purchases=classifyPurchases(manifest.rows as ManifestRow[],symbol,from,to);
  let rawRows=0,invalidRows=0,duplicates=0,misalignedMinutes=0,aggregateMismatch=0,requests=0;
  const rolls:{at:string;previous:string;next:string;gapPoints:number}[]=[];
  let lastInstrument="",lastClose=0;const unique=new Set<number>();const fromDaily=new Set<number>();
  for(const item of purchases.daily){
   if(item.status!=="imported")throw new Error("Unfinished download: "+item.id);
   requests++;
   const raw=await transaction(c=>c.query("SELECT compressed FROM private_research.data_purchases WHERE id=$1",[item.id]));
   const csv=gunzipSync(raw.rows[0].compressed).toString("utf8");
   const lines=csv.trim().split(/\r?\n/),header=lines.shift()!.split(",");
   const ts=header.indexOf("ts_event"),instrument=header.indexOf("instrument_id"),close=header.indexOf("close"),open=header.indexOf("open");
   const day=Date.parse(item.request.start!)/1000,end=day+86400;
   const minutes=parseOhlcv1mCsv(csv,{rawPrices:false}).filter(b=>b.time>=day&&b.time<end);
   const inDay=lines.filter(Boolean).map(l=>l.split(",")).filter(c=>{const t=parseTsEvent(c[ts]);return t>=day&&t<end;});
   rawRows+=inDay.length;invalidRows+=inDay.length-minutes.length;
   for(const b of minutes){if(unique.has(b.time))duplicates++;unique.add(b.time);if(b.time%60)misalignedMinutes++;if(b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||Number(b.volume)<0)invalidRows++;}
   for(const row of inDay){const next=row[instrument];if(lastInstrument&&next&&next!==lastInstrument)rolls.push({at:new Date(parseTsEvent(row[ts])*1000).toISOString(),previous:lastInstrument,next,gapPoints:Number(row[open])-lastClose});lastInstrument=next;lastClose=Number(row[close]);}
   for(const b of bars5mFromOhlcv1mCsv(csv,{rawPrices:false},symbol).filter(b=>b.time>=day&&b.time<end)){
    fromDaily.add(b.time);if(!SAME(stored.get(b.time),b))aggregateMismatch++;
   }
  }
  // Roll-day fills: the bars each one supplied must be exactly what is stored.
  const rollFills=[];const fromFills=new Set<number>();
  for(const {row,plan} of purchases.rollFills){
   if(row.status!=="imported")throw new Error("Unfinished roll-fill download: "+row.id);
   const raw=await transaction(c=>c.query("SELECT compressed FROM private_research.data_purchases WHERE id=$1",[row.id]));
   const csv=gunzipSync(raw.rows[0].compressed).toString("utf8");
   const header=csv.slice(0,csv.indexOf("\n")).split(",").map(h=>h.trim()),idCol=header.indexOf("instrument_id");
   const instrumentIds=idCol<0?[]:[...new Set(csv.trim().split(/\r?\n/).slice(1).map(l=>l.split(",")[idCol]?.trim()).filter(Boolean))];
   const bars=bars5mFromOhlcv1mCsv(csv,{rawPrices:false},symbol).filter(b=>b.time>=plan.window.fromSec&&b.time<plan.window.toSec);
   let supplied=0,mismatched=0;
   for(const b of bars){
    if(fromDaily.has(b.time))continue; // the continuous series had this bar; a fill never replaces one
    if(SAME(stored.get(b.time),b)){supplied++;fromFills.add(b.time);}else mismatched++;
   }
   aggregateMismatch+=mismatched;
   const before=stored.get(plan.window.fromSec-300);
   rollFills.push({expiry:plan.expiry,contract:plan.contract,instrumentIds,requestId:row.id,
    from:new Date(plan.window.fromSec*1000).toISOString(),to:new Date(plan.window.toSec*1000).toISOString(),
    bars:bars.length,suppliedBars:supplied,mismatchedBars:mismatched,
    gapPoints:before&&bars.length?bars[0].open-Number(before.close):null});
  }
  let expectedDayBars=0;const missingDayBars:string[]=[];const overnight=new Map<string,{expected:number;missing:number}>();
  for(let t=from;t<to;t+=300){const m=nyMeta(t);if(["Sat","Sun"].includes(m.weekday)||holidayFor(m.dateKey)?.kind==="closed")continue;
   if(m.minutes>=120&&m.minutes<flattenMinuteNy(m.dateKey,925)){expectedDayBars++;if(!stored.has(t))missingDayBars.push(new Date(t*1000).toISOString());}
   // Anchor the full 18:00–09:30 overnight window on each included regular open.
   if(m.minutes===570){const start=t-186*300;if(start<from)continue;let missing=0;for(let x=start;x<t;x+=300)if(!stored.has(x))missing++;overnight.set(m.dateKey,{expected:186,missing});}
  }
  const invalidAggregates=[...stored.values()].filter(b=>b.time%300||![b.open,b.high,b.low,b.close].every(Number.isFinite)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.time+300>to).length;
  // Stored bars no audited download explains — neither a daily request nor a roll fill.
  const unaccountedBars=[...stored.keys()].filter(t=>!fromDaily.has(t)&&!fromFills.has(t)).length;
  results.push({symbol,datasetHash:stableHash([...stored.values()]),requests,rollFillRequests:purchases.rollFills.length,outsideWindowRequests:purchases.outsideWindow,
   invalidRollFills:purchases.invalidRollFills.map(r=>({id:r.id,symbols:r.request.symbols,start:r.request.start,end:r.request.end})),
   storedBars:stored.size,rawRows,invalidRows,duplicates,misalignedMinutes,invalidAggregates,aggregateMismatch,unaccountedBars,expectedDayBars,missingDayBars,contractChanges:rolls,rollFills,overnight:Object.fromEntries(overnight),completeOvernights:[...overnight.values()].filter(v=>!v.missing).length});
 }
 const budget=(await transaction(c=>c.query("SELECT count(*) requests, sum(quoted_usd) quoted_usd,sum(reserved_usd) reserved_usd,pg_database_size(current_database()) database_bytes FROM private_research.data_purchases"))).rows[0];
 const qualificationReady=!results.some(r=>r.requests!==DAILY_REQUESTS_EXPECTED||r.invalidRollFills.length||r.unaccountedBars||r.invalidRows||r.duplicates||r.misalignedMinutes||r.invalidAggregates||r.aggregateMismatch||r.missingDayBars.length);
 const report={qualificationReady,from:new Date(from*1000).toISOString(),to:new Date(to*1000).toISOString(),results,budget,limitations:[DATABENTO_SUNDAY_GAP+": UTC Sundays were excluded. Incomplete overnights are skipped by the new rejection strategy.","Minutes without trades need not have an OHLCV record. Missing five-minute records are reported, not filled with invented prices.","Continuous contracts are unadjusted; contract changes and price jumps are reported, not hidden.","On a quarterly expiry day the continuous series stops at the 09:30 ET settlement; the rest of that day comes from the next contract, bought by raw symbol, listed under rollFills and never counted as one of the daily requests.","Credit figures are provider request quotes and internal reserves, not a verified billing balance."]};
 writeFileSync("docs/research/2026-09-25-contract-quality.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 return report;
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/contract-quality.ts")) auditContractQuality().then(r=>{if(!r.qualificationReady)throw new Error("Contract quality needs review before qualification");}).catch(e=>{console.error(e);process.exitCode=1;});
