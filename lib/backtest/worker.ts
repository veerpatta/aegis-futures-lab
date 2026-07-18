/* Web Worker entry: runs backtests off the main thread. Must stay DOM-free —
   it may only import from lib/. */
import { executeRun, type RunRequest, type WorkerMessage } from "./run";

self.onmessage = (e: MessageEvent<{ id: number; req: RunRequest }>) => {
  const { id, req } = e.data;
  try {
    const result = executeRun(req);
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies WorkerMessage);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerMessage);
  }
};
