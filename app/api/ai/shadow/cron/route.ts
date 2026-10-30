/** Separately authenticated, best-effort processing of explicitly registered
 * shadow snapshots. This endpoint never modifies learner or account state. */
import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { PgBudgetStore } from '@/lib/ai-budget/pg';
import { ShadowStore } from '@/lib/ai-store/shadow';
import { authorizeShadowScheduler, processShadowIdea, SHADOW_MODEL, shadowOpenAiProvider } from '@/lib/ai-shadow/processor';
import { processShadowOutcomes } from '@/lib/ai-shadow/outcome-runner';

export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';

let connection:Pool|undefined;
function pool():Pool {
  const url=process.env.AI_DATABASE_URL;
  if (!url) throw new Error('AI database is not configured');
  if (!connection) connection=new Pool({connectionString:url,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,allowExitOnIdle:true});
  return connection;
}

export async function GET(request:Request) {
  if (!authorizeShadowScheduler(request.headers.get('authorization'),process.env.AI_SHADOW_CRON_SECRET)) return NextResponse.json({error:'Unauthorized'}, {status:401});
  if (process.env.AI_SHADOW_ENABLED !== 'true') return NextResponse.json({status:'disabled'});
  const id=process.env.AI_SHADOW_STUDY_ID, key=process.env.OPENAI_API_SECRET;
  if (!id || !key || !process.env.AI_DATABASE_URL) return NextResponse.json({error:'Shadow study configuration unavailable.'},{status:503});
  try {
    const db=pool(), store=new ShadowStore(db), study=await store.getStudy(id);
    if (!study) return NextResponse.json({error:'Registered shadow study unavailable.'},{status:503});
    const outcomes=await processShadowOutcomes(db,study.id,Math.floor(Date.now()/1000));
    const ideas=await store.pending(study,1);
    const result=[];
    for (const idea of ideas) result.push((await processShadowIdea({study,idea},{store,budget:new PgBudgetStore(db),provider:shadowOpenAiProvider(key),clock:Date.now,
      price:{model:SHADOW_MODEL,inputMicrosPerMillion:2_000_000,outputMicrosPerMillion:10_000_000,verifiedAt:Date.parse('2026-10-30T00:00:00Z'),expiresAt:Date.parse('2026-11-30T00:00:00Z')}})).status);
    return NextResponse.json({status:'ok',processed:result.length,results:result,outcomes});
  } catch {
    return NextResponse.json({error:'Shadow study temporarily unavailable.'},{status:503});
  }
}
