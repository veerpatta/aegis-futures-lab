/* Real PostgreSQL integration. Local CI service only; refuses remote/prod databases. */
import assert from "node:assert/strict";
import {Pool} from "pg";
import {readFileSync} from "node:fs";
import {claim,release} from "@/lib/resilience/guard";
async function main(){
 const url=new URL(process.env.DATABASE_URL??"");
 if(process.env.AEGIS_RESILIENCE_TEST_DB!=="true"||!["localhost","127.0.0.1"].includes(url.hostname)||url.pathname!=="/aegis_guard_test")throw Error("Refusing non-isolated database");
 const p=new Pool({connectionString:url.toString(),max:12});
 try{
  await p.query("CREATE SCHEMA IF NOT EXISTS aegis_private");
  await p.query(readFileSync("db/migrations/20261124_runner_guard.sql","utf8"));
  assert.deepEqual(await claim(p,"standby","approved"),{kind:"disabled"});
  await p.query("UPDATE aegis_private.runner_guard SET enabled=true,approved_standby_sha='approved' WHERE id=1");
  assert.deepEqual(await claim(p,"standby","wrong"),{kind:"unapproved"});
  const claims=await Promise.all(Array.from({length:10},(_,i)=>claim(p,i%2?"standby":"primary","approved")));
  const holders=claims.filter(c=>c.kind==="owned");
  assert.equal(holders.length,1);
  const holder=holders[0];if(holder.kind!=="owned")throw Error("No holder");
  await assert.rejects(release(p,"wrong"));
  assert.deepEqual(await claim(p,"standby","approved"),{kind:"busy"});
  // Losing a DB connection must not grant the next writer permission.
  await p.end();
  const q=new Pool({connectionString:url.toString()});
  try{
   assert.deepEqual(await claim(q,"primary",""),{kind:"busy"});
   await release(q,holder.token);
   const c=await claim(q,"standby","approved");
   assert.equal(c.kind,"owned");
   if(c.kind==="owned")await release(q,c.token,false);
   console.log("Real PostgreSQL guard: 10 concurrent contenders, one holder; crash lock, wrong token, wrong SHA, disabled state and safe handover passed");
  }finally{await q.end();}
 }finally{await p.end().catch(()=>{});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
