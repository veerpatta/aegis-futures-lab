/** Apply one SQL migration file in a single transaction over DATABASE_URL.
 *
 *   tsx scripts/experiment/apply-migration.ts db/migrations/20261007_experiment_learner.sql
 *
 * Sends the file as one simple-protocol query, so dollar-quoted trigger
 * functions survive intact (statement splitters break them). Run it against a
 * throwaway branch first, then production. Prints table counts, never the URL. */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: apply-migration.ts <file.sql>");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = readFileSync(file, "utf8");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
  const r = await client.query(
    "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'experiment%'");
  console.log(`Applied ${file}: ${r.rows[0].tables} experiment tables/views present on ${new URL(url).hostname.split(".")[0]}.`);
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
