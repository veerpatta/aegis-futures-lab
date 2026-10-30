import {describe,expect,it,vi} from 'vitest';
import {forwardShadowTrigger, SHADOW_SCHEDULER_TARGET} from '@/neon/ai-shadow-scheduler/index';
const now=Date.parse('2026-10-30T12:00:00Z'),secret='a'.repeat(40);
const payload={version:1,invocation_id:'delivery',trigger:{type:'schedule',id:'trigger-id',name:'aegis-shadow-forward'},data:{scheduled_at:new Date(now).toISOString()}};
const req=(body:unknown=payload,header:string|null='delivery')=>new Request('https://example.invalid/schedule',{method:'POST',headers:{'content-type':'application/json',...(header?{'x-neon-trigger-invocation-id':header}:{})},body:JSON.stringify(body)});
describe('Neon shadow scheduler forwarder',()=>{
 it('refuses missing or inconsistent Neon delivery metadata before forwarding',async()=>{
  const fetcher=vi.fn();
  expect((await forwardShadowTrigger(req(payload,null),secret,fetcher,now)).status).toBe(401);
  expect((await forwardShadowTrigger(req(payload,'other'),secret,fetcher,now)).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('refuses a different trigger, stale delivery, or missing secret',async()=>{
  const fetcher=vi.fn();
  expect((await forwardShadowTrigger(req({...payload,trigger:{...payload.trigger,name:'other'}}),secret,fetcher,now)).status).toBe(403);
  expect((await forwardShadowTrigger(req(payload),secret,fetcher,now+21*60_000)).status).toBe(403);
  expect((await forwardShadowTrigger(req(payload),'',fetcher,now)).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('calls only the fixed URL using a server-side bearer with redirects disabled',async()=>{
  const fetcher=vi.fn(async()=>new Response('opaque',{status:200}));
  expect((await forwardShadowTrigger(req(),secret,fetcher,now)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
  const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe(SHADOW_SCHEDULER_TARGET);expect(options.method).toBe('GET');expect(options.redirect).toBe('manual');
  expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${secret}`);
 });
 it('does not expose upstream error body, headers, or secrets',async()=>{
  const fetcher=vi.fn(async()=>new Response(secret,{status:302,headers:{location:'https://evil.invalid'}}));
  const res=await forwardShadowTrigger(req(),secret,fetcher,now);
  expect(res.status).toBe(502);expect(await res.text()).not.toContain(secret);expect(res.headers.get('location')).toBeNull();
 });
});
