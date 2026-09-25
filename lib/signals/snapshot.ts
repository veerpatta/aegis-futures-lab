import type {SignalRow} from "@/lib/neon/client";
import type {SupabaseClient} from "@supabase/supabase-js";
import {liveOnly} from "./live";
import {nyMeta} from "@/lib/time/ny";

export function visibleSignals(rows:SignalRow[]) {
 return liveOnly(rows).filter(s=>!s.suppressed&&!s.stale_data);
}
export function signalSnapshot(rows:SignalRow[],nowSec:number) {
 const visible=visibleSignals(rows),day=nyMeta(nowSec).dateKey;
 const today=visible.filter(s=>nyMeta(Date.parse(s.signal_ts)/1000).dateKey===day);
 const closed=visible.filter(s=>s.pnl_usd!==null&&s.exit_ts&&nyMeta(Date.parse(s.exit_ts)/1000).dateKey===day);
 const open=visible.filter(s=>s.status==="triggered"||s.status==="pending");
 return {today:today.length,open:open.length,closed:closed.length,net:closed.reduce((a,s)=>a+s.pnl_usd!,0),recent:visible.slice(0,3)};
}
/** Keep the recent history window, plus every open/today row for exact headlines.
 * Two UTC days cover the entire current New York date in both DST regimes. */
export async function readSignalRows(db:SupabaseClient,now=Date.now()):Promise<SignalRow[]> {
 const recent=await db.from("signals").select("*").order("signal_ts",{ascending:false}).order("id",{ascending:false}).limit(200);
 if(recent.error)throw new Error(recent.error.message);
 const rows=new Map<number,SignalRow>((recent.data??[]).map(s=>[s.id,s as SignalRow]));
 const since=new Date(now-2*86400000).toISOString();
 for(let offset=0;;offset+=500){
  const page=await db.from("signals").select("*").or(`signal_ts.gte.${since},exit_ts.gte.${since},status.eq.pending,status.eq.triggered`).order("id",{ascending:true}).range(offset,offset+499);
  if(page.error)throw new Error(page.error.message);
  for(const row of page.data??[])rows.set(row.id,row as SignalRow);
  if((page.data?.length??0)<500)break;
 }
 return [...rows.values()].sort((a,b)=>b.signal_ts.localeCompare(a.signal_ts)||b.id-a.id);
}
