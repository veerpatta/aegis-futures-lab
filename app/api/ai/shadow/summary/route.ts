import { Pool } from 'pg';
import { verifyNeonResearchUser } from '@/lib/ai-auth/verify';
import { ShadowStore } from '@/lib/ai-store/shadow';
import { readShadowSummary } from '@/lib/ai-shadow/summary';

export const runtime='nodejs';
export const dynamic='force-dynamic';
let connection:Pool|undefined;
function pool():Pool {
  const url=process.env.AI_DATABASE_URL;
  if (!url) throw new Error('AI database is not configured');
  if (!connection) connection=new Pool({connectionString:url,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,allowExitOnIdle:true});
  return connection;
}
export async function GET(request:Request):Promise<Response> {
  const identity=await verifyNeonResearchUser(request).catch(()=>({ok:false as const,status:503 as const,error:'Sign-in verification is temporarily unavailable.'}));
  if (!identity.ok) return Response.json({error:identity.error},{status:identity.status,headers:{'Cache-Control':'no-store'}});
  const id=process.env.AI_SHADOW_STUDY_ID;
  if (!id) return Response.json({status:'not-configured'},{headers:{'Cache-Control':'no-store'}});
  try {
    const db=pool(),study=await new ShadowStore(db).getStudy(id);
    if (!study) throw new Error('Study unavailable');
    return Response.json(await readShadowSummary(db,study),{headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({error:'Shadow study is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
