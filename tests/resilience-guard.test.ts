import {describe,it,expect} from "vitest";
import {claim,release,READ,CLAIM,RELEASE,type GuardDB} from "@/lib/resilience/guard";
import {twoMissedSlots} from "@/lib/resilience/schedule";
function fake(enabled=true,sha="approved"){
 let owner:string|null=null;
 const db:GuardDB={async query(sql,p=[]){
  if(sql===READ)return {rows:[{enabled,owner,approved_standby_sha:sha}]};
  if(sql===CLAIM&&enabled&&owner===null&&(p[1]==="primary"||p[2]===sha)){owner=String(p[0]);return {rows:[{owner}]};}
  if(sql===RELEASE&&owner===p[0]){owner=null;return {rows:[{id:1}]};}
  return {rows:[]};
 }};
 return db;
}
describe("resilience durable guard",()=>{
 it("starts disabled",async()=>expect(await claim(fake(false),"standby","approved")).toEqual({kind:"disabled"}));
 it("rejects unapproved builds",async()=>expect(await claim(fake(),"standby","other")).toEqual({kind:"unapproved"}));
 it("one concurrent winner",async()=>{const db=fake();const a=await Promise.all([claim(db,"primary",""),claim(db,"standby","approved")]);expect(a.filter(x=>x.kind==="owned")).toHaveLength(1)});
 it("no takeover on crashed holder",async()=>{const db=fake();await claim(db,"primary","");expect(await claim(db,"standby","approved")).toEqual({kind:"busy"})});
 it("wrong token cannot release",async()=>{const db=fake();await claim(db,"primary","");await expect(release(db,"wrong")).rejects.toThrow();expect(await claim(db,"standby","approved")).toEqual({kind:"busy"})});
 it("handover after explicit completion",async()=>{const db=fake();const a=await claim(db,"primary","");if(a.kind!=="owned")throw Error();await release(db,a.token);expect((await claim(db,"standby","approved")).kind).toBe("owned")});
 it("detects missed completions but not healthy",()=>{const now=Date.parse("2026-11-24T16:53Z");expect(twoMissedSlots(now,Date.parse("2026-11-24T16:06Z"))).toBe(true);expect(twoMissedSlots(now,Date.parse("2026-11-24T16:51Z"))).toBe(false)});
 it("does not alert on weekend or holiday",()=>{expect(twoMissedSlots(Date.parse("2026-11-28T16:53Z"),0)).toBe(false);expect(twoMissedSlots(Date.parse("2026-11-26T16:53Z"),0)).toBe(false)});
 it("does not use daytime threshold overnight",()=>expect(twoMissedSlots(Date.parse("2026-11-24T02:23Z"),Date.parse("2026-11-24T01:07Z"))).toBe(false));
});
