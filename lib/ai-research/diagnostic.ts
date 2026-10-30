import type { AiIdentity } from '@/lib/ai-auth/verify';
import { OpenAiHttpError, RESEARCH_MODEL, safeProviderCode } from './provider';

// This identifier is deliberately constant. The database's unique reservation
// key prevents concurrent calls, retries and repeated paid tests, even if the
// first response is lost. A different attempt requires a reviewed code change.
export const DIAGNOSTIC_REQUEST_ID = 'aegis-owner-connectivity-20261030-v1';
export const DIAGNOSTIC_INPUT_LIMIT = 100;
export const DIAGNOSTIC_OUTPUT_LIMIT = 32;
const json = (body: unknown, status=200) => Response.json(body, {status,headers:{'Cache-Control':'no-store'}});

export async function callDiagnostic(key: string, transport: typeof fetch = fetch) {
  if (!key) throw new Error('Provider unavailable');
  const response = await transport('https://api.openai.com/v1/responses', {
    method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
    body:JSON.stringify({model:RESEARCH_MODEL,service_tier:'default',store:false,max_output_tokens:DIAGNOSTIC_OUTPUT_LIMIT,
      input:'Reply OK.',reasoning:{effort:'low'}}),
  });
  if (!response.ok) throw new OpenAiHttpError(response.status,await safeProviderCode(response));
  const result = await response.json() as {status?:string;service_tier?:string;output?:{type?:string;content?:{type?:string;text?:string}[]}[];usage?:{input_tokens?:number;output_tokens?:number}};
  // Any unexpected tier or missing usage stays fully reserved for review.
  if (result.service_tier !== 'default') throw new Error('Unexpected provider tier');
  const usage = result.usage && typeof result.usage.input_tokens === 'number' && typeof result.usage.output_tokens === 'number'
    ? {inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens} : null;
  const hasText = result.output?.some(item=>item.type==='message' && item.content?.some(part=>part.type==='output_text' && typeof part.text==='string' && part.text.length>0)) ?? false;
  const status=result.status==='completed' && hasText ? 'connected' as const : 'incomplete' as const;
  return {value:{status,usage},usage};
}

export type DiagnosticResult = {status:'connected'|'incomplete';inputTokens:number;outputTokens:number;countedMicrodollars:number};
export function makeDiagnosticPost(deps: {authenticate(request:Request):Promise<AiIdentity>; run(userId:string):Promise<DiagnosticResult>}) {
  return async (request:Request):Promise<Response> => {
    const identity = await deps.authenticate(request).catch(()=>({ok:false as const,status:503 as const,error:'Owner verification is temporarily unavailable.'}));
    if (!identity.ok) return json({error:identity.error},identity.status);
    try { return json(await deps.run(identity.userId)); }
    catch(error) {
      if (error instanceof OpenAiHttpError) return json({status:'provider_rejected',httpStatus:error.status,code:error.code},503);
      if (error instanceof Error && error.message==='Request already reserved; do not retry the provider call.') return json({error:'This one-time diagnostic was already attempted; do not retry it.'},409);
      return json({error:'The diagnostic could not be completed. Do not retry an uncertain request.'},503);
    }
  };
}
