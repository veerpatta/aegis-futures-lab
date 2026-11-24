/* A separately deployed standby. Off unless explicitly armed AND the database approves the build.
   No GitHub dispatch, paid APIs or broker. The database guard is non-expiring. */
import { Pool } from "pg";
import { parseTriggerDelivery } from "@neon/functions/triggers";
import { claim, release } from "@/lib/resilience/guard";
import { twoMissedSlots } from "@/lib/resilience/schedule";
import { runJob } from "@/lib/experiment/jobs";
import { PgStore, experimentPool } from "@/lib/experiment/store-pg";
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
let gate:Pool|undefined;
export default {async fetch(req:Request){
 const path=new URL(req.url).pathname.replace(/\/+$/,"")||"/";
 const enabled=process.env.AEGIS_STANDBY_ENABLED==="true";
 if(req.method==="GET"&&path==="/health")return json({ok:true,mode:enabled?"armed":"disabled",paperOnly:true});
 if(req.method!=="POST"||!["/engine","/learn","/review"].includes(path))return json({error:"not found"},404);
 const parsed=await parseTriggerDelivery(req);
 if(!parsed.ok||parsed.invocation.type!=="schedule")return json({error:"not a schedule"},403);
 const inv=parsed.invocation;
 const expected:Record<string,string>={"aegisstandby-day":"/engine","aegisstandby-night":"/engine","aegisstandby-sunday":"/engine","aegisstandby-learn":"/learn","aegisstandby-review":"/review"};
 if(expected[inv.trigger.name]!==path)return json({error:"wrong trigger"},403);
 const now=Date.now(),scheduled=Date.parse(inv.data.scheduledAt);
 if(!Number.isFinite(scheduled)||scheduled>now+60000||now-scheduled>600000)return json({status:"stale-trigger"});
 if(!enabled)return json({status:"disabled"});
 const sha=process.env.AEGIS_CODE_SHA??"";
 if(!/^[a-f0-9]{40}$/.test(sha)||process.env.AEGIS_STANDBY_POLICY_READY!=="true"||!process.env.DATABASE_URL)return json({status:"configuration-incomplete"},503);
 try{
  gate??=new Pool({connectionString:process.env.DATABASE_URL,max:1,allowExitOnIdle:true});
  const c=await claim(gate,"standby",sha);
  if(c.kind!=="owned")return json({status:c.kind});
  const db=experimentPool();
  const job=path==="/engine"?"tick":path==="/learn"?"learn":"review";
  const r=await db.query("SELECT max(r.finished_at) AS latest FROM public.experiment_runs r JOIN public.experiments e ON e.id=r.experiment_id WHERE e.lineage='learner' AND r.job=$1 AND r.status='ok'",[job]);
  const latest=Date.parse(String(r.rows[0]?.latest??""))||0;
  const e=path==="/engine"?await db.query("SELECT max(ran_at) AS latest FROM public.engine_runs WHERE status='ok'"):null;
  const engineLatest=Date.parse(String(e?.rows[0]?.latest??""))||0;
  const due=path==="/engine"?twoMissedSlots(now,Math.min(latest,engineLatest)):now-latest>(job==="learn"?26:8*24)*3600000;
  if(!due){await release(gate,c.token);return json({status:"healthy"});}
  if(path==="/engine"){
   const {runEngine}=await import("../../scripts/engine/run-live");
   const {publishMarketBatch}=await import("../../scripts/experiment/publish");
   await runEngine();
   await publishMarketBatch();
  }
  const result=await runJob({job,invocationId:"standby:"+inv.invocationId,trigger:"neon",store:new PgStore(db),lineage:"learner",scheduledAt:Math.floor(scheduled/1000),codeSha:sha});
  if(result.status!=="ok"&&result.status!=="skipped"&&result.status!=="replayed")throw Error("Learner not complete");
  if(path==="/engine"){
   try{const {forwardTimeMachineStudy}=await import("../../scripts/tm-study/forward");await forwardTimeMachineStudy()}catch{console.warn("Standby forward study skipped");}
  }
  await release(gate,c.token);
  return json({status:"completed",job,result:result.status});
 }catch{console.error("Aegis standby failed; if acquired, the durable guard stays held for manual investigation");return json({status:"failed-closed"},503);}
}};
