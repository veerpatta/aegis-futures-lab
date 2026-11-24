import { randomUUID } from "node:crypto";
export interface GuardDB { query(sql: string, params?: unknown[]): Promise<{rows: Record<string, unknown>[]; rowCount?: number | null}> }
export const READ = "SELECT enabled,owner,approved_standby_sha FROM aegis_private.runner_guard WHERE id=1";
export const CLAIM = "UPDATE aegis_private.runner_guard SET owner=$1, acquired_at=clock_timestamp() WHERE id=1 AND enabled AND owner IS NULL AND ($2='primary' OR approved_standby_sha=$3) RETURNING owner";
export const RELEASE = "UPDATE aegis_private.runner_guard SET owner=NULL,acquired_at=NULL,last_completed_at=CASE WHEN $2::boolean THEN clock_timestamp() ELSE last_completed_at END WHERE id=1 AND owner=$1 RETURNING id";
export type Claim = { kind: "disabled" | "busy" | "unapproved" } | { kind: "owned"; token: string };
export async function claim(db: GuardDB, mode: "primary" | "standby", sha: string): Promise<Claim> {
 const row=(await db.query(READ)).rows[0];
 if (!row) throw Error("Runner guard missing");
 if (row.enabled !== true) return {kind:"disabled"};
 if (mode==="standby" && (!sha || row.approved_standby_sha!==sha)) return {kind:"unapproved"};
 if (row.owner!=null) return {kind:"busy"};
 const token=mode+":"+randomUUID();
 const got=await db.query(CLAIM,[token,mode,sha]);
 return got.rows.length===1 ? {kind:"owned",token} : {kind:"busy"};
}
export async function release(db:GuardDB,token:string,completed=true):Promise<void> {
 if ((await db.query(RELEASE,[token,completed])).rows.length!==1) throw Error("Runner ownership lost; investigate");
}
// Deliberately no TTL-based takeover. A failed/aborted process retains ownership.
// Enable only after all production writers have the guard and all old runs are drained.
