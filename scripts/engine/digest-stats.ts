/* Pure headline-stat helpers for the weekly digest, split out so they can be
   unit-tested (digest.ts itself runs main() on import). Breaker-suppressed
   rows must be excluded from every headline table — consistent with Home and
   the Signals page — and surfaced separately as paused-stream practice
   (finding 4). */

import { profitFactor } from "@/lib/stats";

export interface HeadlineSig {
  pnl_usd: number | null;
  fill_confidence: string | null;
  suppressed?: boolean | null;
}

export interface Stats {
  total: number;
  closed: number;
  net: number;
  pf: number | null;
  winRate: number | null;
}

export function stats(rows: HeadlineSig[]): Stats {
  const closed = rows.filter((r) => r.pnl_usd !== null);
  const pnls = closed.map((r) => r.pnl_usd ?? 0);
  const wins = pnls.filter((p) => p > 0).length;
  return {
    total: rows.length,
    closed: closed.length,
    net: pnls.reduce((a, v) => a + v, 0),
    pf: profitFactor(pnls),
    winRate: closed.length ? Math.round((wins / closed.length) * 100) : null,
  };
}

export const exDoubtful = <T extends HeadlineSig>(rows: T[]): T[] =>
  rows.filter((r) => r.fill_confidence !== "doubtful");

/** Rows that count in headline stats — everything NOT breaker-suppressed. */
export const activeOnly = <T extends HeadlineSig>(rows: T[]): T[] =>
  rows.filter((r) => !r.suppressed);

/** The benched streams' silent practice this window — reported, never hidden. */
export function pausedPractice(rows: HeadlineSig[]): { total: number; closed: number; net: number } {
  const paused = rows.filter((r) => r.suppressed);
  const closed = paused.filter((r) => r.pnl_usd !== null);
  return {
    total: paused.length,
    closed: closed.length,
    net: closed.reduce((a, r) => a + (r.pnl_usd ?? 0), 0),
  };
}
