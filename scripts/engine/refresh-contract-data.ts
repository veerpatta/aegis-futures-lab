/* Contract-data refresh: one ledger-budgeted Databento ohlcv-1m purchase per
   symbol per UTC weekday (scripts/engine/databento-purchase.ts — quote first,
   reserve quote x 1.25, refuse above the attested credit), folded to five
   minutes and stored in bars_5m as source='databento'.

   ROLL DAYS. On an equity-index quarterly expiry day the continuous `.c.0`
   series stops at the 09:30 ET final settlement and only moves to the next
   contract at the next UTC date (lib/data/roll-fill.ts). After importing such
   a day, the refresh buys the NEXT quarterly contract by raw symbol for 09:25
   ET → flatten and inserts only the five-minute bars the continuous series is
   missing. Each fill is its own ledger row whose report names the contract
   and every bar it supplied; scripts/diag/contract-quality.ts lists them
   separately. Nothing is overwritten and nothing is blended silently. A day
   whose continuous series has no gap buys nothing.

   CI ONLY — this writes the production database and spends Databento credit.
     npx tsx scripts/engine/refresh-contract-data.ts
         daily refresh, MES and MNQ, 2026-07-30 → DATA_CUTOFF, roll fills included
       --symbols MES,MNQ,M2K,MYM   quarterly equity-index roots (".c.0" accepted)
       --from YYYY-MM-DD           first UTC day (default 2026-07-30)
       --roll-fill DATE | A..B     ONLY the expiry-day fills: one expiry date, or every
                                   expiry in [A, B) — e.g. 2019-05-06..2026-10-03
       --quote                     price the run against the remaining credit;
                                   buys nothing and writes nothing
     DATA_CUTOFF   exclusive end: an ISO time, or "last-complete-week" (the
                   Saturday 00:00 UTC after the latest finished Mon-Fri week);
                   default and ceiling: the latest day Databento has published. */
import {purchase,metadata,quoteRequests,ledgerEntry,purchaseId,type DataRequest} from "./databento-purchase";
import {bars5mFromOhlcv1mCsv} from "@/lib/data/databento";
import {transaction} from "@/lib/neon/server";
import {nyMeta} from "@/lib/time/ny";
import {holidayFor} from "@/lib/market/holidays";
import {EQUITY_INDEX_ROOTS,expiryDaysBetween,isEquityIndexRoot,isQuarterlyExpiryDay,rollFillPlan,type EquityIndexRoot} from "@/lib/data/roll-fill";

const DAY=86400000;
const DEFAULT_FROM="2026-07-30";
const arg=(flag:string)=>{const i=process.argv.indexOf(flag);return i>=0?process.argv[i+1]:undefined;};
const isoDay=(s:string|undefined)=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"));

/** "MES,MNQ" or "MES.c.0,MNQ.c.0" → ["MES","MNQ"]. Only quarterly equity-index
    roots: the roll-day rule here is theirs, and metals roll differently. */
export function parseRoots(raw:string|undefined,fallback="MES,MNQ"):EquityIndexRoot[]{
 const roots=(raw?.trim()||fallback).split(",").map(s=>s.trim().replace(/\.c\.0$/,"")).filter(Boolean);
 const bad=roots.filter(r=>!isEquityIndexRoot(r));
 if(bad.length||!roots.length)throw new Error(`Unknown --symbols ${bad.join(",")||"(none)"}; this refresh covers ${EQUITY_INDEX_ROOTS.join(", ")}`);
 return [...new Set(roots)] as EquityIndexRoot[];
}

/** Exclusive cutoff (ms) for "through the last complete week": the Saturday
    00:00 UTC that ends the most recent Mon-Fri week whose Friday request
    (which runs ten minutes past midnight) has fully elapsed. */
export function lastCompleteWeekCutoff(nowMs:number):number{
 const today=Math.floor(nowMs/DAY)*DAY;
 let saturday=today-((new Date(today).getUTCDay()+1)%7)*DAY;
 if(saturday+600000>nowMs)saturday-=7*DAY;
 return saturday;
}

/** "2026-09-18" → that expiry; "A..B" → every expiry in [A, B). A single date
    that is not an expiry day is refused rather than skipped. */
export function parseRollFillDays(raw:string):string[]{
 const m=/^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?$/.exec(raw.trim());
 if(!m||!isoDay(m[1])||(m[2]&&!isoDay(m[2])))throw new Error(`--roll-fill takes YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD, got "${raw}"`);
 if(!m[2]){if(!isQuarterlyExpiryDay(m[1]))throw new Error(`${m[1]} is not an equity-index quarterly expiry day`);return [m[1]];}
 return expiryDaysBetween(m[1],m[2]);
}

/** The daily request. Its exact shape is the ledger id of every day already
    bought — change it and every cached day is bought again. */
export function dailyRequest(root:string,dayMs:number):DataRequest{
 return {dataset:"GLBX.MDP3",schema:"ohlcv-1m",stype_in:"continuous",symbols:root+".c.0",start:new Date(dayMs).toISOString(),end:new Date(dayMs+DAY+600000).toISOString()};
}

const weekdays=(fromMs:number,endMs:number)=>{const out:number[]=[];for(let d=fromMs;d<endMs;d+=DAY){const u=new Date(d).getUTCDay();if(u!==6&&u!==0)out.push(d);}return out;};
const nyDateOfUtcDay=(dayMs:number)=>nyMeta(dayMs/1000+43200).dateKey;

async function availableEnd():Promise<number>{
 const range=await metadata("metadata.get_dataset_range",{dataset:"GLBX.MDP3"});
 const available=Date.parse(range.schemas?.["ohlcv-1m"]?.end??range.end);if(!Number.isFinite(available))throw new Error("Availability unknown");
 return available;
}
function resolveCutoff(available:number):number{
 const cutoff=Math.floor((available-600000)/DAY)*DAY;
 const raw=process.env.DATA_CUTOFF?.trim();
 const requested=!raw?cutoff:raw==="last-complete-week"?lastCompleteWeekCutoff(Date.now()):Date.parse(raw);
 const end=Math.min(cutoff,requested);if(!Number.isFinite(end))throw new Error("Invalid cutoff");
 return end;
}

/** Five-minute bucket starts in [fromSec, toSec) with no stored databento bar. */
async function missingBuckets(root:string,fromSec:number,toSec:number):Promise<number[]>{
 const r=await transaction(c=>c.query("SELECT time FROM public.bars_5m WHERE symbol=$1 AND source='databento' AND time>=$2 AND time<$3",[root,fromSec,toSec]));
 const have=new Set(r.rows.map(x=>Number(x.time)));const out:number[]=[];
 for(let t=fromSec;t<toSec;t+=300)if(!have.has(t))out.push(t);
 return out;
}

function instrumentIds(csv:string):string[]{
 const lines=csv.trim().split(/\r?\n/);const header=(lines.shift()??"").split(",").map(h=>h.trim().toLowerCase());
 const i=header.indexOf("instrument_id");if(i<0)return [];
 return [...new Set(lines.filter(Boolean).map(l=>l.split(",")[i]?.trim()).filter(Boolean))];
}

export interface RollFillOutcome{root:string;expiry:string;contract:string;status:"filled"|"already-imported"|"no-gap";filled:number;missingBefore:number|null;stillMissing:number|null}

/* One expiry day's fill for one root. Skips without spending when the ledger
   already shows it imported, or when the continuous series has no gap in the
   window (nothing to fill — e.g. if the vendor ever maps the roll itself). */
export async function importRollFill(root:EquityIndexRoot,dateKey:string):Promise<RollFillOutcome>{
 const plan=rollFillPlan(root,dateKey);
 if(!plan)throw new Error(`${dateKey} is not a quarterly expiry day — there is no roll fill for it`);
 const {fromSec,toSec}=plan.window;
 const base={root,expiry:dateKey,contract:plan.contract};
 const prior=await ledgerEntry(purchaseId(plan.request));
 if(prior?.status==="imported"){
  const report=prior.report as {filled?:unknown[];stillMissing?:number}|null;
  return {...base,status:"already-imported",filled:report?.filled?.length??0,missingBefore:null,stillMissing:report?.stillMissing??null};
 }
 const missing=await missingBuckets(root,fromSec,toSec);
 if(!prior&&!missing.length){console.log(`${root} ${dateKey}: ${plan.continuous} has every bar from ${new Date(fromSec*1000).toISOString()} to flatten — no roll fill bought.`);return {...base,status:"no-gap",filled:0,missingBefore:0,stillMissing:0};}
 const got=await purchase(plan.request);
 const ids=instrumentIds(got.csv);
 if(ids.length>1)throw new Error(`Roll fill ${plan.contract} ${dateKey} returned ${ids.length} instruments (${ids.join(",")}); refusing to merge`);
 const bars=bars5mFromOhlcv1mCsv(got.csv,{rawPrices:false},root).filter(b=>b.time>=fromSec&&b.time<toSec);
 if(!bars.length)throw new Error(`Roll fill ${plan.contract} ${dateKey}: no five-minute bars in the window. Check the contract symbol before retrying (purchase ${got.id} is cached).`);
 let filled:number[]=[];
 await transaction(async c=>{
  const r=await c.query(`INSERT INTO public.bars_5m(symbol,source,time,open,high,low,close,volume)
   SELECT $1,'databento',x.time,x.open,x.high,x.low,x.close,x.volume FROM jsonb_to_recordset($2::jsonb) AS x(time bigint,open double precision,high double precision,low double precision,close double precision,volume double precision)
   ON CONFLICT(symbol,source,time) DO NOTHING RETURNING time`,[root,JSON.stringify(bars)]);
  filled=r.rows.map(x=>Number(x.time)).sort((a,b)=>a-b);
  const supplied=new Set(bars.map(b=>b.time));
  const report={kind:"roll-fill",root,continuous:plan.continuous,expiry:dateKey,contract:plan.contract,instrumentIds:ids,
   window:{from:new Date(fromSec*1000).toISOString(),to:new Date(toSec*1000).toISOString()},
   bars:bars.length,filled,keptExisting:bars.length-filled.length,missingBefore:missing.length,stillMissing:missing.filter(t=>!supplied.has(t)).length,
   note:`${plan.continuous} stops at the 09:30 ET final settlement on expiry day; these bars are ${plan.contract}, the next quarterly contract, inserted only where the continuous series had none.`};
  await c.query("UPDATE private_research.data_purchases SET status='imported',report=$2 WHERE id=$1",[got.id,JSON.stringify(report)]);
 });
 const stillMissing=missing.filter(t=>!bars.some(b=>b.time===t)).length;
 console.log(`ROLL FILL ${root} ${dateKey}: ${filled.length} five-minute bars from ${plan.contract} (instrument ${ids.join(",")||"?"}) substituted for ${plan.continuous}, ${new Date(fromSec*1000).toISOString()} → ${new Date(toSec*1000).toISOString()}; ${stillMissing} still missing. Recorded in the purchase ledger as a roll fill.`);
 return {...base,status:"filled",filled:filled.length,missingBefore:missing.length,stillMissing};
}

async function importDay(root:string,day:number,gaps:string[]):Promise<number>{
 const request=dailyRequest(root,day);
 const got=await purchase(request);
 const previous=await transaction(c=>c.query("SELECT status FROM private_research.data_purchases WHERE id=$1",[got.id]));if(previous.rows[0]?.status==="imported")return 0;
 const bars=bars5mFromOhlcv1mCsv(got.csv,{rawPrices:false},request.symbols).filter(b=>b.time>=day/1000&&b.time<(day+DAY)/1000);
 if(!bars.length&&holidayFor(nyDateOfUtcDay(day))?.kind!=="closed")gaps.push(root+":"+request.start);
 await transaction(async c=>{
  await c.query(`INSERT INTO public.bars_5m(symbol,source,time,open,high,low,close,volume)
   SELECT $1,'databento',x.time,x.open,x.high,x.low,x.close,x.volume FROM jsonb_to_recordset($2::jsonb) AS x(time bigint,open double precision,high double precision,low double precision,close double precision,volume double precision)
   ON CONFLICT(symbol,source,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume`,[root,JSON.stringify(bars)]);
  await c.query("UPDATE private_research.data_purchases SET status='imported',report=$2 WHERE id=$1",[got.id,JSON.stringify({bars:bars.length,first:bars[0]?.time,last:bars.at(-1)?.time})]);
 });
 return bars.length;
}

function printQuote(title:string,q:Awaited<ReturnType<typeof quoteRequests>>){
 const toBuy=q.rows.filter(r=>r.quote!==null);
 console.log(`\n${title}: ${q.rows.length} requests, ${q.rows.length-toBuy.length} already in the ledger (no new cost), ${toBuy.length} to buy.`);
 for(const r of toBuy)console.log(`  ${r.label.padEnd(44)} $${r.quote!.toFixed(4)}`);
 console.log(JSON.stringify({quotedUsd:q.quoted,reserveUsd:q.reserve,ledgerUsedUsd:q.used,capUsd:q.cap,remainingUsd:q.remaining,remainingAfterUsd:q.remainingAfter,fits:q.fits}));
 console.log(q.fits?"Fits inside the remaining attested credit (including the 25% reserve). Nothing was bought.":"REFUSED: above the remaining attested credit including the 25% reserve. Nothing was bought.");
 if(!q.fits)process.exitCode=1;
}

async function main(){
 const roots=parseRoots(arg("--symbols"));
 const quoteOnly=process.argv.includes("--quote");
 const available=await availableEnd();
 const rollArg=arg("--roll-fill");
 if(rollArg!==undefined){
  const days=parseRollFillDays(rollArg);
  const plans=roots.flatMap(root=>days.map(day=>rollFillPlan(root,day)!));
  const late=plans.filter(p=>Date.parse(p.request.end)>available);
  if(late.length)throw new Error(`Not yet published by Databento: ${late.map(p=>p.root+" "+p.expiry).join(", ")}`);
  if(quoteOnly){printQuote("Roll-day fills (bought only where the continuous series has a gap)",await quoteRequests(plans.map(p=>({label:`${p.root} ${p.expiry} ← ${p.contract}`,request:p.request}))));return;}
  const results=[];for(const p of plans)results.push(await importRollFill(p.root,p.expiry));
  console.log(JSON.stringify({rollFills:results}));
  return;
 }
 const from=arg("--from")??DEFAULT_FROM;if(!isoDay(from))throw new Error("--from takes YYYY-MM-DD");
 const end=resolveCutoff(available);
 const days=weekdays(Date.parse(from+"T00:00:00Z"),end);
 if(quoteOnly){
  const items=roots.flatMap(root=>days.flatMap(day=>{
   const daily={label:`${root} ${new Date(day).toISOString().slice(0,10)}`,request:dailyRequest(root,day)};
   const plan=rollFillPlan(root,nyDateOfUtcDay(day));
   return plan?[daily,{label:`${root} ${plan.expiry} roll fill ← ${plan.contract}`,request:plan.request}]:[daily];
  }));
  printQuote(`Contract-data refresh ${from} → ${new Date(end).toISOString()} (${roots.join(",")}); roll fills are bought only where a gap remains`,await quoteRequests(items));
  return;
 }
 let count=0;const gaps:string[]=[];const fills:RollFillOutcome[]=[];
 for(const root of roots)for(const day of days){
  count+=await importDay(root,day,gaps);
  // After the day's continuous bars are in, so the gap check sees them.
  const dateKey=nyDateOfUtcDay(day);
  if(isQuarterlyExpiryDay(dateKey))fills.push(await importRollFill(root,dateKey));
 }
 const budget=await transaction(c=>c.query("SELECT sum(quoted_usd) quoted,sum(reserved_usd) reserved,count(*) requests FROM private_research.data_purchases"));
 console.log(JSON.stringify({from,end:new Date(end).toISOString(),symbols:roots,rows:count,emptyWeekdays:gaps,rollFills:fills,budget:budget.rows[0],balanceSource:"User-attested $102.76, September 25; estimates are not provider billing"}));if(gaps.length)throw new Error("Unexpected empty weekdays require review");
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/refresh-contract-data.ts"))main().catch(e=>{console.error(e);process.exitCode=1;});
