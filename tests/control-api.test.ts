import { describe, expect, it, vi } from "vitest";
import { controlApi } from "@/lib/experiment/control-api";

const body = (value: unknown) => new Request("https://example.test/api/controls", {method:"POST",body:JSON.stringify(value)});
const command = {action:"pause",reason:"Pausing virtual learner",expectedId:"learner-1"};
function deps() {
  return { authenticate:vi.fn(async()=>({ok:true as const,userId:"owner"})), list:vi.fn(async()=>({commands:[],campaign:null})),enqueue:vi.fn(async()=>{}) };
}
describe("owner control endpoint",()=>{
  it("denies unauthenticated callers before reading or writing",async()=>{
    const d=deps(); const unauth={...d,authenticate:vi.fn(async()=>({ok:false as const,status:401 as const,error:"Sign in"}))};
    expect((await controlApi(unauth)(body(command))).status).toBe(401); expect(d.enqueue).not.toHaveBeenCalled();
  });
  it("uses only the verified owner and records a pending action",async()=>{
    const d=deps(); const response=await controlApi(d)(body(command));
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({status:"pending"});
    expect(d.enqueue).toHaveBeenCalledWith(expect.objectContaining({userId:"owner",...command}));
  });
  it("rejects unknown fields and invalid reasons without writing",async()=>{
    const d=deps();
    for(const input of [{...command,userId:"other"},{...command,reason:"short"},{...command,action:"trade"}]) expect((await controlApi(d)(body(input))).status).toBe(400);
    expect(d.enqueue).not.toHaveBeenCalled();
  });
  it("hides database errors and never reports a failed enqueue as accepted",async()=>{
    const d=deps(); d.enqueue.mockRejectedValueOnce(Error("secret database details"));
    const response=await controlApi(d)(body(command)); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
