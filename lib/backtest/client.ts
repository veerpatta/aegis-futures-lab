"use client";

import { executeRun, type RunRequest, type WorkerMessage } from "./run";
import type { BacktestResult } from "./engine";

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pendingRuns = new Map<
  number,
  { resolve: (r: BacktestResult) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url));
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data;
        const p = pendingRuns.get(msg.id);
        if (!p) return;
        pendingRuns.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      };
      worker.onerror = () => {
        // Bundling/runtime failure — fail the in-flight runs over to sync mode.
        workerBroken = true;
        const stale = [...pendingRuns.values()];
        pendingRuns.clear();
        worker?.terminate();
        worker = null;
        stale.forEach((p) => p.reject(new Error("worker-failed")));
      };
    } catch {
      workerBroken = true;
      worker = null;
    }
  }
  return worker;
}

export async function runBacktestAsync(req: RunRequest): Promise<BacktestResult> {
  const w = getWorker();
  if (w) {
    const id = nextId++;
    try {
      return await new Promise<BacktestResult>((resolve, reject) => {
        pendingRuns.set(id, { resolve, reject });
        w.postMessage({ id, req });
      });
    } catch (error) {
      if (!(error instanceof Error && error.message === "worker-failed")) throw error;
      // fall through to the synchronous path
    }
  }
  return executeRun(req);
}
