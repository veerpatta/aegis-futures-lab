/* How a method being tested is doing, in plain words.

   The colours follow the honesty rules (docs/design-language.md §6): amber is
   "too little evidence" and never a loss; red is only for a MEASURED negative
   result; a method that failed its checks without losing money is amber too,
   because "did not qualify" is not the same claim as "lost money". */

import type { Candidate } from "@/lib/paper/overview";

/** Trades a history test needs before its result is judged at all. */
export const MIN_HISTORY_TRADES = 150;
/** Forward requirement before practice money: 60 new trades over 20 trading days. */
export const FORWARD_TRADES = 60;
export const FORWARD_DAYS = 20;

export interface MethodVerdict {
  label: string;
  tone: "green" | "amber" | "red" | "dim";
  /** One sentence for the row. */
  detail: string;
}

interface Historical {
  n?: number;
  net?: number;
  gate?: { promote?: boolean };
}

export function historicalOf(c: Candidate): Historical | null {
  return c.historical && typeof c.historical === "object" ? (c.historical as Historical) : null;
}

export function methodVerdict(c: Candidate): MethodVerdict {
  const h = historicalOf(c);
  if (!h) return { label: "Waiting for its test", tone: "dim", detail: "Registered, not tested yet." };
  const n = Number(h.n ?? 0);
  const net = Number(h.net ?? 0);
  if (n < MIN_HISTORY_TRADES)
    return {
      label: "Too early to tell",
      tone: "amber",
      detail: `Only ${n} test trade${n === 1 ? "" : "s"} so far — at least ${MIN_HISTORY_TRADES} are needed to judge.`,
    };
  if (h.gate?.promote)
    return { label: "Passed its history test", tone: "green", detail: "Now it has to prove itself on new trades." };
  if (net < 0)
    return {
      label: "Lost money in testing",
      tone: "red",
      detail: `Lost money over ${n.toLocaleString("en-US")} test trades after costs, so it can never trade practice money.`,
    };
  return {
    label: "Didn't qualify",
    tone: "amber",
    detail: `Made money over ${n.toLocaleString("en-US")} test trades but failed other checks, such as beating random entries.`,
  };
}

/** 0–1 progress toward the forward requirement (the slower of trades and days). */
export function forwardProgress(c: Candidate): number {
  return Math.min(1, c.forward_closed / FORWARD_TRADES, c.forward_days / FORWARD_DAYS);
}
