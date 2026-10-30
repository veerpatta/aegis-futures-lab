import { describe, expect, it } from "vitest";
import { PgStore } from "@/lib/experiment/store-pg";

function fixture(options: {authorized?:boolean; failChange?:boolean; action?:"pause"|"resume"|"stop"|"start"} = {}) {
  const calls:{sql:string;args?:unknown[]}[]=[];
  const command={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",owner_id:"owner",action:options.action ?? "pause",reason:"Private family detail in reason",expected_experiment_id:"learner-1"};
  const current={id:"learner-1",status:options.action === "resume" ? "paused" : options.action === "start" ? "stopped" : "active",campaign:1};
  const client={async query(sql:string,args?:unknown[]) {
    calls.push({sql,args});
    if(sql.includes("to_regclass")) return {rows:[{t:"admin_control_commands"}]};
    if(sql.includes("SELECT * FROM public.admin_control_commands")) return {rows:[command]};
    if(sql.includes("FROM neon_auth.")) return {rows:options.authorized===false?[]:[{ok:1}]};
    if(sql.includes("SELECT * FROM experiments WHERE lineage")) return {rows:[current]};
    if(sql.includes("SELECT * FROM experiments WHERE id=")) return {rows:[current]};
    if(sql.includes("SELECT count(*)::int n FROM experiment_positions")) return {rows:[{n:0}]};
    if(sql.includes("INSERT INTO experiment_changes")) return {rows:[{id:10}]};
    if(options.failChange && sql.startsWith("UPDATE experiments")) throw Error("private database detail");
    return {rows:[]};
  },release(){}};
  return {store:new PgStore({connect:async()=>client} as never),calls};
}
describe("owner worker transaction",()=>{
  it("rechecks authorization and serializes against learner and tick before applying",async()=>{
    const {store,calls}=fixture(); await store.processOwnerCommand();
    const account=calls.findIndex(x=>x.sql.includes("FOR SHARE OF u"));
    const learner=calls.findIndex(x=>x.sql.includes("aegis-exp:control:"));
    const tick=calls.findIndex(x=>x.sql.includes("aegis-exp:'"));
    const change=calls.findIndex(x=>x.sql.startsWith("UPDATE experiments"));
    expect(account).toBeGreaterThan(-1); expect(account).toBeLessThan(learner); expect(learner).toBeLessThan(tick); expect(tick).toBeLessThan(change);
    expect(calls.find(x=>x.sql.startsWith("UPDATE public.admin_control_commands"))?.args?.[1]).toBe("applied");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("records failure without changing the learner if the administrator is revoked",async()=>{
    const {store,calls}=fixture({authorized:false}); await store.processOwnerCommand();
    expect(calls.some(x=>x.sql.startsWith("UPDATE experiments"))).toBe(false);
    expect(calls.some(x=>x.sql==="ROLLBACK TO SAVEPOINT owner_command")).toBe(true);
    expect(calls.find(x=>x.sql.startsWith("UPDATE public.admin_control_commands"))?.args?.slice(1)).toEqual(["failed","Owner authorization was revoked."]);
  });
  it("rolls back a partially applied command and stores only a safe error",async()=>{
    const {store,calls}=fixture({failChange:true}); await store.processOwnerCommand();
    expect(calls.some(x=>x.sql==="ROLLBACK TO SAVEPOINT owner_command")).toBe(true);
    expect(calls.find(x=>x.sql.startsWith("UPDATE public.admin_control_commands"))?.args?.slice(1)).toEqual(["failed","Command could not be applied."]);
  });
  it.each(["pause","resume","stop","start"] as const)("keeps the private reason out of public %s writes",async(action)=>{
    const {store,calls}=fixture({action}); await store.processOwnerCommand();
    const writes=calls.filter(x=>/^\s*(INSERT INTO experiment|UPDATE experiments)/.test(x.sql));
    expect(writes.length).toBeGreaterThan(0);
    expect(JSON.stringify(writes)).not.toContain("Private family detail");
    const audit=writes.find(x=>x.sql.includes("INSERT INTO experiment_changes"));
    expect(audit?.args).toContain("owner-command:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(calls.find(x=>x.sql.startsWith("UPDATE public.admin_control_commands"))?.args?.[1]).toBe("applied");
  });
});
