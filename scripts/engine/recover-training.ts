/** Resumable explicit-window recovery. Never fabricates past successful training runs. */
import { createClient, transaction } from "@/lib/neon/server";
import { fetchArchiveBars } from "@/lib/data/archive";
import { alignArchiveSlice } from "@/lib/data/window";
import { observeResearch, researchConfigHash } from "./research-observer";
import { stableHash } from "./learning-audit";
import { nyMeta } from "@/lib/time/ny";
import { holidayFor, flattenMinuteNy } from "@/lib/market/holidays";
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
async function main() {
  if (!process.argv.includes("--from") || !process.argv.includes("--as-of")) throw new Error("Required: --from ISO --as-of ISO [--source yahoo|databento]");
  const from = Date.parse(arg("--from")), cutoff = Date.parse(arg("--as-of"));
  const source = process.argv.includes("--source") ? arg("--source") : "yahoo";
  if (![from, cutoff].every(Number.isFinite) || from >= cutoff || cutoff > Date.now() || !["yahoo", "databento"].includes(source)) throw new Error("Invalid recovery window or source");
  const id = stableHash({ from, cutoff, source, version: researchConfigHash });
  const done = await transaction(async c => {
    const existing = await c.query("SELECT status FROM recovery_runs WHERE id=$1", [id]);
    if (existing.rows[0]?.status === "ok") return true;
    await c.query(`INSERT INTO recovery_runs(id,from_ts,as_of,source,status) VALUES($1,$2,$3,$4,'running')
      ON CONFLICT(id) DO UPDATE SET status='running',finished_at=NULL`, [id, new Date(from), new Date(cutoff), source]);
    return false;
  });
  if (done) { console.log("Recovery already complete; no new evidence created."); return; }
  try {
    const db = createClient(), bySymbol: Record<string, import("@/lib/types").Bar[]> = {}, coverage: Record<string, unknown> = {};
    for (const symbol of ["MES", "MNQ"]) {
      const bars = await fetchArchiveBars(db, { symbol, source: source as "yahoo" | "databento", fromSec: from / 1000 - 35 * 86400, toSec: cutoff / 1000 - 300 });
      bySymbol[symbol] = alignArchiveSlice(bars);
      const observed = new Set(bars.map(b => b.time)); let missing = 0, expected = 0;
      for (let t = Math.ceil(from / 300000) * 300; t + 300 <= cutoff / 1000; t += 300) {
        const m = nyMeta(t);
        if (["Sat", "Sun"].includes(m.weekday) || holidayFor(m.dateKey)?.kind === "closed" || m.minutes < 120 || m.minutes >= flattenMinuteNy(m.dateKey, 925)) continue;
        expected++; if (!observed.has(t)) missing++;
      }
      coverage[symbol] = { expected, missing, stored: bars.length, lastBar: bars.at(-1)?.time ?? null };
    }
    const recorded = await observeResearch(bySymbol, from / 1000, cutoff / 1000, source as "yahoo" | "databento", id);
    const report = { coverage, recorded, provenance: "historical-replay", note: "Outage replay is not forward evidence. Learning is run once against the repaired cutoff." };
    await transaction(c => c.query("UPDATE recovery_runs SET status='ok',finished_at=now(),report=$2 WHERE id=$1", [id, JSON.stringify(report)]));
    console.log(JSON.stringify(report));
  } catch (e) {
    await transaction(c => c.query("UPDATE recovery_runs SET status='error',finished_at=now(),report=$2 WHERE id=$1", [id, JSON.stringify({ error: String(e) })]));
    throw e;
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
