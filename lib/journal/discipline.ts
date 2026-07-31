/* Rule adherence, not luck.
   ─────────────────────────────────────────────────────────────────────────
   Home's "green streak" counted consecutive trading days that finished in
   profit. In an app whose entire thesis is that process beats outcome, that
   rewards exactly the wrong thing: a day where you broke every rule and got
   away with it extended the streak, and a day where you followed the plan
   perfectly and lost broke it.

   So the streak counts DAYS WITHOUT A RULE BREAK. A losing day where you did
   everything right keeps the chain alive — that is the whole point. The
   psychology only works if the chain measures something you control.

   Every rule here is checked against the journal (what you actually did), and
   every threshold comes from the engine's own live configuration rather than
   a number typed in twice. */

import { nyMeta } from "@/lib/time/ny";
import { POINT_VALUES } from "@/lib/market/contracts";
import { DEFAULT_COMMISSION_PER_CONTRACT, journalPnl, type JournalTrade } from "./index";

/** A rule the journal can actually check, and what breaking it looked like. */
export interface RuleBreak {
  rule: "entryWindow" | "riskCap" | "tradeCount" | "afterLossLimit";
  /** Plain trading language — this goes straight on screen. */
  detail: string;
  tradeId: string;
}

export interface DisciplineDay {
  dateKey: string; // NY trading date
  trades: number;
  netPnl: number;
  breaks: RuleBreak[];
  /** True when the day had trades and none of them broke a rule. */
  clean: boolean;
}

export interface DisciplineConfig {
  /** NY minutes: entries allowed from this minute (02:00 ET = 120). */
  entryFromMinute: number;
  /** NY minutes: entries must stop by this (15:25 ET = 925). */
  entryToMinute: number;
  /** Max $ risk per trade before it counts as oversized. */
  maxRiskUsd: number;
  /** Max trades per symbol per day. */
  maxTradesPerSymbol: number;
  /** Stop trading for the day after this many losses on a symbol. */
  maxLossesPerSymbol: number;
  commissionPerContract: number;
}

/* Mirrors the live tier-B discipline locks and the London+NY entry window the
   strategies enforce (lib/strategies/zone-v5/index.ts entryHours = "day",
   B_LOCKS in scripts/engine/tiers.ts). Held here as an explicit config so a
   caller can pass the real values rather than this module guessing. */
export const DEFAULT_DISCIPLINE: DisciplineConfig = {
  entryFromMinute: 120, // 02:00 ET
  entryToMinute: 925, // 15:25 ET flat
  maxRiskUsd: 160,
  maxTradesPerSymbol: 2,
  maxLossesPerSymbol: 2,
  commissionPerContract: DEFAULT_COMMISSION_PER_CONTRACT,
};

/* The journal records no stop, so per-trade RISK cannot be known. What CAN be
   known is the position's notional exposure per point, which is what actually
   scales a mistake. A trade is flagged oversized when one point of adverse
   move costs more than the risk cap allows across a plausible stop — using
   the cap directly would need a stop we do not have.

   Concretely: qty × pointValue is the dollars lost per point. At the live
   $160 cap and MES's measured ~9.6-point stops, anything above ~3 contracts
   is outside what the engine would ever have sized. The check is deliberately
   generous — it catches "I traded 10 lots", not "I traded one extra". */
export function oversized(t: JournalTrade, cfg: DisciplineConfig): boolean {
  const perPoint = (POINT_VALUES[t.symbol] ?? 1) * t.qty;
  // A stop of one point is the most generous reading possible; if even that
  // exceeds the cap the size was indefensible.
  return perPoint > cfg.maxRiskUsd;
}

/** Group journal trades into NY trading days and judge each one. */
export function disciplineDays(
  trades: JournalTrade[],
  cfg: DisciplineConfig = DEFAULT_DISCIPLINE
): DisciplineDay[] {
  const byDay = new Map<string, JournalTrade[]>();
  for (const t of trades) {
    const key = nyMeta(t.entryTime).dateKey;
    const g = byDay.get(key);
    if (g) g.push(t);
    else byDay.set(key, [t]);
  }

  const days: DisciplineDay[] = [];
  for (const [dateKey, dayTrades] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...dayTrades].sort((a, b) => a.entryTime - b.entryTime);
    const breaks: RuleBreak[] = [];
    const countBySymbol = new Map<string, number>();
    const lossesBySymbol = new Map<string, number>();

    for (const t of ordered) {
      const mins = nyMeta(t.entryTime).minutes;
      if (mins < cfg.entryFromMinute || mins >= cfg.entryToMinute)
        breaks.push({
          rule: "entryWindow",
          detail: `${t.symbol} entered outside the trading window`,
          tradeId: t.id,
        });

      if (oversized(t, cfg))
        breaks.push({
          rule: "riskCap",
          detail: `${t.symbol} sized at ${t.qty} contracts — beyond the risk cap`,
          tradeId: t.id,
        });

      // Count and loss limits are judged on what came BEFORE this trade, so
      // the trade that crosses the line is the one flagged, not its successors.
      const already = countBySymbol.get(t.symbol) ?? 0;
      if (already >= cfg.maxTradesPerSymbol)
        breaks.push({
          rule: "tradeCount",
          detail: `${t.symbol} trade ${already + 1} — past the ${cfg.maxTradesPerSymbol}-a-day limit`,
          tradeId: t.id,
        });

      const lossesBefore = lossesBySymbol.get(t.symbol) ?? 0;
      if (lossesBefore >= cfg.maxLossesPerSymbol)
        breaks.push({
          rule: "afterLossLimit",
          detail: `${t.symbol} traded again after ${lossesBefore} losses — the day was done`,
          tradeId: t.id,
        });

      countBySymbol.set(t.symbol, already + 1);
      const { netPnl } = journalPnl(t, cfg.commissionPerContract);
      if (netPnl < 0) lossesBySymbol.set(t.symbol, lossesBefore + 1);
    }

    days.push({
      dateKey,
      trades: ordered.length,
      netPnl: ordered.reduce((s, t) => s + journalPnl(t, cfg.commissionPerContract).netPnl, 0),
      breaks,
      clean: breaks.length === 0,
    });
  }
  return days;
}

export interface DisciplineStreak {
  /** Consecutive most-recent traded days with no rule break. */
  current: number;
  /** Longest such run in the supplied history. */
  best: number;
  /** Days judged. Zero means "nothing logged yet", never "a zero streak". */
  daysJudged: number;
  /** Clean days over judged days, as a percentage. Null when nothing logged. */
  adherencePct: number | null;
}

/* The streak counts back from the most recent traded day. A losing but clean
   day EXTENDS it — if it did not, this would be the P&L streak again wearing
   a different label. */
export function disciplineStreak(days: DisciplineDay[]): DisciplineStreak {
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (!days[i].clean) break;
    current++;
  }
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.clean ? run + 1 : 0;
    if (run > best) best = run;
  }
  const clean = days.filter((d) => d.clean).length;
  return {
    current,
    best,
    daysJudged: days.length,
    adherencePct: days.length ? (clean / days.length) * 100 : null,
  };
}

/** Every break in the history, newest first — the "what actually goes wrong"
    list, which is more useful than the score. */
export function recentBreaks(days: DisciplineDay[], limit = 10): (RuleBreak & { dateKey: string })[] {
  const out: (RuleBreak & { dateKey: string })[] = [];
  for (let i = days.length - 1; i >= 0 && out.length < limit; i--)
    for (const b of days[i].breaks) out.push({ ...b, dateKey: days[i].dateKey });
  return out.slice(0, limit);
}
