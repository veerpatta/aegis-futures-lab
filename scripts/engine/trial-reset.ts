/** Start a new trial round at $10,000. Run only by the owner, through
 * .github/workflows/trial-reset.yml — never automatically, and never locally
 * (.env.local points at production).
 *
 * Nothing is erased. Open positions close at their last price with the reason
 * "round-end", the ended round keeps its dates, final balance and reason, and
 * every screen keeps showing earlier rounds. A drawdown stop that could be
 * undone quietly would make the stop meaningless. */
import { transaction } from "@/lib/neon/server";
import { TRIAL_RISK } from "@/lib/trial/policy";
import { POINT_VALUES } from "@/lib/market/contracts";
import { EXECUTION } from "./tiers";

async function main() {
  const reason = (process.env.TRIAL_RESET_REASON ?? "").trim();
  if (process.env.TRIAL_RESET_CONFIRM !== "RESET") throw new Error("Type RESET to confirm a new trial round.");
  if (reason.length < 4) throw new Error("Give a short reason for starting a new round.");
  const result = await transaction(async (c) => {
    const a = (await c.query("SELECT * FROM trial_account WHERE id=1 FOR UPDATE")).rows[0];
    if (!a) throw new Error("Trial account missing");
    const round = Number(a.round);
    const open = (await c.query("SELECT * FROM trial_positions WHERE round=$1 AND closed_at IS NULL", [round])).rows;
    for (const p of open) {
      const d = p.side === "LONG" ? 1 : -1;
      const pnl = (Number(p.mark) - Number(p.entry)) * d * POINT_VALUES[p.symbol as "MES" | "MNQ"] * Number(p.qty) - EXECUTION.cost * Number(p.qty);
      await c.query("UPDATE trial_positions SET closed_at=now(),exit_price=mark,pnl=$2,exit_reason='round-end' WHERE id=$1", [p.id, Math.round(pnl * 100) / 100]);
    }
    const realized = Number((await c.query("SELECT coalesce(sum(pnl),0) total FROM trial_positions WHERE round=$1", [round])).rows[0].total);
    const endEquity = Math.round((TRIAL_RISK.capital + realized) * 100) / 100;
    await c.query("UPDATE trial_rounds SET ended_at=now(),end_equity=$2,end_reason=$3 WHERE round=$1", [round, endEquity, reason.slice(0, 200)]);
    await c.query("INSERT INTO trial_rounds(round,started_at,start_equity) VALUES($1,now(),$2)", [round + 1, TRIAL_RISK.capital]);
    await c.query(
      `UPDATE trial_account SET round=$1,started_at=now(),risk_version=$2,equity=$3,peak=$3,day_key='',day_start_equity=$3,daily_pnl=0,
        open_risk=0,locked=false,locked_at=NULL,last_event_ts=NULL,updated_at=now() WHERE id=1`,
      [round + 1, TRIAL_RISK.version, TRIAL_RISK.capital],
    );
    return { ended: round, endEquity, closed: open.length };
  });
  console.log(`Trial round ${result.ended} ended at $${result.endEquity.toFixed(2)} (${result.closed} open position(s) closed). Round ${result.ended + 1} starts at $${TRIAL_RISK.capital}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
