/** Keep the engine clock's GitHub key in step with the Actions secret.
 *
 *   ENGINE_DISPATCH_TOKEN=<key> DATABASE_URL=... npx tsx scripts/clock/sync-token.ts
 *
 * Runs near the start of every signal-engine pass (.github/workflows/signal-engine.yml).
 * The Neon clock function (functions/aegisclock) reads the key from
 * aegis_private.engine_clock_token, which only the database owner can read.
 *
 * - secret absent or empty: nothing happens (the clock idles; the slow GitHub
 *   schedule still runs the engine)
 * - secret = "off": the stored key is removed
 * - secret = a GitHub token: stored, or left alone when unchanged
 * - anything else: refused with a warning, never stored
 *
 * The key is never printed (GitHub also masks secrets in logs). No money, no
 * trading: the key only lets the clock start this repository's workflows. */
import pg from "pg";
import { syncAction } from "@/lib/clock/token";

async function main() {
  const raw = process.env.ENGINE_DISPATCH_TOKEN;
  const action = syncAction(raw);
  if (action === "unset") {
    console.log("Engine clock key not set — the 15-minute clock stays idle (optional; see docs/ENGINE-CLOCK.md).");
    return;
  }
  if (action === "invalid") {
    console.log("::warning::ENGINE_DISPATCH_TOKEN is not a GitHub token (expected github_pat_… or ghp_…); nothing was stored.");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const parsed = new URL(url);
  if (!parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "require");
  const client = new pg.Client({ connectionString: parsed.toString() });
  await client.connect();
  try {
    if (action === "clear") {
      const r = await client.query("DELETE FROM aegis_private.engine_clock_token WHERE id = 1");
      console.log(r.rowCount ? "Engine clock key removed; the clock is idle." : "No engine clock key was stored.");
      return;
    }
    const r = await client.query(
      `INSERT INTO aegis_private.engine_clock_token(id, token) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token, updated_at = now()
       WHERE aegis_private.engine_clock_token.token IS DISTINCT FROM EXCLUDED.token`,
      [raw!.trim()],
    );
    console.log(r.rowCount ? "Engine clock key stored; the clock starts the engine from its next trigger." : "Engine clock key unchanged.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Best effort: the engine pass continues whatever happens here.
  console.log(`::warning::Engine clock key sync failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`);
});
