/* The one backtest simulator. Replaces the three duplicated walkers of the
   legacy app (outcomes portfolio study, paper agent, CSV backtest); the
   canonical fill/lock semantics are those of legacy/outcomes.js:
   - signals act on the completed bar, fills happen at the NEXT bar's open
     ± slippage, same NY session only
   - stop-first same-bar resolution, exits at exact stop/target price
   - session flat by NY 15:25, discipline locks reset on date rollover
   - quantity and dollar target are re-derived from the actual fill price */

import type { Bar, EquityPoint, Trade } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";
import { metricsFromTrades, scoreBuckets, type RunMetrics } from "./metrics";
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

  const closeTrade = (bar: Bar, reason: Trade["exitReason"], exit: number) => {
    const p = position!;
    const point = pointValueOf(p.symbol);
    const points = p.side === "LONG" ? exit - p.entry : p.entry - exit;
    const pnl = points * point * p.qty - execution.cost * p.qty;
    trades.push({
      id: ++tradeId,
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      entryTime: p.openedAt,
      entryPrice: p.entry,
      exitTime: bar.time,
      exitPrice: exit,
      stop: p.stop,
      target: p.target,
      exitReason: reason,
      points,
      pnl,
      rMultiple: p.risk ? pnl / p.risk : 0,
      score: p.score,
      tags: p.tags,
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
    const perContract = Math.abs(entry - sig.stop) * point + execution.cost;
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
        if (strategy.adjustStop) {
          const ns = strategy.adjustStop(ctx, snapshot, p, params);
          // tighten-only: breakeven/trailing may never widen the risk
          if (ns != null && (p.side === "LONG" ? ns > p.stop : ns < p.stop)) p.stop = ns;
        }
        const stopHit = p.side === "LONG" ? b.low <= p.stop : b.high >= p.stop;
        const targetHit =
          p.target !== null && (p.side === "LONG" ? b.high >= p.target : b.low <= p.target);
        if (stopHit) closeTrade(b, "stop", p.stop);
        else if (targetHit) closeTrade(b, "target", p.target as number);
        else if (
          strategy.shouldExit &&
          strategy.shouldExit(ctx, snapshot, p, params)
        )
          closeTrade(b, "signal", b.close);
        else if (nyMeta(b.time).minutes >= sessionExitMinute) closeTrade(b, "session", b.close);
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
          sig.side === "LONG" ? v.bar.open + execution.slippage : v.bar.open - execution.slippage;
        position = tryOpen(sig, v.bar, entry);
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
        if (nyMeta(v.bar.time).minutes >= sessionExitMinute) {
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
        nyMeta(next.time).minutes >= sessionExitMinute
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
            ? Math.min(b.open, lim) + execution.slippage
            : Math.max(b.open, lim) - execution.slippage;
        const opened = tryOpen(best, b, entry);
        if (opened) {
          position = opened;
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
