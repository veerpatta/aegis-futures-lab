/* Shared stats helpers for the dashboard and the digest.

   ── Why the sample gate lives here ──────────────────────────────────────
   Live collection began 2026-07-19. At the time of writing `public.signals`
   holds 24 closed rows, ALL of them tier B — tier A has produced none. Every
   win rate, profit factor and per-day figure on screen is drawn from that.
   A percentage over 24 observations is not a measurement, and a percentage
   printed without its n invites the reader to treat it as one.

   So: one definition of "is this enough to judge", one confidence interval,
   and one piece of copy for the not-yet case, imported by every surface. The
   same-shaped bug this avoids is the one recorded throughout this repo — a
   threshold or a marker string copied into a second file and then drifting
   from the first (see STALE_MARKER in lib/time/session.ts for the pattern).

   Expectancy is the headline and win rate is subordinate, because a win rate
   without R context misleads: 70% at 0.5R loses money and 35% at 3R makes it. */

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

/* ── Sample-size gating ───────────────────────────────────────────────────
   TWO thresholds, deliberately different, because they answer different
   questions. Keeping both here rather than one each in two files is the
   point — a future reader can see they differ and why.

   MIN_JUDGED_N gates DISPLAY: below it a rate renders greyed as "previewed,
   not judged" wherever it appears. 30 is the conventional floor for treating
   a proportion's normal approximation as meaningful at all.

   MIN_VERDICT_N gates the "Live vs tuning window" VERDICT specifically — the
   stricter act of comparing a live profit factor against the band the tuning
   window promised. It is 20 because that is what that panel has always used;
   raising it here would silently change what the dashboard says about every
   stream, which is not this module's job. */
export const MIN_JUDGED_N = 30;
export const MIN_VERDICT_N = 20;

/** The one piece of copy for a below-threshold metric. Never re-type it. */
export const PREVIEW_NOTE = "previewed, not judged";

/** `empty` = nothing logged yet (which is not a failure, and must never read
    as one); `previewed` = some data, too little to judge; `judged` = enough. */
export type SampleVerdict = "empty" | "previewed" | "judged";

export function sampleVerdict(n: number): SampleVerdict {
  if (!Number.isFinite(n) || n <= 0) return "empty";
  return n >= MIN_JUDGED_N ? "judged" : "previewed";
}

export const isJudged = (n: number): boolean => sampleVerdict(n) === "judged";

/* ── Confidence interval ──────────────────────────────────────────────────
   Wilson score interval, not the normal ("Wald") approximation. Wald is the
   one everyone writes from memory — p ± z·√(p(1−p)/n) — and it is actively
   wrong at exactly the sample sizes this app has: at 8 wins from 8 trades it
   reports 100% ± 0, a claim of certainty from eight observations. Wilson
   stays inside [0,1] and keeps a sensible width at small n and extreme p,
   which is the whole reason it is here. */

export interface Interval {
  lo: number;
  hi: number;
}

/** z for a two-sided 95% interval. */
export const WILSON_Z95 = 1.959963984540054;

/** Wilson score interval for `successes` out of `n`, as proportions 0–1.
    Null when there is nothing to bound (n <= 0). */
export function wilsonInterval(
  successes: number,
  n: number,
  z: number = WILSON_Z95
): Interval | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const k = Math.min(Math.max(successes, 0), n);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lo: Math.max(0, centre - margin),
    hi: Math.min(1, centre + margin),
  };
}

/* ── The one win-rate / expectancy definition for P&L arrays ──────────────
   lib/backtest/metrics.ts owns the same definitions over `Trade[]` for the
   engine. These take the `number[]` of P&L that the dashboard actually has
   (SignalRow.pnl_usd), because reaching metricsFromTrades from a SignalRow
   would mean fabricating Trade objects. The two are pinned to each other by
   a cross-agreement test in tests/stats.test.ts — where they cannot be
   literally the same function, a test that fails when they disagree is the
   enforceable substitute. */

/** Strictly positive, matching metrics.ts. A scratch (exactly 0) is neither
    a win nor a loss — counting it as a win would flatter every win rate. */
export const countWins = (pnls: number[]): number => pnls.filter((p) => p > 0).length;

export const countLosses = (pnls: number[]): number => pnls.filter((p) => p < 0).length;

/** Win rate as a PERCENT, or null when there is nothing to divide by. */
export function winRatePct(successes: number, n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return (successes / n) * 100;
}

/** Average P&L per trade — the headline. Null on an empty sample. */
export function expectancy(pnls: number[]): number | null {
  if (!pnls.length) return null;
  return pnls.reduce((a, v) => a + v, 0) / pnls.length;
}

/* ── Rendering ────────────────────────────────────────────────────────────
   `rateReadout` exists so that the easiest way to render a rate is also the
   honest one: it cannot return a bare percentage. Callers get the verdict and
   map it to their own CSS module's class — no class names in lib/. */

export interface RateReadout {
  n: number;
  verdict: SampleVerdict;
  /** Percent, or null when n = 0. */
  value: number | null;
  /** 95% Wilson bounds as percentages, or null when n = 0. */
  ci: Interval | null;
  /** e.g. "58%" — em dash when there is nothing to show. */
  valueLabel: string;
  /** e.g. "38–76%" — null when there is nothing to bound. */
  ciLabel: string | null;
  /** e.g. "n=24". Always present, which is the point. */
  nLabel: string;
  /** Everything at once: "58% (n=24, 95% CI 38–76%)". */
  label: string;
}

export function rateReadout(successes: number, n: number, digits = 0): RateReadout {
  const verdict = sampleVerdict(n);
  const value = winRatePct(successes, n);
  const raw = wilsonInterval(successes, n);
  const ci = raw ? { lo: raw.lo * 100, hi: raw.hi * 100 } : null;
  const valueLabel = value === null ? "—" : `${value.toFixed(digits)}%`;
  const ciLabel = ci ? `${ci.lo.toFixed(digits)}–${ci.hi.toFixed(digits)}%` : null;
  const nLabel = `n=${Math.max(0, Math.trunc(n))}`;
  return {
    n,
    verdict,
    value,
    ci,
    valueLabel,
    ciLabel,
    nLabel,
    label: ciLabel
      ? `${valueLabel} (${nLabel}, 95% CI ${ciLabel})`
      : `${valueLabel} (${nLabel})`,
  };
}

/** Convenience for the common case: a rate straight off a P&L array. */
export const rateFromPnls = (pnls: number[], digits = 0): RateReadout =>
  rateReadout(countWins(pnls), pnls.length, digits);

/* ── Tuning-band verdict ──────────────────────────────────────────────────
   Lifted verbatim out of components/home/LiveVsTuning.tsx so the threshold
   and the ladder live beside the display gate instead of in a component.
   Behaviour is unchanged: collecting below MIN_VERDICT_N, then tracking
   (live PF within or above the band), lagging (below the band but still
   above 1.0), underwater (PF < 1.0). A null PF means no losses yet.

   REFUTED is the fifth state and it outranks every other, including
   collecting. It exists because a band can be shown to be wrong by evidence
   that has nothing to do with the live rows: tier A's band came from 16
   trades on 51 sessions of delayed Yahoo data, and seven years of real CME
   data then measured the same configuration at PF 0.55 over 1,180 trades.
   Without this state the panel prints "COLLECTING 0/20" under a promise of
   PF 1.05–1.30 — a stream with no live evidence reads as one that simply has
   not proved itself yet, when in fact it has been disproved. A refuted stream
   can never print TRACKING however the live rows come in; twenty lucky trades
   do not overturn 1,180. */
export type BandVerdict = "collecting" | "tracking" | "lagging" | "underwater" | "refuted";

export function bandVerdict(
  closed: number,
  pf: number | null,
  band: [number, number],
  refuted = false
): BandVerdict {
  if (refuted) return "refuted";
  if (closed < MIN_VERDICT_N) return "collecting";
  if (pf === null || pf >= band[0]) return "tracking";
  if (pf >= 1.0) return "lagging";
  return "underwater";
}
