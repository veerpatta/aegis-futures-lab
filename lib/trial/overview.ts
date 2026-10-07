/* What the screens read about the trial account: the `trial_overview` view
   (db/migrations/20261005_trial_account.sql), plus small pure helpers. */

import { TRIAL_RISK, type TrialSkipReason } from "./policy";
import type { TrialExitReason } from "./engine";
import { POINT_VALUES } from "@/lib/market/contracts";
import { EXECUTION } from "@/scripts/engine/tiers";

export interface TrialAccountRow {
  round: number;
  started_at: string;
  equity: number;
  peak: number;
  day_key: string;
  day_start_equity: number;
  daily_pnl: number;
  open_risk: number;
  locked: boolean;
  locked_at: string | null;
  updated_at: string;
}

export interface TrialRoundRow {
  round: number;
  started_at: string;
  start_equity: number;
  ended_at: string | null;
  end_equity: number | null;
  end_reason: string | null;
}

export interface TrialPositionRow {
  id: string;
  round: number;
  signal_key: string;
  signal_id: number | null;
  symbol: "MES" | "MNQ";
  side: "LONG" | "SHORT";
  qty: number;
  entry: number;
  stop: number;
  target: number | null;
  risk: number;
  mark: number;
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
  pnl: number | null;
  exit_reason: TrialExitReason | null;
}

export interface TrialDecisionRow {
  round: number;
  signal_key: string;
  taken: boolean;
  qty: number;
  reason: "taken" | TrialSkipReason;
  decided_at: string;
  pnl: number | null;
  closed_at: string | null;
}

export interface TrialOverview {
  account: TrialAccountRow | null;
  rounds: TrialRoundRow[];
  positions: TrialPositionRow[];
  decisions: TrialDecisionRow[];
  /** Closed results per New York day: net, count and winners. */
  daily: { round: number; day: string; pnl: number; n: number; wins: number }[];
}

/** jsonb numbers can arrive as strings through some paths — normalise once. */
export function normaliseOverview(raw: Record<string, unknown> | null | undefined): TrialOverview | null {
  if (!raw) return null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const account = raw.account as Record<string, unknown> | null;
  return {
    account: account
      ? ({ ...account, round: Number(account.round), equity: Number(account.equity), peak: Number(account.peak), day_start_equity: Number(account.day_start_equity),
          daily_pnl: Number(account.daily_pnl), open_risk: Number(account.open_risk), locked: !!account.locked } as TrialAccountRow)
      : null,
    rounds: ((raw.rounds as TrialRoundRow[]) ?? []).map((r) => ({ ...r, round: Number(r.round), start_equity: Number(r.start_equity), end_equity: num(r.end_equity) })),
    positions: ((raw.positions as TrialPositionRow[]) ?? []).map((p) => ({
      ...p, round: Number(p.round), qty: Number(p.qty), entry: Number(p.entry), stop: Number(p.stop), target: num(p.target), risk: Number(p.risk),
      mark: Number(p.mark), exit_price: num(p.exit_price), pnl: num(p.pnl),
    })),
    decisions: ((raw.decisions as TrialDecisionRow[]) ?? []).map((d) => ({ ...d, round: Number(d.round), qty: Number(d.qty), pnl: num(d.pnl) })),
    daily: ((raw.daily as TrialOverview["daily"]) ?? []).map((d) => ({ round: Number(d.round), day: String(d.day), pnl: Number(d.pnl), n: Number(d.n), wins: Number(d.wins ?? 0) })),
  };
}

/** Running result of an open position at a price, commission included — the
    same arithmetic as lib/trial/engine.ts positionValue. */
export function openResult(p: Pick<TrialPositionRow, "side" | "entry" | "qty" | "symbol">, price: number): number {
  return (price - p.entry) * (p.side === "LONG" ? 1 : -1) * POINT_VALUES[p.symbol] * p.qty - EXECUTION.cost * p.qty;
}

/** Balance after each day of the current round, starting at the round's start. */
export function balanceSeries(o: TrialOverview): { day: string; balance: number; n: number }[] {
  const round = o.account?.round;
  const start = o.rounds.find((r) => r.round === round)?.start_equity ?? TRIAL_RISK.capital;
  let balance = start;
  const out = [{ day: o.rounds.find((r) => r.round === round)?.started_at.slice(0, 10) ?? "", balance: start, n: 0 }];
  for (const d of o.daily.filter((x) => x.round === round).sort((a, b) => a.day.localeCompare(b.day))) {
    balance += d.pnl;
    out.push({ day: d.day, balance: Math.round(balance * 100) / 100, n: d.n });
  }
  return out;
}

/** Closed-trade record of the current round, with its n. */
export function roundRecord(o: TrialOverview): { n: number; wins: number; losses: number; net: number } {
  const days = o.daily.filter((d) => d.round === o.account?.round);
  const n = days.reduce((a, d) => a + d.n, 0);
  const wins = days.reduce((a, d) => a + d.wins, 0);
  return { n, wins, losses: n - wins, net: Math.round(days.reduce((a, d) => a + d.pnl, 0) * 100) / 100 };
}
