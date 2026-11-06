/* The AI second opinion's prompt (ai-judge-prompt-v1) and its answer parser.

   The prompt tells the model the truth about its job: these methods have not
   beaten random entries on their own, so the only useful thing it can do is
   tell the better setups from the worse ones. It never sees what the bot did
   with the idea, the result, or anything after the decision's cutoff. */

import { extractJson } from "@/lib/ai-free/nvidia";
import { PLAIN_SUMMARY } from "@/lib/plain/strategies";
import type { MarketContext } from "./features";

export interface JudgeIdea {
  symbol: "MES" | "MNQ";
  side: "LONG" | "SHORT";
  strategy: string;
  paused: boolean;
  entry: number;
  stop: number;
  target: number | null;
  rewardRisk: number | null;
  riskUsdOneContract: number | null;
  newYorkTime: string;
  minutesUntilFlat: number;
  features: { regime: string | null; vixBucket: string | null; atrPct: number | null; vwapAtr: number | null };
}

const MARKETS = { MES: "S&P 500 micro future (MES)", MNQ: "Nasdaq-100 micro future (MNQ)" } as const;
const METHOD_NAMES: Record<string, string> = { "rsi-reversion": "RSI reversion", "zone-v5": "Zone setups" };

export const JUDGE_SYSTEM = [
  "You review one simulated futures trade idea for an evaluation study of a virtual trading bot. No real money is involved.",
  "You see only facts known when the idea was made.",
  "The methods that produce these ideas have not beaten random entries on their own; your job is to separate the better setups from the worse ones, not to approve or reject everything.",
  "Weigh the trend, how stretched the price is, volatility, the stop distance, the time of day and the reward compared with the risk.",
  'Reply with one JSON object only, no markdown: {"decision":"take" or "skip","confidence":integer 0-100,"reason":"at most 60 words of plain English for a beginner"}.',
].join(" ");

const r2 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** The user message: one JSON object of facts. Field names are plain English
    because the model reads them; nulls mean "not known at the cutoff". */
export function judgeUserMessage(idea: JudgeIdea, context: MarketContext): string {
  const method = METHOD_NAMES[idea.strategy] ?? idea.strategy;
  const summary = PLAIN_SUMMARY[idea.strategy];
  return JSON.stringify({
    market: MARKETS[idea.symbol],
    idea: idea.side === "LONG" ? "buy: profits if the price rises" : "sell: profits if the price falls",
    method: summary ? `${method}: ${summary}` : method,
    method_paused_after_losing_streak: idea.paused,
    new_york_time: idea.newYorkTime,
    minutes_until_must_be_flat: idea.minutesUntilFlat,
    entry: r2(idea.entry),
    stop: r2(idea.stop),
    target: r2(idea.target),
    reward_to_risk: r2(idea.rewardRisk),
    risk_usd_one_contract: r2(idea.riskUsdOneContract),
    learner_features: {
      regime: idea.features.regime,
      volatility_index_level: idea.features.vixBucket,
      atr_percent_of_price: r2(idea.features.atrPct),
      distance_from_day_average_price_in_atr: r2(idea.features.vwapAtr),
    },
    market_context: {
      last_price: context.lastClose,
      change_since_today_open_pct: context.changeTodayPct,
      change_since_previous_session_close_pct: context.priorCloseDistancePct,
      change_last_15_min_pct: context.last15mPct,
      change_last_hour_pct: context.last1hPct,
      change_last_4_hours_pct: context.last4hPct,
      average_5min_range_points_atr14: context.atr14Points,
      stop_distance_in_atr: context.stopDistanceAtr,
      rsi14_5min: context.rsi14,
      position_in_todays_range_0_low_1_high: context.dayRangePosition,
      one_hour_trend: context.trend1h,
    },
  });
}

export interface JudgeVerdict {
  decision: "take" | "skip";
  confidence: number;
  reason: string;
}

/** Null when the answer has no usable decision and confidence. A long reason
    is kept (shortened for display); extra keys are ignored. */
export function parseJudgeVerdict(text: string): JudgeVerdict | null {
  const value = extractJson(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const decision = typeof v.decision === "string" ? v.decision.trim().toLowerCase() : "";
  if (decision !== "take" && decision !== "skip") return null;
  const raw = typeof v.confidence === "string" && /^\s*\d{1,3}(\.\d+)?\s*$/.test(v.confidence) ? Number(v.confidence) : v.confidence;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) return null;
  const reason = typeof v.reason === "string" ? v.reason.replace(/\s+/g, " ").trim() : "";
  if (!reason) return null;
  return { decision, confidence: Math.round(raw), reason: reason.length > 1200 ? `${reason.slice(0, 1197)}...` : reason };
}
