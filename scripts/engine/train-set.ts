/* Builds the win-probability model's training set from real signals + shadow
   auditions, deduplicating a promoted strategy that could appear in BOTH by
   (strategy, symbol, entry_ts) — preferring the real row (finding 8). Pure, so
   it is unit-tested directly. */

import type { ModelRow } from "./winprob";

export interface RealTrainRow {
  tier: "A" | "B";
  symbol: string;
  dedupe_key: string;
  signal_ts: string;
  regime: string | null;
  vix_bucket: string | null;
  score: number | null;
  rr: number | null;
  pnl_usd: number | null;
  fill_confidence: string | null;
  stale_data?: boolean | null;
  exit_ts?: string | null;
  provenance?: string;
}

export interface ShadowTrainRow {
  strategy: string;
  symbol: string;
  signal_ts: string;
  regime: string | null;
  vix_bucket: string | null;
  score: number | null;
  rr: number | null;
  pnl_usd: number | null;
  fill_confidence: string | null;
  stale_data?: boolean | null;
  exit_ts?: string | null;
  provenance?: string;
}

/** A real row's strategy label is the 2nd segment of its dedupe_key
    (`${tier}:${label}:${symbol}:${entryTime}`). */
export const realStrategyLabel = (dedupe_key: string): string => dedupe_key.split(":")[1] ?? "";

export function buildModelRows(realIn: RealTrainRow[], shadowIn: ShadowTrainRow[], asOf?: string): ModelRow[] {
  /* Item 2.4 — a row computed on stale bars never enters the training set. Its
     features (and its fill classification in particular) describe a market
     state the engine could not actually see, so learning from it teaches the
     model the feed's outages rather than the strategy's edge. Dropped before
     the real-vs-shadow dedup so a stale real row cannot mask a clean shadow
     row for the same (strategy, symbol, entry). */
  const eligible = (s: RealTrainRow | ShadowTrainRow) => !s.stale_data &&
    (!asOf || (!!s.exit_ts && Date.parse(s.exit_ts) <= Date.parse(asOf) && Date.parse(s.signal_ts) <= Date.parse(s.exit_ts)));
  const real = realIn.filter(eligible);
  const shadow = shadowIn.filter(eligible);
  const realKeys = new Set(real.map((s) => `${realStrategyLabel(s.dedupe_key)}|${s.symbol}|${s.signal_ts}`));
  const pick = (s: RealTrainRow | ShadowTrainRow, tier: "A" | "B" | null): ModelRow => ({
    tier,
    regime: s.regime,
    vix_bucket: s.vix_bucket,
    score: s.score,
    rr: s.rr,
    signal_ts: s.signal_ts,
    exit_ts: s.exit_ts,
    symbol: s.symbol,
    strategy: "dedupe_key" in s ? realStrategyLabel(s.dedupe_key) : s.strategy,
    provenance: s.provenance ?? "legacy-unknown",
    pnl_usd: s.pnl_usd,
    fill_confidence: s.fill_confidence,
  });
  return [
    ...real.map((s) => pick(s, s.tier)),
    ...shadow.filter((s) => !realKeys.has(`${s.strategy}|${s.symbol}|${s.signal_ts}`)).map((s) => pick(s, null)),
  ];
}
