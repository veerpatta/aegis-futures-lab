/* Tiny shared stats helpers for the dashboard and the digest. */

/** Gross wins / gross losses. Null when there are no losses yet (undefined). */
export function profitFactor(pnls: number[]): number | null {
  let wins = 0;
  let losses = 0;
  for (const p of pnls) {
    if (p >= 0) wins += p;
    else losses -= p;
  }
  return losses > 0 ? wins / losses : null;
}

export const fmtPf = (pf: number | null): string =>
  pf === null ? "—" : Number.isFinite(pf) ? pf.toFixed(2) : "∞";
