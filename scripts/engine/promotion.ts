/* Promotion readiness for shadow-audition streams — mechanical, not vibes.

   TWO gates, and the distinction is the point.

   The AUDITION checks below are the cheap ones, computable from the shadow
   rows alone:
     1. ≥ 60 closed signals (costs included in every P&L),
     2. profit factor ≥ 1.2,
     3. positive net in at least 2 regimes among those with data
        (a regime "has data" at ≥ 5 closed signals for the stream; fewer
        than 2 regimes with data ⇒ no diversity evidence).

   They are necessary and nowhere near sufficient. Phase 1 measured what 60
   trades and PF 1.2 are worth: MNQ 2020 reached the 94.6th percentile of its
   matched random null and MNQ 2023 the 93.0th, and both are noise — with 17
   cells, roughly one crossing p95 by chance is the expectation. A stream that
   clears the audition has shown it is worth BENCHMARKING, not that it has an
   edge.

   So `promotable` is the audition AND `lib/validation/promotionGate.ts`, which
   asks the question that refuted the incumbents: does the entry beat matched
   random entries, does the deflated Sharpe survive the trial-count correction,
   what is the PBO, does it hold across purged CV folds, and is there enough
   evidence (150 trades) to judge. The gate counts an UNMEASURED check as a
   gap, never a pass — so a stream with no random-entry benchmark is not
   promotable no matter how good its audition numbers look. That is the
   intended behaviour, not an oversight: until someone runs the benchmark,
   the honest answer is "not yet measured".

   Pure function so the digest and the monthly tune print the same verdict. */

import { profitFactor } from "@/lib/stats";
import { TARGETLESS_NOTE, targetlessStream } from "@/lib/signals/status";
import {
  evaluatePromotion,
  type PromotionEvidence,
  type PromotionVerdict,
} from "@/lib/validation/promotionGate";

export const PROMOTION_MIN_CLOSED = 60;
export const PROMOTION_MIN_PF = 1.2;
export const PROMOTION_MIN_POSITIVE_REGIMES = 2;
export const REGIME_DATA_MIN_CLOSED = 5;

export interface ShadowLike {
  status: string;
  pnl_usd: number | null;
  regime: string | null;
  fill_confidence: string | null;
  /* Absent on older callers; a stream where this is null on EVERY row has no
     bracket, so its win rate is not comparable with a bracketed stream's. */
  target_price?: number | null;
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
  /* The three audition checks alone. Kept separate from `promotable` so a
     report can say "ready to be benchmarked" without implying "ready to go
     live" — the two were the same number before the gate was wired, which is
     how a 60-trade result could reach production. */
  auditionPassed: boolean;
  /* The evidence gate's full verdict, including which checks were never
     measured. Carried on the report so every surface can show WHY a stream is
     not promotable rather than printing a bare "no". */
  gate: PromotionVerdict;
  promotable: boolean;
  checklist: { label: string; pass: boolean }[];
  /* True when NO row in the stream carries a price target. winRate is then
     null and every surface must print winRateNote instead of a percentage. */
  targetless: boolean;
  winRateNote: string | null;
}

/* `evidence` carries whatever has actually been measured for this stream —
   today nothing does, because the only producer is the manual phase4.ts run.
   Absent evidence is the honest default: the gate reports every check as a
   gap and refuses promotion, which is exactly right for a stream nobody has
   benchmarked. Wiring a producer later is the work that makes promotion
   possible again; relaxing this parameter is not. */
export function promotionReport(rows: ShadowLike[], evidence?: PromotionEvidence): PromotionReport {
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

  /* Item 2.2(b): a stream with no bracket on any row cannot have a target-hit
     rate, and its win rate is not comparable with a bracketed stream's — there
     is no R to normalise by. Refuse to print one rather than show a number
     that ranks alongside the others as if it meant the same thing. */
  const targetless = targetlessStream(
    rows.filter((r) => r.target_price !== undefined) as { target_price: number | null }[]
  );

  const closedOk = closedRows.length >= PROMOTION_MIN_CLOSED;
  const pfOk = pf !== null && pf >= PROMOTION_MIN_PF;
  const regimeOk =
    withData.length >= PROMOTION_MIN_POSITIVE_REGIMES &&
    positive >= PROMOTION_MIN_POSITIVE_REGIMES;
  const auditionPassed = closedOk && pfOk && regimeOk;

  /* The stream's own closed count is real evidence and is passed through, so
     the gate's trade-count check reports the true shortfall (60 of 150) rather
     than an unmeasured gap. Everything else has no producer yet. */
  const gate = evaluatePromotion({ trades: closedRows.length, ...evidence });

  return {
    total: rows.length,
    closed: closedRows.length,
    net: pnls.reduce((a, v) => a + v, 0),
    pf,
    winRate: targetless || !closedRows.length ? null : Math.round((wins / closedRows.length) * 100),
    exNet: exPnls.reduce((a, v) => a + v, 0),
    exPf: profitFactor(exPnls),
    regimesWithData: withData.length,
    regimesPositive: positive,
    auditionPassed,
    gate,
    promotable: auditionPassed && gate.promote,
    checklist: [
      { label: `≥${PROMOTION_MIN_CLOSED} closed (${closedRows.length})`, pass: closedOk },
      { label: `PF ≥ ${PROMOTION_MIN_PF} (${pf === null ? "—" : pf.toFixed(2)})`, pass: pfOk },
      {
        label: `positive in ≥${PROMOTION_MIN_POSITIVE_REGIMES} regimes with data (${positive}/${withData.length})`,
        pass: regimeOk,
      },
      ...(targetless ? [{ label: TARGETLESS_NOTE, pass: false }] : []),
      /* The gate's checks, appended so a reader sees the whole bar rather than
         three cheap checks and an unexplained "no". A gap prints as "not
         measured" rather than a failure, per the gate's own distinction. */
      ...gate.checks.map((c) => ({
        label: c.status === "not-measured" ? `${c.label} — not measured` : c.label,
        pass: c.status === "pass",
      })),
    ],
    targetless,
    winRateNote: targetless ? TARGETLESS_NOTE : null,
  };
}
