/* One lazy connection pool per server instance for the AI helper routes, on
   the restricted aegis_ai login (AI_DATABASE_URL), never the owner URL. */

import { Pool } from "pg";

let connection: Pool | undefined;
/** No AI helper query may run longer than this (also enforced on the server). */
export const AI_QUERY_TIMEOUT_MS = 10_000;

export const aiDatabaseConfigured = (): boolean => Boolean(process.env.AI_DATABASE_URL);

export function aiPool(): Pool {
  const url = process.env.AI_DATABASE_URL;
  if (!url) throw new Error("AI database is not configured");
  // A client-side cap on every query: the server-side statement_timeout is set
  // on the AI login role by the migration (a startup parameter would be
  // refused by Neon's connection pooler).
  if (!connection) connection = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, query_timeout: AI_QUERY_TIMEOUT_MS, allowExitOnIdle: true });
  return connection;
}
