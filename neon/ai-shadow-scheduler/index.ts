/** Dedicated Neon Function Trigger forwarder. Only deploy behind the Neon
 * native edge: it strips client-supplied x-neon-* headers before invocation.
 * Header/body checks alone are not a general-purpose request signature. */
import { parseTriggerDelivery } from '@neon/functions/triggers';

export const SHADOW_SCHEDULER_TARGET='https://aegis-futures-lab-khaki.vercel.app/api/ai/shadow/cron';
const TRIGGER_NAME='aegis-shadow-forward';

export async function forwardShadowTrigger(request:Request, secret:string|undefined, transport:typeof fetch=fetch, now=Date.now()):Promise<Response> {
  if (request.method!=='POST') return new Response('Method not allowed',{status:405});
  const parsed=await parseTriggerDelivery(request);
  if (!parsed.ok) return new Response('Invalid trigger delivery',{status:parsed.error==='invalid_body'?400:401});
  if (parsed.invocation.type!=='schedule' || parsed.invocation.trigger.name!==TRIGGER_NAME) return new Response('Invalid trigger',{status:403});
  const scheduled=Date.parse(parsed.invocation.data.scheduledAt);
  if (!Number.isFinite(scheduled) || !Number.isFinite(now) || scheduled>now+60_000 || now-scheduled>20*60_000) return new Response('Expired trigger',{status:403});
  if (!secret || Buffer.byteLength(secret,'utf8')<32) return new Response('Scheduler is not configured',{status:503});
  try {
    const response=await transport(SHADOW_SCHEDULER_TARGET,{method:'GET',headers:{Authorization:`Bearer ${secret}`},redirect:'manual',signal:AbortSignal.timeout(45_000)});
    await response.body?.cancel().catch(()=>{});
    if (!response.ok) return new Response('Shadow service unavailable',{status:502});
    return new Response('OK',{status:200});
  } catch {return new Response('Shadow service unavailable',{status:502});}
}
export default {fetch(request:Request) {return forwardShadowTrigger(request,process.env.AI_SHADOW_CRON_SECRET);}};
