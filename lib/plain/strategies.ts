/* One plain sentence per method, for the Lab cards and anywhere else a method
   is named to someone who does not know the jargon.

   Kept here rather than in lib/strategies: that folder is part of the research
   code hash (scripts/engine/research-code.ts), so rewording a label there
   would restart every forward observation. The precise description stays in
   each strategy's own `blurb`. */

export const PLAIN_SUMMARY: Record<string, string> = {
  "zone-v5": "Buys or sells when price returns to a strong earlier buying or selling area.",
  "ema-cross": "Follows the trend: buys when a fast average crosses above a slow one, sells on the opposite cross.",
  "rsi-reversion": "Bets on a bounce after a short, sharp move goes too far.",
  orb: "Trades the first break out of the opening half hour's range.",
  "vwap-reversion": "Bets that price stretched far from the day's average price will come back to it.",
  "bollinger-breakout": "Waits for a quiet, tight market, then trades the first big move out of it.",
  "orb-relvol": "The opening-range break, but only on unusually busy mornings.",
  "turn-of-month": "Buys around the turn of the month, when index money often flows in.",
  "gold-silver-zone": "Zone trades in gold, taken only when silver agrees.",
  "zone-rejection-v2": "Waits for price to touch a strong area and visibly turn away before entering.",
  "rsi-context-v2": "The bounce bet, but only when the wider market backs it up.",
  "vwap-pullback-v1": "Joins a trend when price dips back to the day's average price.",
  "opening-continuation-v1": "Follows the first half hour when it agrees with the recent trend.",
  "overnight-rejection-v1": "Fades a failed break of the overnight range before 11:00 New York time.",
};

export const plainSummary = (id: string, fallback: string): string => PLAIN_SUMMARY[id] ?? fallback;
