/* Item 2.8 — the four things a trader wants from a signal card without
   clicking: what the setup is, what would invalidate it, how this KIND of setup
   has done historically, and the model's win probability.

   The hard rule, from the brief: a historical cell is NEVER rendered as
   guidance without its sample count beside it, and it is explicitly marked
   insufficient below MIN_CELL_N. A win rate on n=3 that looks like a win rate
   on n=300 is worse than no number at all — that is the mistake the condition
   ledger exists to prevent, so the presentation layer must not undo it. */

/** Matches learn.ts's `cell()` output. */
export interface LedgerCell {
  n: number;
  net: number;
  pf: number | null;
  winRate: number | null;
  insufficient: boolean;
}

export interface ConditionLedger {
  tierRegime?: Record<string, LedgerCell>;
  tierVix?: Record<string, LedgerCell>;
  dayOfWeek?: Record<string, LedgerCell>;
  entryHour?: Record<string, LedgerCell>;
  minCell?: number;
}

/** The sample size below which a cell is "still collecting", not evidence. */
export const MIN_CELL_N = 10;

export interface SignalLike {
  tier: string;
  symbol: string;
  direction: string;
  timeframe: string | null;
  reason: string | null;
  stop_price: number;
  target_price: number | null;
  entry_price: number;
  regime: string | null;
  vix_bucket: string | null;
  /* Optional: rows written before Ring 1b have no win_prob at all, which is a
     different thing from a null score and must read as "not scored yet". */
  win_prob?: number | null;
  score: number | null;
}

/* Plain-English regime names — the stored keys are engineering labels. */
const REGIME_TEXT: Record<string, string> = {
  "trend-high-vol": "a trending, volatile market",
  "trend-low-vol": "a trending, quiet market",
  "range-high-vol": "a choppy, volatile market",
  "range-low-vol": "a choppy, quiet market",
};

/* What the setup IS, in the trader's language. `reason` is written by the
   engine as "<label>: <pattern or trigger>", so the useful half is after the
   colon. */
export function describeSetup(s: SignalLike): string {
  const raw = (s.reason ?? "").split(":").slice(1).join(":").trim();
  const tf = s.timeframe && s.timeframe !== "5m" ? `${s.timeframe} ` : "";
  const side = s.direction === "long" ? "buy" : "sell";
  if (!raw) return `${tf}${side} setup on ${s.symbol}`;
  return `${tf}${side} — ${raw}`;
}

/* What would prove the idea wrong. Deliberately the stop, stated as a price
   level and a direction, because that is the only unambiguous answer. */
export function describeInvalidation(s: SignalLike): string {
  const dir = s.direction === "long" ? "below" : "above";
  const dist = Math.abs(s.entry_price - s.stop_price);
  return `wrong ${dir} ${s.stop_price.toFixed(2)} (${dist.toFixed(2)} pts away)`;
}

export interface HistoricalCell {
  /** Which slice this is, e.g. "Tier B in a choppy, quiet market". */
  label: string;
  cell: LedgerCell;
  /** True when n is too small to mean anything — must be shown, never hidden. */
  insufficient: boolean;
  /** "n=6 of 10 needed" — the progress every gate must print. */
  progress: string;
}

/* The matching tier × regime and tier × VIX cells for a signal. Returns only
   cells that exist; an absent cell means "no data for this combination", which
   is different from "n=0" and is reported as such by the caller. */
export function historicalCells(
  ledger: ConditionLedger | null,
  s: SignalLike,
  minCell = ledger?.minCell ?? MIN_CELL_N
): HistoricalCell[] {
  if (!ledger) return [];
  const out: HistoricalCell[] = [];
  const push = (label: string, cell: LedgerCell | undefined) => {
    if (!cell) return;
    out.push({
      label,
      cell,
      insufficient: cell.insufficient || cell.n < minCell,
      progress: `n=${cell.n} of ${minCell} needed`,
    });
  };
  if (s.regime)
    push(
      `Tier ${s.tier} in ${REGIME_TEXT[s.regime] ?? s.regime}`,
      ledger.tierRegime?.[`${s.tier}·${s.regime}`]
    );
  if (s.vix_bucket)
    push(
      `Tier ${s.tier} when fear is ${s.vix_bucket}`,
      ledger.tierVix?.[`${s.tier}·${s.vix_bucket}`]
    );
  return out;
}

/* One line summarising a cell, WITH its sample count, or the collecting note.
   There is deliberately no code path that returns a bare percentage. */
export function describeCell(h: HistoricalCell): string {
  if (h.insufficient)
    return `${h.label}: still collecting — ${h.progress}, too few to judge`;
  const wr = h.cell.winRate === null ? "—" : `${h.cell.winRate}%`;
  const pf = h.cell.pf === null ? "—" : h.cell.pf.toFixed(2);
  return `${h.label}: ${wr} win rate, profit factor ${pf} (n=${h.cell.n})`;
}

/* The model's read, or why there isn't one. Never invents a number. */
export function describeWinProb(s: SignalLike): string {
  if (s.win_prob === null || s.win_prob === undefined)
    return "the model has not scored this one yet";
  return `the model puts this at about ${Math.round(s.win_prob * 100)}% to win`;
}
