/* Neon Function "aegisclock": the engine's on-time clock.

   Neon's scheduler (scripts/clock/triggers.json) calls this at :06/:21/:36/:51
   through the active hours and hourly overnight; it asks GitHub to start the
   signal-engine workflow, which fetches delayed prices, records ideas,
   publishes the batch and runs the virtual account. See lib/clock/handler.ts
   for why, and docs/ENGINE-CLOCK.md for setup.

   DATABASE_URL is injected by Neon for this branch. Nothing here trades,
   costs money or reads market data. Build and deploy with
   `node scripts/clock/bundle.mjs` (a few kilobytes, no driver bundled). */

import { handleClock } from "@/lib/clock/handler";
import { neonSql } from "@/lib/clock/neon-http";

const url = process.env.DATABASE_URL;
const sql = url ? neonSql(url) : null;

export default { fetch: (request: Request) => handleClock(request, { sql, fetch, now: Date.now }) };
