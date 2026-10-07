/** Trial account writer. Delayed simulation only — there is no broker API and no real-money order path.
 *
 * Reads every idea of the last eight days exactly as the Ideas tab filters
 * them (visibleSignals), steps the trial account through lib/trial/engine.ts,
 * and writes the result in one transaction. The account row is locked FOR
 * UPDATE, so two overlapping engine passes serialize instead of double-entering. */
import { transaction } from "@/lib/neon/server";
import type { Bar } from "@/lib/types";
import type { SignalRow } from "@/lib/neon/client";
import { visibleSignals } from "@/lib/signals/snapshot";
import { stepTrial, type TrialAccount, type TrialIdea, type TrialPosition, type TrialSymbol } from "@/lib/trial/engine";
import { slippagePointsAt } from "@/lib/costs/slippage";
import { POINT_VALUES } from "@/lib/market/contracts";
import { EXECUTION } from "./tiers";

const toSec = (v: unknown) => (v == null ? null : Date.parse(String(v)) / 1000);
const toIso = (s: number | null) => (s == null ? null : new Date(s * 1000).toISOString());
const isTrialSymbol = (s: string): s is TrialSymbol => s === "MES" || s === "MNQ";

export interface TrialRunSummary {
  round: number;
  equity: number;
  opened: TrialPosition[];
  closed: TrialPosition[];
  locked: boolean;
}

function positionFromRow(r: Record<string, unknown>): TrialPosition {
  return {
    id: String(r.id), round: Number(r.round), signalKey: String(r.signal_key), signalId: r.signal_id == null ? null : Number(r.signal_id),
    symbol: r.symbol as TrialSymbol, side: r.side as TrialPosition["side"], qty: Number(r.qty), entry: Number(r.entry), stop: Number(r.stop),
    target: r.target == null ? null : Number(r.target), risk: Number(r.risk), mark: Number(r.mark),
    openedAt: toSec(r.opened_at)!, lastMarkTs: toSec(r.last_mark_ts), closedAt: toSec(r.closed_at),
    exitPrice: r.exit_price == null ? null : Number(r.exit_price), pnl: r.pnl == null ? null : Number(r.pnl),
    exitReason: (r.exit_reason as TrialPosition["exitReason"]) ?? null,
  };
}

export function ideaFromRow(row: SignalRow, visible: boolean): TrialIdea | null {
  if (!isTrialSymbol(row.symbol)) return null;
  return {
    key: row.dedupe_key, id: row.id ?? null, symbol: row.symbol, side: row.direction === "long" ? "LONG" : "SHORT",
    entry: Number(row.entry_price), stop: Number(row.stop_price), target: row.target_price == null ? null : Number(row.target_price),
    qty: row.qty == null ? null : Number(row.qty), signalTs: Date.parse(row.signal_ts) / 1000,
    exitTs: row.exit_ts ? Date.parse(row.exit_ts) / 1000 : null, exitPrice: row.exit_price == null ? null : Number(row.exit_price),
    status: row.status, visible,
  };
}

export async function runTrialBroker(bySymbol: Record<string, Bar[]>, nowSec: number): Promise<TrialRunSummary> {
  return transaction(async (c) => {
    const a = (await c.query("SELECT * FROM trial_account WHERE id=1 FOR UPDATE")).rows[0];
    if (!a) throw new Error("Trial account missing");
    const account: TrialAccount = {
      round: Number(a.round), startedAt: toSec(a.started_at)!, equity: Number(a.equity), peak: Number(a.peak), dayKey: String(a.day_key),
      dayStartEquity: Number(a.day_start_equity), dailyPnl: Number(a.daily_pnl), openRisk: Number(a.open_risk), locked: !!a.locked,
      lockedAt: toSec(a.locked_at), lastEventTs: toSec(a.last_event_ts),
    };
    const open = (await c.query("SELECT * FROM trial_positions WHERE round=$1 AND closed_at IS NULL", [account.round])).rows.map(positionFromRow);
    const realized = Number((await c.query("SELECT coalesce(sum(pnl),0) total FROM trial_positions WHERE round=$1 AND closed_at IS NOT NULL", [account.round])).rows[0].total);
    const since = new Date(Math.max(account.startedAt, nowSec - 8 * 86400) * 1000).toISOString();
    const rows = (await c.query("SELECT * FROM signals WHERE signal_ts >= $1 ORDER BY signal_ts, id", [since])).rows as SignalRow[];
    // An open position's idea is read even if it is older than the window.
    const missing = open.map((p) => p.signalKey).filter((k) => !rows.some((r) => r.dedupe_key === k));
    if (missing.length) rows.push(...((await c.query("SELECT * FROM signals WHERE dedupe_key = ANY($1)", [missing])).rows as SignalRow[]));
    const visible = new Set(visibleSignals(rows).map((r) => r.dedupe_key));
    const ideas = rows.map((r) => ideaFromRow(r, visible.has(r.dedupe_key))).filter((i): i is TrialIdea => i !== null);
    const decided = new Set<string>(
      (await c.query("SELECT signal_key FROM trial_decisions WHERE round=$1 AND signal_key = ANY($2)", [account.round, ideas.map((i) => i.key)])).rows.map((r) => String(r.signal_key)),
    );

    const step = stepTrial({
      account, open, realized, decided, ideas, nowSec,
      bars: { MES: bySymbol.MES ?? [], MNQ: bySymbol.MNQ ?? [] },
      costs: { pointValue: { MES: POINT_VALUES.MES, MNQ: POINT_VALUES.MNQ }, costPerContract: EXECUTION.cost, slip: (s, t) => slippagePointsAt(EXECUTION.friction!, s, t) },
    });

    for (const d of step.decisions)
      await c.query("INSERT INTO trial_decisions(round,signal_key,taken,qty,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [d.round, d.signalKey, d.taken, d.qty, d.reason]);
    const fresh = new Set(step.opened.map((p) => p.id));
    for (const p of step.changed) {
      if (fresh.has(p.id))
        await c.query(
          `INSERT INTO trial_positions(id,round,signal_key,signal_id,symbol,side,qty,entry,stop,target,risk,mark,opened_at,last_mark_ts,closed_at,exit_price,pnl,exit_reason)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING`,
          [p.id, p.round, p.signalKey, p.signalId, p.symbol, p.side, p.qty, p.entry, p.stop, p.target, p.risk, p.mark, toIso(p.openedAt), toIso(p.lastMarkTs), toIso(p.closedAt), p.exitPrice, p.pnl, p.exitReason],
        );
      else
        await c.query("UPDATE trial_positions SET mark=$2,last_mark_ts=$3,closed_at=$4,exit_price=$5,pnl=$6,exit_reason=$7 WHERE id=$1 AND closed_at IS NULL",
          [p.id, p.mark, toIso(p.lastMarkTs), toIso(p.closedAt), p.exitPrice, p.pnl, p.exitReason]);
    }
    const s = step.account;
    await c.query(
      `UPDATE trial_account SET equity=$1,peak=$2,day_key=$3,day_start_equity=$4,daily_pnl=$5,open_risk=$6,locked=$7,locked_at=$8,
        last_event_ts=$9,updated_at=now() WHERE id=1`,
      [s.equity, s.peak, s.dayKey, s.dayStartEquity, s.dailyPnl, s.openRisk, s.locked, toIso(s.lockedAt), toIso(s.lastEventTs)],
    );
    return { round: s.round, equity: s.equity, opened: step.opened, closed: step.changed.filter((p) => p.closedAt !== null), locked: s.locked && !account.locked };
  });
}
