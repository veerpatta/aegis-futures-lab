/** Owner controls for the experimental learner, run from
 * .github/workflows/experiment-control.yml (GitHub authenticates the owner).
 *
 *   tsx scripts/experiment/control.ts pause   "<reason>"
 *   tsx scripts/experiment/control.ts resume  "<reason>"
 *   tsx scripts/experiment/control.ts stop    "<reason>"
 *   tsx scripts/experiment/control.ts start   "<reason>"   (preregister the next campaign)
 *
 * Pause stops new entries; open trades keep being managed and nothing is
 * deleted. A locked campaign never reopens: "start" preregisters a new one,
 * and the lineage's lifetime totals keep every earlier loss. There is no reset.
 * Virtual only — no broker, no real money. */
import { createCampaign } from "@/lib/experiment/jobs";
import { PgStore, experimentPool } from "@/lib/experiment/store-pg";

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  const reason = rest.join(" ").trim();
  if (!reason || reason.length < 8) throw new Error("Give a reason of at least 8 characters.");
  const lineage = process.env.AEGIS_EXPERIMENT_LINEAGE ?? "learner";
  const mode = process.env.AEGIS_EXPERIMENT_MODE === "synthetic" ? "synthetic" : "live";
  const store = new PgStore(experimentPool());
  const exp = await store.activeExperiment(lineage);
  const now = Math.floor(Date.now() / 1000);
  if (action === "start") {
    if (exp && (exp.status === "active" || exp.status === "paused")) throw new Error(`Campaign ${exp.id} is still ${exp.status}; stop it first.`);
    const next = await createCampaign(store, { lineage, campaign: (exp?.campaign ?? 0) + 1, mode, startedAt: now, reason,
      executionClock: mode === "live" ? "delayed_market" : "wall_clock" });
    console.log(`Preregistered ${next.id} (${mode}).`);
  } else {
    if (!exp) throw new Error(`No experiment in lineage ${lineage}.`);
    const to = action === "pause" ? "paused" : action === "resume" ? "active" : action === "stop" ? "stopped" : null;
    if (!to) throw new Error("action must be pause, resume, stop or start");
    await store.setStatus(exp.id, to, { kind: action === "pause" ? "paused" : action === "resume" ? "resumed" : "stopped", reason, actor: "owner", eventKey: `${action}:${exp.id}:${now}` });
    console.log(`${exp.id}: ${exp.status} → ${to}`);
  }
  await experimentPool().end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
