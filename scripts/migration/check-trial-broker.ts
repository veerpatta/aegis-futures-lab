/** Integration check for the trial account on an ISOLATED Neon branch.
 *
 * Applies nothing itself: run it after db/migrations/20261005_trial_account.sql
 * has been applied to a throwaway branch. It writes test signals, so it refuses
 * the production endpoint outright and needs TRIAL_CHECK_BRANCH=1 as a second
 * key. Proves: concurrent passes serialize to one entry, the exit mirrors the
 * idea to the cent, a replay changes nothing, and closed history is write-once. */
import { transaction } from "../../lib/neon/server";
import { runTrialBroker } from "../engine/trial-broker";

const PRODUCTION_ENDPOINT = "ep-twilight-recipe-b3apaham";
if (process.env.TRIAL_CHECK_BRANCH !== "1" || !process.env.DATABASE_URL || process.env.DATABASE_URL.includes(PRODUCTION_ENDPOINT))
  throw new Error("Integration requires an isolated test branch (TRIAL_CHECK_BRANCH=1, non-production DATABASE_URL)");

async function main() {
  // Monday 2026-10-05 10:00 ET.
  const t = Date.parse("2026-10-05T14:00:00Z") / 1000;
  const key = `B:trial-check:MES:${t}`;
  await transaction(async (c) => {
    await c.query("UPDATE trial_account SET started_at=to_timestamp($1),last_event_ts=NULL,day_key='',equity=10000,peak=10000,day_start_equity=10000 WHERE id=1", [t - 3600]);
    await c.query(
      `INSERT INTO signals(symbol,timeframe,direction,entry_price,stop_price,target_price,status,reason,signal_ts,tier,qty,dedupe_key)
       VALUES('MES','5m','long',6000,5990,6020,'triggered','trial integration check',to_timestamp($1),'B',2,$2)`,
      [t, key],
    );
  });
  const bar = (time: number, price: number) => ({ time, open: price, high: price + 1, low: price - 1, close: price, volume: 100 });
  const b1 = [bar(t, 6000), bar(t + 300, 6002)];
  await Promise.all([runTrialBroker({ MES: b1, MNQ: b1 }, t + 600), runTrialBroker({ MES: b1, MNQ: b1 }, t + 600)]);
  let rows = (await transaction((c) => c.query("SELECT qty,closed_at FROM trial_positions WHERE signal_key=$1", [key]))).rows;
  if (rows.length !== 1 || Number(rows[0].qty) !== 2 || rows[0].closed_at) throw new Error("Concurrent passes did not serialize to one 2-contract entry");

  await transaction((c) => c.query("UPDATE signals SET status='hit_stop',exit_ts=to_timestamp($1),exit_price=5989.75,pnl_usd=-107.3 WHERE dedupe_key=$2", [t + 900, key]));
  const b2 = [...b1, bar(t + 600, 5995), bar(t + 900, 5989)];
  await runTrialBroker({ MES: b2, MNQ: b2 }, t + 1500);
  rows = (await transaction((c) => c.query("SELECT pnl,exit_reason FROM trial_positions WHERE signal_key=$1", [key]))).rows;
  // (5989.75 − 6000) × $5 × 2 − $2.40 × 2 = −107.30, the idea's own result.
  if (Math.abs(Number(rows[0].pnl) + 107.3) > 0.001 || rows[0].exit_reason !== "idea") throw new Error("Exit did not mirror the idea");

  const before = (await transaction((c) => c.query("SELECT equity FROM trial_account WHERE id=1"))).rows[0].equity;
  await runTrialBroker({ MES: b2, MNQ: b2 }, t + 1500);
  const after = (await transaction((c) => c.query("SELECT equity FROM trial_account WHERE id=1"))).rows[0].equity;
  if (Number(before) !== Number(after)) throw new Error("Replay changed the balance");

  let guarded = false;
  try {
    await transaction((c) => c.query("UPDATE trial_positions SET pnl=0 WHERE signal_key=$1", [key]));
  } catch {
    guarded = true;
  }
  if (!guarded) throw new Error("A closed trial position could be edited");
  console.log("PASS: concurrent passes serialized, size followed the idea, exit mirrored to the cent, replay idempotent, history write-once");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
