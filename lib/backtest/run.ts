import type { Bar } from "@/lib/types";
import type { ExecutionConfig, ParamValues } from "@/lib/strategies/types";
import { runBacktest, type DisciplineLocks, type BacktestResult } from "./engine";
import { strategyById } from "@/lib/strategies/registry";

/* Structured-clone-safe run request shared by the worker and the sync path.
   Strategies are referenced by id (functions cannot cross the worker
   boundary); point values travel as a plain map. */
export interface RunRequest {
  strategyId: string;
  params: ParamValues;
  series: Record<string, Bar[]>;
  execution: ExecutionConfig;
  locks: DisciplineLocks | null;
  startingCapital: number;
  sessionExitMinute: number;
  sessionAnchorMin?: number;
  sessionExitMinuteByDay?: Record<string, number>;
  newsTimes?: number[];
  window?: { fromTime?: number; toTime?: number };
  pointValues: Record<string, number>;
  keepOpenAtEnd?: boolean;
  collectEvents?: boolean;
}

export type WorkerMessage =
  | { id: number; ok: true; result: BacktestResult }
  | { id: number; ok: false; error: string };

export function executeRun(req: RunRequest): BacktestResult {
  return runBacktest({
    series: req.series,
    strategy: strategyById(req.strategyId),
    params: req.params,
    execution: req.execution,
    locks: req.locks,
    startingCapital: req.startingCapital,
    sessionExitMinute: req.sessionExitMinute,
    sessionAnchorMin: req.sessionAnchorMin,
    sessionExitMinuteByDay: req.sessionExitMinuteByDay,
    newsTimes: req.newsTimes,
    window: req.window,
    /* Throws rather than defaulting. `?? 1` priced an unmapped symbol at a
       DOLLAR A POINT: for MGC that is a 10x understatement of every gain and
       loss, for SI a 500x one — internally consistent, passing every finite
       check, warning nobody. A missing point value is a config bug, and the
       cheapest moment to say so is before the first fill. */
    pointValueOf: (symbol) => {
      const v = req.pointValues[symbol];
      if (v === undefined)
        throw new Error(
          `Unpriced symbol "${symbol}" — pointValues has no entry, and defaulting ` +
            `to $1/point would understate every figure without erroring.`
        );
      return v;
    },
    keepOpenAtEnd: req.keepOpenAtEnd,
    collectEvents: req.collectEvents,
  });
}
