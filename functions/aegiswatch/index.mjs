// Read-only watchdog. No orders, no dispatch, no writes. All dates UTC except CME holidays.
const holidays=["2026-01-01","2026-04-03","2026-11-26","2026-12-25","2027-01-01","2027-03-26","2027-11-25","2027-12-24"];
function assess(now, engine, learner, clock, holidays) {
 const f=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
 const slots=[];const base=Math.floor((now-10*60000)/60000)*60000;
 for(let i=0;i<180;i++){const t=base-i*60000,d=new Date(t),w=d.getUTCDay(),h=d.getUTCHours(),m=d.getUTCMinutes();if(holidays.includes(f.format(d)))continue;
 if((w>=1&&w<=5&&((h>=5&&h<=21&&[6,21,36,51].includes(m))||((h<5||h>21)&&m===6)))||(w===0&&h>=22&&m===6))slots.push(t);
 if(slots.length===2)break;}
 if(slots.length<2)return {status:"outside-window-or-grace"};
 const d=new Date(now),w=d.getUTCDay();if(w===6||(w===0&&d.getUTCHours()<22)||holidays.includes(f.format(d)))return {status:"outside-window-or-grace"};
 const e=Date.parse(engine??""),l=Date.parse(learner??""),c=Date.parse(clock??"");
 const problems=[];if(!Number.isFinite(e)||e<slots[1])problems.push("engine-completion-overdue");if(!Number.isFinite(l)||l<slots[1])problems.push("learner-completion-overdue");if(!Number.isFinite(c)||c<slots[1])problems.push("clock-dispatch-overdue");
 return {status:problems.length?"degraded":"healthy",problems,engine,learner,clock,expectedSince:new Date(slots[1]).toISOString()};
}
const query="SELECT (SELECT max(ran_at)::text FROM public.engine_runs WHERE status='ok'), (SELECT max(r.finished_at)::text FROM public.experiment_runs r JOIN public.experiments e ON e.id=r.experiment_id WHERE r.job='tick' AND r.status='ok' AND e.lineage='learner'), (SELECT max(fired_at)::text FROM public.engine_clock WHERE route='engine' AND outcome='dispatched')";
const reply=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export default {async fetch(req){
 const path=new URL(req.url).pathname;
 if(req.method==="GET"&&path==="/health")return reply({ok:true,service:"aegiswatch",mode:"read-only"});
 if(req.method!=="POST"||path!=="/check")return reply({error:"not found"},404);
 const id=req.headers.get("x-neon-trigger-invocation-id");if(!id)return reply({error:"not a trigger"},401);
 let body;try{body=await req.json()}catch{return reply({error:"invalid trigger"},400)}
 if(body.version!==1||body.invocation_id!==id||body.trigger?.type!=="schedule"||!["aegiswatch-day","aegiswatch-night","aegiswatch-sunday"].includes(body.trigger.name))return reply({error:"invalid trigger"},403);
 const now=Date.now(), scheduled=Date.parse(body.data?.scheduled_at??"");
 if(!Number.isFinite(scheduled)||scheduled>now+60000||now-scheduled>600000)return reply({status:"stale-trigger"});
 try{
  const conn=process.env.DATABASE_URL;if(!conn)throw Error("missing database");
  const host=new URL(conn).hostname.replace(/^[^.]+\./,"api.");
  const r=await fetch("https://"+host+"/sql",{method:"POST",headers:{"content-type":"application/json","Neon-Connection-String":conn,"Neon-Raw-Text-Output":"true","Neon-Array-Mode":"true"},body:JSON.stringify({query,params:[]}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error("database unavailable");
  const row=(await r.json()).rows?.[0];if(!Array.isArray(row)||row.length!==3)throw Error("invalid result");
  const result=assess(now,...row,holidays);console.log("AEGIS_WATCH "+JSON.stringify(result));return reply(result);
 }catch{console.error("AEGIS_WATCH database-unreadable");return reply({status:"database-unreadable"},503)}
}};