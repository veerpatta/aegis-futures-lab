/* The one backtest simulator. Replaces the three duplicated walkers of the
   legacy app (outcomes portfolio study, paper agent, CSV backtest); the
   canonical fill/lock semantics are those of legacy/outcomes.js:
   - signals act on the completed bar, fills happen at the NEXT bar's open
     ± slippage, same NY session only
   - stop-first same-bar resolution, exits at exact stop/target price
   - session flat by NY 15:25, discipline locks reset on date rollover
   - quantity and dollar target are re-derived from the actual fill price */

import { slippagePointsAt } from "@/lib/costs/slippage";
import type { Bar, EquityPoint, Trade } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";
import { atr } from "@/lib/indicators";
import { metricsFromTrades, scoreBuckets, EXCURSION_ATR_LEN, type RunMetrics } from "./metrics";
import type {
  EntrySignal,
  ExecutionConfig,
  OpenPosition,
  ParamValues,
  Snapshot,
  Strategy,
} from "@/lib/strategies/types";

export interface DisciplineLocks {
  dailyLoss: number;
  maxTrades: number;
  maxLosses: number;
  maxDrawdown: number;
}

export interface BacktestInput {
  series: Record<string, Bar[]>; // 5m bars per symbol (1+ symbols)
  strategy: Strategy<unknown>;
  params: ParamValues;
  execution: ExecutionConfig;
  locks: DisciplineLocks | null;
  startingCapital: number;
  sessionExitMinute: number; // NY minutes; 925 = flat by 15:25
  /* Per-day override of sessionExitMinute (NY dateKey → minutes), for CME
     early-close days. Bookkeeping/configuration only: absent → legacy
     behavior, and no strategy ever reads it. */
  sessionExitMinuteByDay?: Record<string, number>;
  newsTimes?: number[]; // unix seconds of high-impact events (±30 min lock)
  window?: { fromTime?: number; toTime?: number };
  pointValueOf: (symbol: string) => number;
  /* Forward-test mode: keep a position open at the window end (reported in
     the result) instead of force-closing it. */
  keepOpenAtEnd?: boolean;
  /* Collect every skip note as a timestamped event (replay timeline). Off by
     default — a 60-day two-symbol run emits ~100k events. */
  collectEvents?: boolean;
}

/* One skip note with its bar time and NY date, for the replay timeline. */
export interface SkipEvent {
  time: number;
  date: string; // NY dateKey
  reason: string;
  symbol?: string;
}

export interface BacktestResult {
  trades: Trade[];
  equityPoints: EquityPoint[];
  metrics: RunMetrics;
  byInstrument: Record<string, RunMetrics>;
  buckets: Record<string, RunMetrics> | null;
  skipReasons: Record<string, number>;
  skipReasonsByDay: Record<string, Record<string, number>>; // NY dateKey → funnel
  events?: SkipEvent[]; // only with collectEvents
  sessions: number;
  window: { from: number; to: number };
  openPosition: OpenPosition | null; // only with keepOpenAtEnd
}

interface PendingEntry {
  signal: EntrySignal;
  executeTime: number;
  date: string;
}

const NEWS_LOCK_SEC = 30 * 60;

export function runBacktest(input: BacktestInput): BacktestResult {
  const {
    series,
    strategy,
    params,
    execution,
    locks,
    startingCapital,
    sessionExitMinute,
    newsTimes = [],
    pointValueOf,
  } = input;

  const symbols = Object.keys(series).filter((s) => series[s]?.length);
  if (!symbols.length) throw new Error("No bars to backtest");

  // Session flatten minute for a bar's NY day — normal exit unless an
  // early-close override is configured for that date.
  const pastSessionExit = (time: number) => {
    const m = nyMeta(time);
    return m.minutes >= (input.sessionExitMinuteByDay?.[m.dateKey] ?? sessionExitMinute);
  };

  const lastTimes = symbols.map((s) => series[s][series[s].length - 1].time);
  const toTime = Math.min(input.window?.toTime ?? Infinity, Math.min(...lastTimes));
  const firstTimes = symbols.map((s) => series[s][0].time);
  const fromTime = Math.max(input.window?.fromTime ?? -Infinity, Math.min(...firstTimes));

  // prepare() sees the FULL series (structure formed before the window stays
  // visible, matching the legacy study); the walk itself is window-cut.
  const ctx = strategy.prepare(series, params, execution);

  const indexOf: Record<string, Map<number, number>> = {};
  for (const s of symbols) {
    const m = new Map<number, number>();
    series[s].forEach((b, i) => m.set(b.time, i));
    indexOf[s] = m;
  }

  /* ATR(14) per symbol, computed once and read only when a trade opens, to
     stamp atrAtEntry. Bookkeeping: nothing branches on it. Lazy so a run that
     never opens a trade does not pay for it. */
  const atrCache: Record<string, (number | null)[]> = {};
  const atrAt = (symbol: string, time: number): number | undefined => {
    const idx = indexOf[symbol]?.get(time);
    if (idx === undefined) return undefined;
    const series14 = (atrCache[symbol] ??= atr(series[symbol], EXCURSION_ATR_LEN));
    const v = series14[idx];
    return v === null || v === undefined || !(v > 0) ? undefined : v;
  };
  const times = [
    ...new Set(
      symbols.flatMap((s) =>
        series[s].filter((b) => b.time >= fromTime && b.time <= toTime).map((b) => b.time)
      )
    ),
  ].sort((a, b) => a - b);

  const skipReasons: Record<string, number> = {};
  const skipReasonsByDay: Record<string, Record<string, number>> = {};
  const events: SkipEvent[] = [];
  const collectEvents = input.collectEvents === true;
  // cursorTime/currentDate are set at the top of the walk loop before any
  // note() can fire; bookkeeping only — trades/equity are untouched (parity).
  let cursorTime = 0;
  const note = (reason: string, symbol?: string) => {
    skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    if (currentDate) {
      const day = (skipReasonsByDay[currentDate] ??= {});
      day[reason] = (day[reason] || 0) + 1;
      if (collectEvents) events.push({ time: cursorTime, date: currentDate, reason, symbol });
    }
  };

  const trades: Trade[] = [];
  const equityPoints: EquityPoint[] = [{ time: fromTime, equity: startingCapital }];
  const sessions = new Set<string>();

  let position: OpenPosition | null = null;
  let pending: PendingEntry | null = null;
  let equity = startingCapital;
  let peak = startingCapital;
  let maxDrawdownSoFar = 0;
  let dailyPnl = 0;
  let dailyTrades = 0;
  let consecutiveLosses = 0;
  let currentDate: string | null = null;
  let tradeId = 0;

  /* Fold one bar's range into the open position's running excursion. Pure
     bookkeeping: reads b.high/b.low, writes only maePoints/mfePoints, which
     nothing else in this file or any strategy ever reads. It therefore cannot
     alter a fill, an exit or the trade list — the same category as the
     skipReasons counters above, and the parity tests prove it.

     Both are non-negative points from entry: MAE is the worst adverse move,
     MFE the best favourable one, direction-corrected per side. */
  const foldExcursion = (p: OpenPosition, bar: Bar) => {
    const adverse = p.side === "LONG" ? p.entry - bar.low : bar.high - p.entry;
    const favourable = p.side === "LONG" ? bar.high - p.entry : p.entry - bar.low;
    // Stamp the bar that SET each extreme, so time-to-MAE/MFE separates "died
    // immediately" from "worked, then gave it all back". Equivalent to the
    // previous Math.max form for the points themselves.
    if (adverse > (p.maePoints ?? 0)) {
      p.maePoints = adverse;
      p.maeTime = bar.time;
    } else p.maePoints ??= 0;
    if (favourable > (p.mfePoints ?? 0)) {
      p.mfePoints = favourable;
      p.mfeTime = bar.time;
    } else p.mfePoints ??= 0;
  };

  /* Slippage in points for one fill. With no FrictionSpec this is the flat
     `execution.slippage` scalar the engine has always used — the legacy path
     the zone-v5 parity oracle pins. With one, it is symbol-aware and
     time-aware (wider in the opening and closing 30 minutes). */
  const slipAt = (symbol: string, timeSec: number): number =>
    execution.friction ? slippagePointsAt(execution.friction, symbol, timeSec) : execution.slippage;

  /* Exit slippage, charged only when the model says both sides are slipped.
     LEGACY_MODEL is entryOnly, so this is 0 and closeTrade behaves exactly as
     before. It always moves the fill AGAINST the position. */
  const exitSlip = (symbol: string, timeSec: number): number =>
    execution.friction?.slipExits ? slippagePointsAt(execution.friction, symbol, timeSec) : 0;

  const closeTrade = (bar: Bar, reason: Trade["exitReason"], exit: number) => {
    const p = position!;
    // The exit bar counts too — a trade that spiked before stopping out on the
    // same bar really did have that excursion.
    foldExcursion(p, bar);
    const point = pointValueOf(p.symbol);
    /* The exit fill, slipped against the position when the friction model
       charges both sides. Applied here rather than at each call site so every
       exit reason (stop, target, signal, session, windowEnd, same-bar sweep)
       inherits it and none can be forgotten. */
    const slip = exitSlip(p.symbol, bar.time);
    const filled = slip === 0 ? exit : p.side === "LONG" ? exit - slip : exit + slip;
    const points = p.side === "LONG" ? filled - p.entry : p.entry - filled;
    const pnl = points * point * p.qty - execution.cost * p.qty;
    trades.push({
      id: ++tradeId,
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      entryTime: p.openedAt,
      entryPrice: p.entry,
      exitTime: bar.time,
      exitPrice: filled,
      stop: p.stop,
      target: p.target,
      exitReason: reason,
      points,
      pnl,
      rMultiple: p.risk ? pnl / p.risk : 0,
      score: p.score,
      tags: p.tags,
      maePoints: p.maePoints ?? 0,
      mfePoints: p.mfePoints ?? 0,
      maeTime: p.maeTime,
      mfeTime: p.mfeTime,
      initialStop: p.initialStop,
      atrAtEntry: p.atrAtEntry,
    });
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdownSoFar = Math.max(maxDrawdownSoFar, peak - equity);
    dailyPnl += pnl;
    dailyTrades++;
    consecutiveLosses = pnl < 0 ? consecutiveLosses + 1 : 0;
    equityPoints.push({ time: bar.time, equity });
    position = null;
  };

  const newsLocked = (time: number) => newsTimes.some((t) => Math.abs(t - time) <= NEWS_LOCK_SEC);

  /* Derive qty/target from the actual fill and build the position.
     Returns null (with a riskUnfit note) when sizing yields no contracts. */
  const tryOpen = (sig: EntrySignal, bar: Bar, entry: number): OpenPosition | null => {
    const point = pointValueOf(sig.symbol);
    const stopDistance = Math.abs(entry - sig.stop);
    /* Refuse a stop too tight to be a real trade. Off by default (0), so the
       parity oracle is untouched; the live streams opt in via tiers.ts. The
       check is on the ACTUAL fill, not the signal's intended entry, because a
       limit fill plus slippage is what determines the distance the position
       really has. */
    if (execution.minStopPoints && stopDistance < execution.minStopPoints) {
      note("stopTooTight", sig.symbol);
      return null;
    }
    /* One exit's slippage folded into the per-contract risk when the model
       charges both sides, so size reflects what the round trip actually costs
       rather than only what the entry did. Absent under LEGACY_MODEL. */
    const exitSlipPts = execution.friction?.sizeWithExitSlippage
      ? slippagePointsAt(execution.friction, sig.symbol, bar.time)
      : 0;
    const perContract = (stopDistance + exitSlipPts) * point + execution.cost;
    const qty =
      execution.sizing === "fixed"
        ? Math.max(1, Math.floor(execution.fixedQty ?? 1))
        : perContract > 0
          ? Math.floor(execution.maxRisk / perContract)
          : 0;
    if (qty <= 0) {
      note("riskUnfit", sig.symbol);
      return null;
    }
    let target: number | null = null;
    const spec = sig.target;
    if (spec.kind === "price") target = spec.price;
    else if (spec.kind === "rMultiple")
      target =
        sig.side === "LONG"
          ? entry + spec.r * Math.abs(entry - sig.stop)
          : entry - spec.r * Math.abs(entry - sig.stop);
    else if (spec.kind === "netDollar") {
      const targetPoints = (spec.amount + execution.cost * qty) / (point * qty);
      target = sig.side === "LONG" ? entry + targetPoints : entry - targetPoints;
    }
    return {
      symbol: sig.symbol,
      side: sig.side,
      qty,
      entry,
      stop: sig.stop,
      target,
      risk: perContract * qty,
      openedAt: bar.time,
      score: sig.score,
      tags: sig.tags,
      // Captured at entry because both are destroyed later: `stop` is mutated
      // by adjustStop, and ATR at the entry bar is not recoverable from the
      // trade row alone.
      initialStop: sig.stop,
      atrAtEntry: atrAt(sig.symbol, bar.time),
    };
  };

  const limitFills = execution.fillModel === "limit";

  for (const time of times) {
    const visible: Record<string, { idx: number; bar: Bar }> = {};
    for (const s of symbols) {
      const idx = indexOf[s].get(time);
      if (idx !== undefined) visible[s] = { idx, bar: series[s][idx] };
    }
    const any = Object.values(visible)[0];
    if (!any) continue;
    cursorTime = time;
    const date = nyMeta(any.bar.time).dateKey;
    sessions.add(date);
    if (currentDate !== date) {
      currentDate = date;
      dailyPnl = 0;
      dailyTrades = 0;
      consecutiveLosses = 0;
    }

    const snapshot: Snapshot = {
      time,
      bySymbol: Object.fromEntries(
        Object.entries(visible).map(([s, v]) => [s, { bars: series[s], index: v.idx }])
      ),
    };

    // 1) Manage the open position on its own symbol's bar.
    if (position) {
      const v = visible[position.symbol];
      if (v && v.bar.time >= position.openedAt) {
        const b = v.bar;
        const p = position;
        // Before adjustStop, so a trailing stop can never retroactively hide
        // the excursion that triggered it.
        foldExcursion(p, b);
        if (strategy.adjustStop) {
          const ns = strategy.adjustStop(ctx, snapshot, p, params);
          // tighten-only: breakeven/trailing may never widen the risk
          if (ns != null && (p.side === "LONG" ? ns > p.stop : ns < p.stop)) p.stop = ns;
        }
        const stopHit = p.side === "LONG" ? b.low <= p.stop : b.high >= p.stop;
        const targetHit =
          p.target !== null && (p.side === "LONG" ? b.high >= p.target : b.low <= p.target);
        if (stopHit) {
          /* A bar that OPENED beyond the stop never traded at the stop price:
             the first available fill was the open. Legacy fills at the exact
             stop regardless, which quietly hands back every gap. Only active
             under a friction model that asks for it (REALISTIC_MODEL);
             LEGACY_MODEL leaves this false and the parity oracle unmoved. */
          const gapped =
            execution.friction?.gapThroughStops === true &&
            (p.side === "LONG" ? b.open < p.stop : b.open > p.stop);
          closeTrade(b, "stop", gapped ? b.open : p.stop);
        }
        else if (targetHit) closeTrade(b, "target", p.target as number);
        else if (
          strategy.shouldExit &&
          strategy.shouldExit(ctx, snapshot, p, params)
        )
          closeTrade(b, "signal", b.close);
        else if (pastSessionExit(b.time)) closeTrade(b, "session", b.close);
      }
    }

    // 2) Execute a pending next-open fill.
    if (!position && pending && time >= pending.executeTime) {
      const plan = pending;
      pending = null;
      const v = visible[plan.signal.symbol];
      if (v && nyMeta(v.bar.time).dateKey === plan.date) {
        const sig = plan.signal;
        const entry =
          sig.side === "LONG"
            ? v.bar.open + slipAt(sig.symbol, v.bar.time)
            : v.bar.open - slipAt(sig.symbol, v.bar.time);
        position = tryOpen(sig, v.bar, entry);
        // The manage block above already ran for this bar while the position
        // was still null, so the fill bar's own range would otherwise never be
        // folded and every next-open trade would under-report by one bar.
        if (position) foldExcursion(position, v.bar);
      }
    }
    if (position || pending) continue;

    // 3) Seek a new entry on the completed bar.
    const signals = strategy.onSnapshot(ctx, snapshot, params, note);
    if (!signals.length) continue;
    if (newsLocked(time)) {
      signals.forEach((s) => note("news", s.symbol));
      continue;
    }
    if (locks) {
      const locked =
        dailyPnl <= -locks.dailyLoss ||
        dailyTrades >= locks.maxTrades ||
        consecutiveLosses >= locks.maxLosses ||
        maxDrawdownSoFar >= locks.maxDrawdown;
      if (locked) {
        signals.forEach((s) => note("lock", s.symbol));
        continue;
      }
    }
    const viable = signals.filter((sig) => {
      const v = visible[sig.symbol];
      if (!v) return false;
      if (limitFills && sig.limit != null) {
        // Limit fill happens on THIS bar; it only needs to sit before the
        // flatten minute so the trade can still be managed intraday.
        if (pastSessionExit(v.bar.time)) {
          note("lock", sig.symbol);
          return false;
        }
        return true;
      }
      const next = series[sig.symbol][v.idx + 1];
      // The fill bar must exist, sit in the same NY session and BEFORE the
      // flatten minute — a fill on the session-exit bar could never be
      // flattened intraday and would carry overnight.
      if (
        !next ||
        nyMeta(next.time).dateKey !== date ||
        next.time > toTime ||
        pastSessionExit(next.time)
      ) {
        note("lock", sig.symbol); // no executable next bar in this session/window
        return false;
      }
      return true;
    });
    if (!viable.length) continue;
    viable.forEach((s) => note("qualified", s.symbol));
    const best = viable
      .map((sig, i) => ({ sig, i }))
      .sort(
        (a, b) =>
          (b.sig.rank ?? 0) - (a.sig.rank ?? 0) ||
          (b.sig.score ?? 0) - (a.sig.score ?? 0) ||
          a.i - b.i
      )[0].sig;
    if (limitFills && best.limit != null) {
      // The order was resting at the limit before price arrived, so it fills
      // on the touch bar itself: at the limit (or at the open, if the bar
      // already opened through it), plus modelled slippage. This mirrors the
      // live plan (entry at the zone proximal) instead of chasing the next
      // bar's open after the bounce.
      const b = visible[best.symbol].bar;
      const lim = best.limit;
      const touched = best.side === "LONG" ? b.low <= lim : b.high >= lim;
      if (touched) {
        const entry =
          best.side === "LONG"
            ? Math.min(b.open, lim) + slipAt(best.symbol, b.time)
            : Math.max(b.open, lim) - slipAt(best.symbol, b.time);
        // Fill sanity: when the bar opens through the zone AND its stop, the
        // "fill at open, swept same bar" convention would exit at the stop on
        // the PROFIT side of the entry — a free-money artifact, not a trade.
        // A real resting order that far through structure is a cancel.
        if (best.side === "LONG" ? entry <= best.stop : entry >= best.stop) {
          note("invalidFill", best.symbol);
          continue;
        }
        const opened = tryOpen(best, b, entry);
        if (opened) {
          position = opened;
          // The fill bar is the trade's first bar, and for a same-bar sweep it
          // is also its only one — without this those trades report zero
          // excursion, which is the one case where it is provably wrong.
          foldExcursion(opened, b);
          // Conservative same-bar resolution: if the touch bar also swept the
          // stop we cannot know the intra-bar order — count it as a stop-out
          // (consistent with the engine's stop-first convention). The target
          // is never granted on the fill bar.
          const swept = opened.side === "LONG" ? b.low <= opened.stop : b.high >= opened.stop;
          if (swept) closeTrade(b, "stop", opened.stop);
        }
      }
      continue;
    }
    pending = {
      signal: best,
      executeTime: series[best.symbol][visible[best.symbol].idx + 1].time,
      date,
    };
  }

  // Force-close at the window end.
  if (position && !input.keepOpenAtEnd) {
    const p: OpenPosition = position;
    const exec = series[p.symbol];
    for (let i = exec.length - 1; i >= 0; i--) {
      if (exec[i].time <= toTime) {
        closeTrade(exec[i], "windowEnd", exec[i].close);
        break;
      }
    }
  }
  equityPoints.push({ time: toTime, equity });

  const byInstrument: Record<string, RunMetrics> = {};
  if (symbols.length > 1)
    for (const s of symbols)
      byInstrument[s] = metricsFromTrades(
        trades.filter((t) => t.symbol === s),
        startingCapital
      );
  const hasScores = trades.some((t) => t.score != null);

  return {
    trades,
    equityPoints,
    metrics: metricsFromTrades(trades, startingCapital),
    byInstrument,
    buckets: hasScores ? scoreBuckets(trades, startingCapital) : null,
    skipReasons,
    skipReasonsByDay,
    events: collectEvents ? events : undefined,
    sessions: sessions.size,
    window: { from: fromTime, to: toTime },
    openPosition: position,
  };
}
