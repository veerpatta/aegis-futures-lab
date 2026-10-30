import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { verifyNeonResearchUser } from '@/lib/ai-auth/verify';
import { requireOwner } from '@/lib/ai-auth/owner';
import { actualUsageMicros, budgetedRequest } from '@/lib/ai-budget';
import { PgBudgetStore } from '@/lib/ai-budget/pg';
import { OpenAiHttpError, RESEARCH_MODEL } from '@/lib/ai-research/provider';
import { callDiagnostic, DIAGNOSTIC_INPUT_LIMIT, DIAGNOSTIC_OUTPUT_LIMIT, DIAGNOSTIC_REQUEST_ID, makeDiagnosticPost } from '@/lib/ai-research/diagnostic';
import { ResearchStore } from '@/lib/ai-store/research';

export const runtime='nodejs';
export const dynamic='force-dynamic';
let connection:Pool|undefined;
function pool() {
  if (!process.env.AI_DATABASE_URL) throw new Error('Database unavailable');
  return connection ??= new Pool({connectionString:process.env.AI_DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,allowExitOnIdle:true});
}
export const POST = makeDiagnosticPost({
  authenticate:async request=>requireOwner(await verifyNeonResearchUser(request),async id=>(await pool().query('SELECT 1 FROM public.admin_control_authorized WHERE user_id=$1',[id])).rows.length===1),
  run:async userId=>{
    const key=process.env.OPENAI_API_SECRET;
    if(!key) throw new Error('Provider unavailable');
    // Conservatively account for even the published 6x tier and 10% regional
    // premium; the request explicitly asks for the standard tier.
    const price={model:RESEARCH_MODEL,inputMicrosPerMillion:13_200_000,outputMicrosPerMillion:66_000_000,verifiedAt:Date.parse('2026-10-30T00:00:00Z'),expiresAt:Date.parse('2026-11-30T00:00:00Z')};
    const db=pool(), records=new ResearchStore(db); let recorded=false;
    try {
    const result=await budgetedRequest(new PgBudgetStore(db),{
      requestId:DIAGNOSTIC_REQUEST_ID,userId,model:RESEARCH_MODEL,inputLimit:DIAGNOSTIC_INPUT_LIMIT,outputLimit:DIAGNOSTIC_OUTPUT_LIMIT,
      // Fixed nine-byte input and at most 128 output tokens; a 100-token input
      // budget and the conservative rates above reserve $0.009768.
      price,now:Date.now(),
    },async()=>{
      const saved=await records.saveRequest({id:DIAGNOSTIC_REQUEST_ID,userId,question:'Fixed one-time connectivity check',snapshot:[],snapshotHash:createHash('sha256').update('[]').digest('hex'),model:RESEARCH_MODEL,promptVersion:'one-time-connectivity-v1'});
      if(!saved) throw new Error('Unable to record request');
      recorded=true;
      return callDiagnostic(key);
    });
    if(!result.usage) throw new Error('Usage unavailable');
    const outcome={status:result.status,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,countedMicrodollars:actualUsageMicros(result.usage,price)};
    const saved=await records.saveResult({requestId:DIAGNOSTIC_REQUEST_ID,userId,response:outcome,citations:[],status:result.status==='connected'?'complete':'invalid'});
    if(!saved) throw new Error('Unable to record result');
    return outcome;
    } catch(error) {
      if(recorded) {
        const diagnostic=error instanceof OpenAiHttpError?{kind:'provider_http',httpStatus:error.status,code:error.code}:{kind:'unavailable'};
        await records.saveResult({requestId:DIAGNOSTIC_REQUEST_ID,userId,response:diagnostic,citations:[],status:'error'}).catch(()=>{});
      }
      throw error;
    }
  },
});
