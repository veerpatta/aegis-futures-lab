/* The live signal tiers, tuned 2026-07-19 on the trailing 60 days of delayed
   Yahoo 5m data (scripts/engine/report.ts reproduces the numbers).

   Tier A — high conviction: Zone Engine v5 with the app's tuned defaults
   (RTH structure, resting limit entry, 2R target, intermarket confirmation,
   weak-zone filter). ~0.3-0.4 trades/day, clustered on the days price
   reaches Daily/4H structure. PF ≈ 1.35 on the tuning window.

   ⚠ THE TIER-A FIGURE ABOVE IS THE ORIGINAL PROMISE, KEPT FOR HISTORY. It was
   measured through `report.ts --archive`, which sliced the bar archive at an
   arbitrary instant and so was exposed to the truncated first-daily-bar defect
   fixed in lib/data/window.ts. TUNING_BASELINE below now carries the
   RE-MEASURED band (2026-07-25, day-aligned full archive) together with its
   provenance; that is the number to compare against.

   What the re-measurement showed, over 51 aligned sessions:
     16 trades · 0.314/day mean · PF 1.27 · net +$357 · win rate 43.8%
   which lands close to the original 0.3-0.4/day at PF ~1.35 — but for a reason
   the original band hid. Tier A traded on 3 of 51 sessions (5.9%), and 14 of
   the 16 trades were on 2026-07-09 alone, a day that LOST $192. The P&L comes
   from two isolated single-trade winners (2026-05-20 +$243, 2026-06-09 +$305).
   So the LEVEL roughly reproduces while the SHAPE does not: this is not a
   0.3/day pace, it is a cluster, and TuningBaseline.clustered now says so on
   the dashboard.

   Robustness is what the alignment fix bought. Across eleven one-day window
   shifts tier A now moves 14-18 trades with invalidFill pinned at 4; before
   alignment the same shifts swung it 2-14 with invalidFill 4-61.

   Full evidence: scripts/diag/PHASE1-FINDINGS.md, and
   `npx tsx scripts/diag/tier-a-baseline.ts` reproduces the numbers above.

   Entry logic is deliberately UNCHANGED. A parameter grid over three trading
   days is a fit to 2026-07-09, not a retune — which is why `challengerFor`
   refuses tier A outright and tune.ts's header calls it a curve-fitting
   machine. Any future tier-A parameter change goes through the challenger's
   out-of-sample gate, not by hand.

   Tier B — daily flow: RSI mean-reversion (25/75 bands, London+NY session,
   1.5×ATR stop, 1.5R target) run independently per symbol with tight daily
   discipline locks (max 2 trades, stop after 2 losses or -$250). ~2/day
   combined, PF ≈ 1.2-1.3 on the tuning window. The locks are part of the
   edge: without them the same params grind at PF ≈ 1.1.

   Combined on the tuning window: 2.76 signals/day, ≥1 signal on 45/49
   trading days, all three streams net positive. */

import type { Bar } from "@/lib/types";
import type { DisciplineLocks } from "@/lib/backtest/engine";
import { defaultParams, type ExecutionConfig, type ParamValues } from "@/lib/strategies/types";
import { zoneV5 } from "@/lib/strategies/zone-v5";
import { rsiReversion } from "@/lib/strategies/rsi-reversion";
import { strategyById } from "@/lib/strategies/registry";

export const EXECUTION: ExecutionConfig = {
  cost: 2.4,
  slippage: 0.25,
  maxRisk: 160,
  sizing: "risk",
  fillModel: "limit",
};

export const STARTING_CAPITAL = 3000;
export const SESSION_EXIT_MINUTE = 925; // flat by 15:25 ET

/* What the tuning window promised (trailing 60d as of 2026-07-19) —
   structured so the dashboard's "Live vs tuning window" panel can compare
   reality against the promise. Bands restate the header notes above; they
   are expectations from one 60-day sample, not guarantees. */
export const GO_LIVE_DATE = "2026-07-19"; // NY dateKey of the first live signals

export interface TuningBaseline {
  key: "A" | "B:MES" | "B:MNQ";
  label: string;
  tier: "A" | "B";
  symbol: "MES" | "MNQ" | null; // null = every symbol the tier trades
  pfBand: [number, number];
  tradesPerDay: [number, number];
  /* Where this band came from, so it can never go stale invisibly again. The
     old tier-A band survived for weeks after the measurement behind it stopped
     reproducing, and nothing in the code said where it came from. */
  provenance: string;
  /* True when the stream's trades CLUSTER rather than arrive at a rate. The
     tradesPerDay band is then a long-run average, not a pace to expect on any
     given day, and the dashboard must say so — otherwise a quiet week reads as
     a shortfall against a promise that was never made. */
  clustered?: boolean;
}

export const TUNING_BASELINE: TuningBaseline[] = [
  {
    key: "A",
    label: "Zone setups · MES+MNQ",
    tier: "A",
    symbol: null,
    /* Re-measured 2026-07-25 on the DAY-ALIGNED full archive (51 sessions,
       2026-05-12 → 2026-07-24, scripts/diag/tier-a-baseline.ts): 16 trades,
       0.314/day mean, PF 1.27, net +$357, win rate 43.8%.

       The band is deliberately WIDER than that measurement and its floor is
       1.05, not 1.27. Sixteen trades on three sessions cannot support a tight
       band, and a floor at break-even would let a stream that makes no money
       print TRACKING. Setting the floor just above 1.0 means break-even shows
       as LAGGING, which is the honest reading. */
    pfBand: [1.05, 1.3],
    tradesPerDay: [0.2, 0.4],
    clustered: true,
    provenance:
      "measured 2026-07-25 on the day-aligned full archive (51 sessions): 16 trades, PF 1.27, " +
      "net +$357 — but on only 3 of 51 sessions, 14 of them on 2026-07-09 alone. Band widened " +
      "from the point estimate because 16 trades on 3 days cannot support a tight one. " +
      "Reproduce: npx tsx scripts/diag/tier-a-baseline.ts",
  },
  {
    key: "B:MES",
    label: "Daily flow · MES",
    tier: "B",
    symbol: "MES",
    pfBand: [1.2, 1.3],
    tradesPerDay: [0.8, 1.2],
    provenance:
      "tuned 2026-07-19; re-checked 2026-07-25 on the day-aligned archive at 62 trades, " +
      "PF 1.41, net +$1,643 (1.22/day) — inside/above the band, so unchanged. rsi-reversion " +
      "builds no multi-day frame, so it was never exposed to the archive-alignment defect.",
  },
  {
    key: "B:MNQ",
    label: "Daily flow · MNQ",
    tier: "B",
    symbol: "MNQ",
    pfBand: [1.2, 1.3],
    tradesPerDay: [0.8, 1.2],
    provenance:
      "tuned 2026-07-19; re-checked 2026-07-25 on the day-aligned archive at 56 trades, " +
      "PF 1.25, net +$877 (1.10/day) — inside the band, so unchanged. Same no-multi-day-frame " +
      "exemption from the alignment defect as MES.",
  },
];

export interface TierStream {
  tier: "A" | "B";
  label: string;
  strategyId: string;
  symbols: ("MES" | "MNQ")[]; // one combined run over all listed symbols
  params: ParamValues;
  fillModel: "limit" | "nextOpen";
  locks: DisciplineLocks | null;
  /* Per-symbol $ risk cap (item 2.3). Absent ⇒ EXECUTION.maxRisk, which is
     what every stream used before the split, so callers that ignore this
     field keep today's behaviour exactly. */
  maxRisk?: number;
}

export const B_LOCKS: DisciplineLocks = {
  dailyLoss: 250,
  maxTrades: 2,
  maxLosses: 2,
  maxDrawdown: 999999,
};

/* ── Per-symbol risk profile (item 2.3) ───────────────────────────────────
   The brief's premise was that MNQ, at "4× the point volatility of MES against
   identical dollar locks", gets stopped out far more often on the same
   discipline settings. Measured (scripts/diag/atr-ratio.ts, full archive, RTH
   bars, ATR(14) — the same length rsi-reversion uses), the premise is INVERTED:

     symbol  point value  mean ATR      mean ATR $/contract
     MES     $5           8.52 pts      $42.61
     MNQ     $2           57.08 pts     $114.16      ratio 2.68× (not 4×)

   Two things follow that the brief did not anticipate:

   1. Stop distance is ALREADY volatility-scaled. rsi-reversion sets its stop
      at `atrMult × ATR` (lib/strategies/rsi-reversion.ts:93), so re-deriving it
      "in ATR terms" would change nothing — and touching atrMult would be a
      signal change, which this item explicitly forbids. Left alone.

   2. Risk-based sizing already equalises dollar risk per trade... except that
      contracts are integers. Live rows show what that does:

        symbol  n   avg qty  avg risk  avg stop
        MES     8   3.13     $142.2    9.63 pts
        MNQ    12   1.00     $114.7   56.16 pts

      MNQ's per-contract risk (~$115) means floor($160 / $115) = 1 contract,
      always — a second contract would need $230. So MNQ is pinned at qty 1 and
      is chronically UNDER-risked: $114.7 against MES's $142.2, i.e. 81% of the
      risk for the same nominal cap. It is not being over-risked at all.

   So the honest calibration is not a bigger MNQ cap (that would mean $230+ of
   real risk per trade on a $3,000 account — worse, not better). It is to make
   the DAILY-LOSS lock bite after the same number of losing trades on both
   symbols. MES tolerates 250/142.2 = 1.76 losses before locking; MNQ tolerates
   250/114.7 = 2.18. Equalising at MES's 1.76 gives MNQ 1.76 × 114.7 ≈ $202.

   MES is byte-identical to B_LOCKS above, so its behaviour is unchanged
   (parity). maxRisk stays $160 on both, with the reason recorded: integer
   contract quantisation, not the cap, is MNQ's binding constraint.

   ⚠ MEASURED EFFECT OF THE MNQ CHANGE: NONE. Over the full archive, MNQ is
   identical before and after — 56 trades, 27W/29L, PF 1.25, net $877, 15 lock
   skips either way. The reason is worth writing down because it invalidates
   the brief's premise a second time: `maxTrades: 2` and `maxLosses: 2` ALWAYS
   bind before `dailyLoss` can. Two MNQ losses cost ~$230, but by then the
   trade-count and consecutive-loss locks have already fired, and the engine
   only tests the locks before OPENING a trade. So for tier B at these sizes
   the daily-loss lock is unreachable on both symbols — dead configuration,
   whatever number it holds.

   The consequence: MNQ's underperformance is NOT a sizing artefact, and no
   sizing change can fix it. Live tier B is MES 7W/1L +$1,252 against MNQ
   6W/5L +$390; on the archive it is PF 1.41 vs 1.25. That gap is win rate,
   i.e. edge, and it belongs to the challenger machinery on out-of-sample
   evidence — not to a hand-tuned lock. The per-symbol structure is kept
   because it is the right shape and becomes live the moment maxTrades changes,
   but nobody should read this item as having improved MNQ. */
export interface SymbolRisk {
  /** Absolute $ risk cap per trade, before integer-contract rounding. */
  maxRisk: number;
  locks: DisciplineLocks;
  /** Why these numbers, so a future reader can re-derive them. */
  note: string;
}

/** Measured MNQ/MES dollar-ATR ratio — re-derive with scripts/diag/atr-ratio.ts. */
export const MNQ_MES_DOLLAR_ATR_RATIO = 2.68;

export const SYMBOL_RISK: Record<"MES" | "MNQ", SymbolRisk> = {
  MES: {
    maxRisk: EXECUTION.maxRisk,
    locks: B_LOCKS,
    note: "unchanged from the tuned configuration — the parity reference",
  },
  MNQ: {
    maxRisk: EXECUTION.maxRisk, // integer sizing, not the cap, is the constraint
    locks: {
      ...B_LOCKS,
      // 1.76 losing trades × $114.7 realised risk ≈ $202, matching how many
      // losses MES tolerates rather than matching the dollar figure.
      dailyLoss: 202,
    },
    note: "dailyLoss scaled so the lock bites after the same number of losses as MES ($114.7 realised risk vs $142.2)",
  },
};

/** The risk profile for a stream — per symbol when it trades exactly one. */
export function riskFor(symbols: ("MES" | "MNQ")[]): SymbolRisk {
  return symbols.length === 1 ? SYMBOL_RISK[symbols[0]] : SYMBOL_RISK.MES;
}

/* ── Bot-editable blocks — the ONLY things the weekly-challenger bot may edit,
   and only ever via a human-merged PR. Both DEFAULT EMPTY, so live behaviour
   (and the golden parity tests) are unchanged until a human merges. Keying:
   "A" for the zone stream, "B:MES"/"B:MNQ" for the RSI streams. */

/** Param overrides adopted from a surviving challenger. */
export const CHALLENGER_OVERRIDES: Record<string, Partial<ParamValues>> = {"B:MNQ":{"oversold":20,"overbought":75,"targetR":1.5}};

/** Shadow strategies promoted to live tier-B2 streams. */
export const PROMOTED_SHADOWS: { label: string; strategyId: string; symbols: ("MES" | "MNQ")[] }[] = [];

export function streamOverrideKey(tier: "A" | "B", symbols: ("MES" | "MNQ")[]): string {
  return tier === "A" ? "A" : `B:${symbols.join("+")}`;
}

export function tierStreams(): TierStream[] {
  const rsiParams: ParamValues = {
    ...defaultParams(rsiReversion),
    session: "day",
    oversold: 25,
    overbought: 75,
  };
  const base: TierStream[] = [
    {
      tier: "A",
      label: "zone-v5",
      strategyId: "zone-v5",
      symbols: ["MES", "MNQ"],
      params: defaultParams(zoneV5),
      fillModel: "limit",
      locks: null,
    },
    {
      tier: "B",
      label: "rsi-reversion",
      strategyId: "rsi-reversion",
      symbols: ["MES"],
      params: rsiParams,
      fillModel: "nextOpen",
      locks: SYMBOL_RISK.MES.locks, // === B_LOCKS (parity reference)
      maxRisk: SYMBOL_RISK.MES.maxRisk,
    },
    {
      tier: "B",
      label: "rsi-reversion",
      strategyId: "rsi-reversion",
      symbols: ["MNQ"],
      params: rsiParams,
      fillModel: "nextOpen",
      locks: SYMBOL_RISK.MNQ.locks, // dailyLoss 202 — item 2.3
      maxRisk: SYMBOL_RISK.MNQ.maxRisk,
    },
  ];
  // Apply human-merged challenger overrides (empty by default → live params).
  const withOverrides = base.map((s) => {
    const ov = CHALLENGER_OVERRIDES[streamOverrideKey(s.tier, s.symbols)];
    return ov ? { ...s, params: { ...s.params, ...ov } as ParamValues } : s;
  });
  // Append human-merged shadow promotions as tier-B2 streams (same B locks).
  const promoted: TierStream[] = PROMOTED_SHADOWS.map((p) => ({
    tier: "B",
    label: p.label,
    strategyId: p.strategyId,
    symbols: p.symbols,
    params: defaultParams(strategyById(p.strategyId)),
    fillModel: "nextOpen",
    locks: B_LOCKS,
  }));
  return [...withOverrides, ...promoted];
}
