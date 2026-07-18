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
