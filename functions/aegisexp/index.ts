/* Neon Function "aegisexp": the experimental learner's scheduler entry.
   Triggers (UTC cron, see scripts/experiment/triggers.json):
     tick   every 15 min through the futures week
     learn  nightly
     review weekly
   DATABASE_URL is injected by Neon for this branch. Virtual only: there is no
   broker, no real-money path, no paid API and no data purchase in this bundle
   (scripts/experiment/bundle-function.mjs refuses to build if one sneaks in). */

import { makeHandler } from "@/lib/experiment/http";
import { PgStore, experimentPool } from "@/lib/experiment/store-pg";

const handleRequest = makeHandler({
  store: () => new PgStore(experimentPool()),
  health: async () => (await experimentPool().query("SELECT lineage, status, last_ok_tick_at, errors_24h FROM experiment_health")).rows,
  lineage: process.env.AEGIS_EXPERIMENT_LINEAGE ?? "learner",
  codeSha: process.env.AEGIS_CODE_SHA ?? null,
});

export default { fetch: handleRequest };
