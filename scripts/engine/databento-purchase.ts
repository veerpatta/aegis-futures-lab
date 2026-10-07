/** Private, budget-reserved download cache. No raw licensed data in artifacts.

   Every paid Databento request in this repo goes through the ledger in
   private_research.data_purchases: quote it (metadata.get_cost, free), then
   reserve quote x 1.25 under an advisory lock and refuse when the reservations
   would pass CREDIT_CAP, the user-attested credit. `quoteRequests` is the
   spend-nothing half, for printing what a run WOULD cost before it runs. */
import {gzipSync,gunzipSync} from "node:zlib";
import {transaction} from "@/lib/neon/server";
import {stableHash} from "./learning-audit";
export const CREDIT_CAP=102.76;
/** quote x RESERVE_FACTOR is held against the cap until the download settles. */
export const RESERVE_FACTOR=1.25;
export const CREDIT_EXPIRES_AT="2027-02-01T00:00:00Z";
/** Database ceiling the cache may grow to (free Neon project: 0.5 GB). */
export const STORAGE_LIMIT_BYTES=480e6;
export type DataRequest={dataset:string;schema:string;stype_in:string;symbols:string;start:string;end:string};
const base="https://hist.databento.com/v0/";
export async function metadata(method:string,params:Record<string,string>) {
 const key=process.env.DATABENTO_API_KEY;if(!key)throw new Error("DATABENTO_API_KEY missing");
 const r=await fetch(base+method+"?"+new URLSearchParams(params),{headers:{Authorization:`Basic ${Buffer.from(key+":").toString("base64")}`}});
 if(!r.ok)throw new Error(`${method}: HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);return r.json();
}
export function reserveCost(quote:number,used:number){if(!Number.isFinite(quote)||quote<0||!Number.isFinite(used)||used<0||used+quote*RESERVE_FACTOR>CREDIT_CAP)throw new Error("Request exceeds remaining authorized credit including reserve");return quote*RESERVE_FACTOR;}
/** The ledger id of a request — identical requests share one row, so a request is never bought twice. */
export const purchaseId=(request:DataRequest)=>stableHash(request);

/** Free: what Databento would charge for `request`. Spends nothing. */
export async function quoteCost(request:DataRequest):Promise<number>{
 const quote=Number(await metadata("metadata.get_cost",{...request,mode:"historical-streaming"}));
 if(!Number.isFinite(quote)||quote<0)throw new Error(`Unusable quote for ${request.symbols} ${request.start}: ${quote}`);
 return quote;
}
/** Sum of every reservation and settled purchase so far. */
export async function ledgerUsed():Promise<number>{
 return Number((await transaction(c=>c.query("SELECT coalesce(sum(reserved_usd),0) n FROM private_research.data_purchases"))).rows[0].n);
}
export async function ledgerEntry(id:string):Promise<{status:string;report:unknown}|null>{
 const r=await transaction(c=>c.query("SELECT status,report FROM private_research.data_purchases WHERE id=$1",[id]));
 return r.rows[0]?{status:String(r.rows[0].status),report:r.rows[0].report??null}:null;
}
/** Pure: would `quotes` (each reserved at quote x 1.25) still fit under the cap after `used`? */
export function budgetCheck(quotes:number[],used:number){
 const quoted=quotes.reduce((a,b)=>a+b,0),reserve=quoted*RESERVE_FACTOR,remaining=CREDIT_CAP-used;
 return {requests:quotes.length,quoted,reserve,used,cap:CREDIT_CAP,remaining,remainingAfter:remaining-reserve,
  fits:quotes.every(q=>Number.isFinite(q)&&q>=0)&&Number.isFinite(used)&&used>=0&&used+reserve<=CREDIT_CAP};
}
/** Quote a batch without buying anything: requests already in the ledger cost
    nothing more and are listed as such. */
export async function quoteRequests(items:{label:string;request:DataRequest}[]){
 const used=await ledgerUsed();const rows:{label:string;id:string;status:string|null;quote:number|null}[]=[];
 for(const it of items){const id=purchaseId(it.request);const prior=await ledgerEntry(id);
  rows.push({label:it.label,id,status:prior?.status??null,quote:prior?null:await quoteCost(it.request)});}
 return {rows,...budgetCheck(rows.filter(r=>r.quote!==null).map(r=>r.quote!),used)};
}
/* Reserve quote x 1.25 for `request` and record it BEFORE any byte is bought.
   Throws, spending nothing, when the credit has expired, the reservation would
   pass CREDIT_CAP, or the database would pass STORAGE_LIMIT_BYTES once
   `storageBytes` more land. Returns the ledger id. */
export async function reserveBudget(request:DataRequest,quote:number,storageBytes:number):Promise<string>{
 if(Date.now()>=Date.parse(CREDIT_EXPIRES_AT))throw new Error("Attested credit has expired");
 const id=purchaseId(request);
 await transaction(async c=>{
  await c.query("SELECT pg_advisory_xact_lock(92510276)");
  const used=Number((await c.query("SELECT coalesce(sum(reserved_usd),0) n FROM private_research.data_purchases")).rows[0].n);
  const reserved=reserveCost(quote,used);
  const size=Number((await c.query("SELECT pg_database_size(current_database()) n")).rows[0].n);
  if(!Number.isFinite(storageBytes)||storageBytes<0||size+storageBytes>STORAGE_LIMIT_BYTES)throw new Error("Insufficient storage headroom for private cache and aggregates");
  await c.query("INSERT INTO private_research.data_purchases(id,request,quoted_usd,reserved_usd,status) VALUES($1,$2,$3,$4,'reserved')",[id,JSON.stringify(request),quote,reserved]);
 });
 return id;
}
export async function markImported(id:string,report:unknown){
 await transaction(c=>c.query("UPDATE private_research.data_purchases SET status='imported',report=$2 WHERE id=$1",[id,JSON.stringify(report)]));
}
export async function purchase(request:DataRequest):Promise<{id:string;csv:string}> {
 const id=purchaseId(request);
 const cached=await transaction(c=>c.query("SELECT compressed,status FROM private_research.data_purchases WHERE id=$1",[id]));
 if(cached.rows[0]?.compressed)return{id,csv:gunzipSync(cached.rows[0].compressed).toString("utf8")};
 if(cached.rows.length)throw new Error("Earlier purchase has an uncertain result; reconcile before retrying "+id);
 if(Date.now()>=Date.parse(CREDIT_EXPIRES_AT))throw new Error("Attested credit has expired");
 const quote=await quoteCost(request);
 const bytes=Number(await metadata("metadata.get_billable_size",request));
 if(!Number.isFinite(bytes)||bytes<0)throw new Error("Insufficient storage headroom for private cache and aggregates");
 await reserveBudget(request,quote,bytes*2);
 const key=process.env.DATABENTO_API_KEY!;
 const r=await fetch(base+"timeseries.get_range",{method:"POST",headers:{Authorization:`Basic ${Buffer.from(key+":").toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...request,encoding:"csv",pretty_px:"true",pretty_ts:"false"})});
 if(!r.ok)throw new Error(`Download ${id}: HTTP ${r.status}; reservation retained`);
 const csv=await r.text();const compressed=gzipSync(csv);
 await transaction(c=>c.query("UPDATE private_research.data_purchases SET compressed=$2,content_hash=$3,status='cached',downloaded_at=now() WHERE id=$1",[id,compressed,stableHash(csv)]));
 console.log(JSON.stringify({id,schema:request.schema,symbol:request.symbols,start:request.start,quote,cacheBytes:compressed.length}));return{id,csv};
}
