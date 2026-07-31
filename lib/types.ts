export interface Bar {
  time: number; // unix seconds, bar open
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/* Aggregated frame bar (4H/1H/15M/Daily) — keeps the time of the last
   5-minute bar folded into it, and the NY date for daily frames. */
export interface FrameBar extends Bar {
  endTime?: number;
  date?: string;
}

export interface Trade {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  stop: number;
  target: number | null;
  exitReason: "stop" | "target" | "signal" | "session" | "windowEnd";
  points: number;
  pnl: number; // net dollars, costs included
  rMultiple: number;
  score?: number;
  tags?: Record<string, string>;
  /* Intra-trade excursion, in POINTS from the entry price and both
     non-negative: how far the trade went against you (MAE) and in your favour
     (MFE) before it closed. Measured from bar highs/lows while the position
     was open, so on 5-minute bars they are bar-resolution, not tick-exact.

     Additive bookkeeping — nothing in the engine or any strategy reads them,
     so they cannot change a decision. Optional because trades reconstructed
     from stored rows (which predate the fields) legitimately have none. */
  maePoints?: number;
  mfePoints?: number;
  /* Bar times at which the MAE and MFE extremes were set. Subtracting
     entryTime gives time-to-MAE / time-to-MFE, which separates "died
     immediately" from "worked, then gave it back" — two failures that look
     identical in P&L. Same additive category as the points above. */
  maeTime?: number;
  mfeTime?: number;
  /* The stop as it stood at ENTRY, before any breakeven or trailing move.
     `stop` above is the final stop, so it is the wrong denominator for
     excursion: a trade trailed to breakeven has |entry - stop| -> 0, which
     sends maeR/mfeR to infinity. Nothing in the engine reads this. */
  initialStop?: number;
  /* ATR at the entry bar, in points. Lets excursion be compared across
     symbols and across eight years of very different volatility, which R
     alone cannot do once stop distance is itself volatility-scaled. */
  atrAtEntry?: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  net: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number | null;
  avgR: number | null;
  expectancy: number | null;
  maxDrawdown: number;
  avgDurationSec: number | null;
}
