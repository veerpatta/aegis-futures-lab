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
    newsTimes: req.newsTimes,
    window: req.window,
    pointValueOf: (symbol) => req.pointValues[symbol] ?? 1,
    keepOpenAtEnd: req.keepOpenAtEnd,
    collectEvents: req.collectEvents,
  });
}
