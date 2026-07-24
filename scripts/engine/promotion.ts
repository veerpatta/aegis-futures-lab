/* Promotion readiness for shadow-audition streams — mechanical, not vibes.
   A shadow stream is promotable ONLY when all three hold:
     1. ≥ 60 closed signals (costs included in every P&L),
     2. profit factor ≥ 1.2,
     3. positive net in at least 2 regimes among those with data
        (a regime "has data" at ≥ 5 closed signals for the stream; fewer
        than 2 regimes with data ⇒ not promotable — no diversity evidence).
   Pure function so the digest and the monthly tune print the same verdict. */

import { profitFactor } from "@/lib/stats";

export const PROMOTION_MIN_CLOSED = 60;
export const PROMOTION_MIN_PF = 1.2;
export const PROMOTION_MIN_POSITIVE_REGIMES = 2;
export const REGIME_DATA_MIN_CLOSED = 5;

export interface ShadowLike {
  status: string;
  pnl_usd: number | null;
  regime: string | null;
  fill_confidence: string | null;
}

export interface PromotionReport {
  total: number;
  closed: number;
  net: number;
  pf: number | null;
  winRate: number | null;
  exNet: number;
  exPf: number | null;
  regimesWithData: number;
  regimesPositive: number;
  promotable: boolean;
  checklist: { label: string; pass: boolean }[];
}

export function promotionReport(rows: ShadowLike[]): PromotionReport {
  const closedRows = rows.filter((r) => r.pnl_usd !== null);
  const pnls = closedRows.map((r) => r.pnl_usd ?? 0);
  const pf = profitFactor(pnls);
  const wins = pnls.filter((p) => p > 0).length;

  const exPnls = closedRows
    .filter((r) => r.fill_confidence !== "doubtful")
    .map((r) => r.pnl_usd ?? 0);

  const byRegime = new Map<string, number[]>();
  for (const r of closedRows) {
    if (!r.regime) continue;
    const arr = byRegime.get(r.regime) ?? [];
    arr.push(r.pnl_usd ?? 0);
    byRegime.set(r.regime, arr);
  }
  const withData = [...byRegime.values()].filter((v) => v.length >= REGIME_DATA_MIN_CLOSED);
  const positive = withData.filter((v) => v.reduce((a, x) => a + x, 0) > 0).length;

  const closedOk = closedRows.length >= PROMOTION_MIN_CLOSED;
  const pfOk = pf !== null && pf >= PROMOTION_MIN_PF;
  const regimeOk =
    withData.length >= PROMOTION_MIN_POSITIVE_REGIMES &&
    positive >= PROMOTION_MIN_POSITIVE_REGIMES;

  return {
    total: rows.length,
    closed: closedRows.length,
    net: pnls.reduce((a, v) => a + v, 0),
    pf,
    winRate: closedRows.length ? Math.round((wins / closedRows.length) * 100) : null,
    exNet: exPnls.reduce((a, v) => a + v, 0),
    exPf: profitFactor(exPnls),
    regimesWithData: withData.length,
    regimesPositive: positive,
    promotable: closedOk && pfOk && regimeOk,
    checklist: [
      { label: `≥${PROMOTION_MIN_CLOSED} closed (${closedRows.length})`, pass: closedOk },
      { label: `PF ≥ ${PROMOTION_MIN_PF} (${pf === null ? "—" : pf.toFixed(2)})`, pass: pfOk },
      {
        label: `positive in ≥${PROMOTION_MIN_POSITIVE_REGIMES} regimes with data (${positive}/${withData.length})`,
        pass: regimeOk,
      },
    ],
  };
}
