/* One lazy connection pool per server instance for the AI helper routes, on
   the restricted aegis_ai login (AI_DATABASE_URL), never the owner URL. */

import { Pool } from "pg";

let connection: Pool | undefined;

export const aiDatabaseConfigured = (): boolean => Boolean(process.env.AI_DATABASE_URL);

export function aiPool(): Pool {
  const url = process.env.AI_DATABASE_URL;
  if (!url) throw new Error("AI database is not configured");
  if (!connection) connection = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, allowExitOnIdle: true });
  return connection;
}
