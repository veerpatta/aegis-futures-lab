/* The facts a coach note may use, built from the bot's own records.

   The note is only as honest as its facts: every number in an accepted note
   must appear here (lib/ai-coach/validate.ts), so these objects carry exactly
   what a beginner needs and nothing the record does not say. */

import { skipWords } from "@/lib/plain/experiment";
import { nyClock, nyMeta } from "@/lib/time/ny";

const MARKETS = { MES: "S&P 500 micro", MNQ: "Nasdaq-100 micro" } as const;
const METHODS: Record<string, string> = { "rsi-reversion": "RSI reversion", "zone-v5": "Zone setups" };
const EXIT_WORDS: Record<string, string> = {
  stop: "hit its safety exit (the stop)",
  target: "reached its profit target",
  session: "was closed at the end of the trading session",
  "session-late": "was closed at the end of the trading session",
  "daily-loss": "was closed because the day's loss limit was reached",
  drawdown: "was closed because the account's loss limit was reached",
  "campaign-end": "was closed when the campaign ended",
};

const money = (v: number) => Math.round(v * 100) / 100;
const price = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const when = (sec: number) => `${nyMeta(sec).weekday} ${nyClock(sec)} New York time`;

export interface TradeRecord {
  decisionKey: string;
  symbol: string;
  side: string;
  action: "take" | "skip";
  reason: string;
  decidedAt: number;
  idea: Record<string, unknown> | null;
  estRisk: unknown;
  position: { status: string | null; qty: unknown; fill: unknown; fillTs: unknown; exit: unknown; exitTs: unknown; exitReason: unknown; net: unknown; cancelReason: unknown };
  outcome: { status: string | null; simStatus: string | null; net: unknown; exitReason: unknown; exit: unknown; exitTs: unknown; fill: unknown; fillTs: unknown };
}

export type Facts = Record<string, string | number | boolean | null | Record<string, string | number | boolean | null>>;

/** Facts for a finished decision, or null when it is not finished or unusable. */
export function tradeFacts(r: TradeRecord): Facts | null {
  const market = MARKETS[r.symbol as keyof typeof MARKETS];
  if (!market || (r.side !== "LONG" && r.side !== "SHORT")) return null;
  const idea = r.idea ?? {};
  const strategy = typeof idea.strategy === "string" ? idea.strategy : "";
  const base: Facts = {
    market,
    method: METHODS[strategy] ?? (strategy || "unknown"),
    direction: r.side === "LONG" ? "buy (a bet that the price rises)" : "sell (a bet that the price falls)",
    decided: when(r.decidedAt),
    planned_entry_price: num(idea.entry) === null ? null : price(num(idea.entry)!),
    stop_price: num(idea.stop) === null ? null : price(num(idea.stop)!),
    target_price: num(idea.target) === null ? null : price(num(idea.target)!),
    money: "virtual (practice) money, not real",
  };
  if (r.action === "take") {
    const p = r.position;
    if (p.status === "cancelled") return { ...base, bot_action: "took the trade, but the order was never filled", result_usd: 0 };
    if (p.status !== "closed") return null;
    const fill = num(p.fill), exit = num(p.exit), net = num(p.net), fillTs = num(p.fillTs), exitTs = num(p.exitTs), qty = num(p.qty);
    if (fill === null || exit === null || net === null || qty === null) return null;
    return {
      ...base,
      bot_action: "took the trade",
      contracts: qty,
      risk_usd: num(r.estRisk) === null ? null : money(num(r.estRisk)!),
      entry_price: price(fill),
      exit_price: price(exit),
      what_happened: EXIT_WORDS[String(p.exitReason)] ?? "was closed",
      minutes_held: fillTs !== null && exitTs !== null ? Math.max(0, Math.round((exitTs - fillTs) / 60)) : null,
      result_usd: money(net),
      result: net > 0 ? "a gain" : net < 0 ? "a loss" : "break-even",
    };
  }
  const o = r.outcome;
  const why = skipWords(r.reason).replace(/^Skipped: /, "");
  if (o.status === "void") return { ...base, bot_action: "skipped the idea", skip_reason: why, what_would_have_happened: "it would not have been filled" };
  if (o.status !== "closed") return null;
  const net = num(o.net);
  if (net === null) return null;
  return {
    ...base,
    bot_action: "skipped the idea",
    skip_reason: why,
    what_would_have_happened: EXIT_WORDS[String(o.exitReason)] ?? "would have been closed",
    one_contract_result_had_it_been_taken_usd: money(net),
  };
}

export interface DayRecord {
  dayKey: string;
  decided: number;
  taken: number;
  skipped: number;
  closed: number;
  wins: number;
  losses: number;
  resultUsd: number;
  open: number;
  balanceUsd: number | null;
  sp500ChangePct: number | null;
  nasdaqChangePct: number | null;
}

export function dayFacts(d: DayRecord): Facts {
  const [y, m, day] = d.dayKey.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return {
    trading_day: label,
    money: "virtual (practice) money, not real",
    ideas_the_bot_decided: d.decided,
    trades_taken: d.taken,
    ideas_skipped: d.skipped,
    trades_finished: d.closed,
    winning_trades: d.wins,
    losing_trades: d.losses,
    result_of_finished_trades_usd: money(d.resultUsd),
    trades_still_open: d.open,
    virtual_balance_usd: d.balanceUsd === null ? null : money(d.balanceUsd),
    // The names are facts too: a recap that mentions "S&P 500" must find 500 here.
    markets_watched: "S&P 500 micro (MES) and Nasdaq-100 micro (MNQ)",
    market_moves_today: { sp500_micro_pct: d.sp500ChangePct, nasdaq_micro_pct: d.nasdaqChangePct },
  };
}
