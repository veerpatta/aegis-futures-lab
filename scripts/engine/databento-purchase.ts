/** Private, budget-reserved download cache. No raw licensed data in artifacts. */
import {gzipSync,gunzipSync} from "node:zlib";
import {transaction} from "@/lib/neon/server";
import {stableHash} from "./learning-audit";
export const CREDIT_CAP=102.76;
export type DataRequest={dataset:string;schema:string;stype_in:string;symbols:string;start:string;end:string};
const base="https://hist.databento.com/v0/";
export async function metadata(method:string,params:Record<string,string>) {
 const key=process.env.DATABENTO_API_KEY;if(!key)throw new Error("DATABENTO_API_KEY missing");
 const r=await fetch(base+method,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(key+":").toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});
 if(!r.ok)throw new Error(`${method}: HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);return r.json();
}
export function reserveCost(quote:number,used:number){if(!Number.isFinite(quote)||quote<0||!Number.isFinite(used)||used<0||used+quote*1.25>CREDIT_CAP)throw new Error("Request exceeds remaining authorized credit including reserve");return quote*1.25;}
export async function purchase(request:DataRequest):Promise<{id:string;csv:string}> {
 const id=stableHash(request);
 const cached=await transaction(c=>c.query("SELECT compressed,status FROM private_research.data_purchases WHERE id=$1",[id]));
 if(cached.rows[0]?.compressed)return{id,csv:gunzipSync(cached.rows[0].compressed).toString("utf8")};
 if(cached.rows.length)throw new Error("Earlier purchase has an uncertain result; reconcile before retrying "+id);
 if(Date.now()>=Date.parse("2027-02-01T00:00:00Z"))throw new Error("Attested credit has expired");
 const quote=Number(await metadata("metadata.get_cost",{...request,mode:"historical-streaming"}));
 await transaction(async c=>{
  await c.query("SELECT pg_advisory_xact_lock(92510276)");
  const used=Number((await c.query("SELECT coalesce(sum(reserved_usd),0) n FROM private_research.data_purchases")).rows[0].n);
  const reserved=reserveCost(quote,used);
  const bytes=Number(await metadata("metadata.get_billable_size",request));
  const size=Number((await c.query("SELECT pg_database_size(current_database()) n")).rows[0].n);
  if(!Number.isFinite(bytes)||bytes<0||size+bytes*2>480e6)throw new Error("Insufficient storage headroom for private cache and aggregates");
  await c.query("INSERT INTO private_research.data_purchases(id,request,quoted_usd,reserved_usd,status) VALUES($1,$2,$3,$4,'reserved')",[id,JSON.stringify(request),quote,reserved]);
 });
 const key=process.env.DATABENTO_API_KEY!;
 const r=await fetch(base+"timeseries.get_range",{method:"POST",headers:{Authorization:`Basic ${Buffer.from(key+":").toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...request,encoding:"csv",pretty_px:"true",pretty_ts:"false"})});
 if(!r.ok)throw new Error(`Download ${id}: HTTP ${r.status}; reservation retained`);
 const csv=await r.text();const compressed=gzipSync(csv);
 await transaction(c=>c.query("UPDATE private_research.data_purchases SET compressed=$2,content_hash=$3,status='cached',downloaded_at=now() WHERE id=$1",[id,compressed,stableHash(csv)]));
 console.log(JSON.stringify({id,schema:request.schema,symbol:request.symbols,start:request.start,quote,cacheBytes:compressed.length}));return{id,csv};
}
