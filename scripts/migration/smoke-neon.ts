/** Run with DATABASE_URL set. Checks the server query bridge without keeping data. */
import assert from "node:assert/strict";
import { createClient } from "@/lib/neon/server";

async function main() {
const db = createClient();
const signals = await db.from("signals").select("id, dedupe_key").order("id", { ascending: false }).limit(1);
assert.equal(signals.error, null);
assert.ok(signals.data?.length);

let id: number | undefined;
try {
  const inserted = await db.from("engine_runs")
    .insert({ status: "skipped", source: "neon-migration-smoke", message: "insert" })
    .select("id").single();
  assert.equal(inserted.error, null);
  id = Number(inserted.data?.id);
  assert.ok(Number.isSafeInteger(id));

  const upserted = await db.from("engine_runs")
    .upsert({ id, status: "skipped", source: "neon-migration-smoke", message: "upsert" }, { onConflict: "id" });
  assert.equal(upserted.error, null);
  const updated = await db.from("engine_runs").update({ message: "updated" }).eq("id", id);
  assert.equal(updated.error, null);
  const selected = await db.from("engine_runs").select("id, message").eq("id", id).single();
  assert.equal(selected.error, null);
  assert.equal(selected.data?.message, "updated");
  console.log("Neon server read, insert, upsert, update and single-row select passed.");
} finally {
  if (id !== undefined) {
    const removed = await db.from("engine_runs").delete().eq("id", id);
    assert.equal(removed.error, null);
  }
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
