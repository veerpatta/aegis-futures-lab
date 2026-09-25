import {describe,it,expect} from "vitest";
import {signalSnapshot,readSignalRows} from "@/lib/signals/snapshot";
import type {SignalRow} from "@/lib/neon/client";
import type {SupabaseClient} from "@supabase/supabase-js";
const row=(values:Partial<SignalRow>={}):SignalRow=>({id:1,signal_ts:"2026-09-25T13:00:00Z",status:"pending",pnl_usd:null,exit_ts:null,...values} as SignalRow);
describe("shared signal snapshot",()=>{
 it("counts by New York date and closes by exit date",()=>{
  const result=signalSnapshot([row(),row({id:2,signal_ts:"2026-09-24T14:00:00Z",exit_ts:"2026-09-25T14:00:00Z",status:"hit_target",pnl_usd:32}),row({id:3,signal_ts:"2026-09-25T02:00:00Z",exit_ts:"2026-09-25T03:00:00Z",status:"hit_stop",pnl_usd:-9})],Date.parse("2026-09-25T20:00:00Z")/1000);
  expect(result).toMatchObject({today:1,open:1,closed:1,net:32});
 });
 it("excludes suppressed, stale, revised and pre-launch records everywhere",()=>{
  const result=signalSnapshot([row({suppressed:true}),row({stale_data:true}),row({orphaned:true}),row({signal_ts:"2026-01-01T12:00:00Z"})],Date.parse("2026-09-25T20:00:00Z")/1000);
  expect(result).toEqual({today:0,open:0,closed:0,net:0,recent:[]});
 });
 it("uses winter New York midnight and retains open signals from earlier days",()=>{
  const result=signalSnapshot([row({signal_ts:"2026-12-02T04:59:59Z"}),row({id:2,signal_ts:"2026-12-02T05:00:00Z"})],Date.parse("2026-12-02T06:00:00Z")/1000);
  expect(result).toMatchObject({today:1,open:2,closed:0});
 });
 it("paginates beyond the recent 200 and deduplicates overlapping records",async()=>{
  const page=Array.from({length:500},(_,i)=>row({id:i+1}));const ranges:number[]=[];
  const query={select:()=>query,order:()=>query,or:()=>query,limit:async()=>({data:[row()],error:null}),range:async(from:number)=>{ranges.push(from);return {data:from===0?page:[row({id:501})],error:null};}};
  const rows=await readSignalRows({from:()=>query} as unknown as SupabaseClient);
  expect(ranges).toEqual([0,500]);expect(rows).toHaveLength(501);
 });
});
