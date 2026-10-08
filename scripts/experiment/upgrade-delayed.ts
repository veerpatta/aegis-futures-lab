/** Owner-authorized repair. All preconditions are checked again in one transaction. */
import { PgStore, experimentPool } from "@/lib/experiment/store-pg";
async function main() {
  const pool = experimentPool();
  try { console.log(JSON.stringify(await new PgStore(pool).upgradeDelayed())); }
  finally { await pool.end(); }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : "Upgrade failed"); process.exitCode = 1; });
