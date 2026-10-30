import { Pool } from "pg";
import { verifyNeonResearchUser } from "@/lib/ai-auth/verify";
import { requireOwner } from "@/lib/ai-auth/owner";
import { controlApi } from "@/lib/experiment/control-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let connection: Pool | undefined;
function pool() {
  if (!process.env.AI_DATABASE_URL) throw new Error("Database unavailable");
  return connection ??= new Pool({connectionString:process.env.AI_DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,allowExitOnIdle:true});
}
const handle = controlApi({
  authenticate: async request => requireOwner(await verifyNeonResearchUser(request), async id => (await pool().query("SELECT 1 FROM public.admin_control_authorized WHERE user_id=$1",[id])).rows.length === 1),
  list: async userId => {
    const commands = (await pool().query("SELECT id,action,reason,status,created_at,completed_at,result FROM public.admin_control_commands WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20",[userId])).rows;
    const row = (await pool().query("SELECT experiment_id,campaign_status FROM public.ai_research_evidence WHERE experiment_id ~ '^learner-[0-9]+$' LIMIT 1")).rows[0];
    return { commands, campaign: row ? { id: String(row.experiment_id), status: String(row.campaign_status) } : null };
  },
  enqueue: async v => { await pool().query("INSERT INTO public.admin_control_commands(id,owner_id,action,reason,expected_experiment_id) VALUES($1,$2,$3,$4,$5)",[v.id,v.userId,v.action,v.reason,v.expectedId]); },
});
export const GET = handle;
export const POST = handle;
