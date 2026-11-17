/* One place that hands out pg Pools, safe on both hosts.

   On Vercel (Node) a Pool lives for the life of the server instance, as before:
   the first call for a name builds it and later calls reuse it.

   On Cloudflare Workers that is not allowed. A socket opened while serving one
   request cannot be used by another ("Cannot perform I/O on behalf of a
   different request"), so a module-level Pool breaks from the second request
   on. There each request gets its own Pools, keyed off the per-request context
   object OpenNext keeps in AsyncLocalStorage (the object behind
   getCloudflareContext()). It is read through its global symbol rather than by
   importing @opennextjs/cloudflare, so the Vercel build does not depend on it.
   When the request ends that object, its Pools and their sockets are dropped;
   a short idle timeout closes connections that finish early. */

import { Pool, type PoolConfig } from "pg";

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");
/** Idle connections on Workers close quickly: they cannot outlive the request. */
const WORKER_IDLE_MS = 1_000;

const longLived = new Map<string, Pool>();
const perRequest = new WeakMap<object, Map<string, Pool>>();

function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function build(config: PoolConfig, workers: boolean): Pool {
  const pool = new Pool(workers
    ? { ...config, idleTimeoutMillis: Math.min(config.idleTimeoutMillis ?? WORKER_IDLE_MS, WORKER_IDLE_MS) }
    : config);
  // An idle client dropped by the server (Neon scale-to-zero, or a Worker
  // request ending) must not crash the process; the next query reconnects.
  if (typeof pool.on === "function") pool.on("error", () => {});
  return pool;
}

/** The Pool for `name`: long-lived on Node, one per request on Workers.
    `config` is only called when a Pool has to be built. */
export function dbPool(name: string, config: () => PoolConfig): Pool {
  if (!onWorkers()) {
    let pool = longLived.get(name);
    if (!pool) longLived.set(name, (pool = build(config(), false)));
    return pool;
  }
  const context = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT];
  // Outside a request context there is nothing safe to share: a fresh Pool.
  if (!context || typeof context !== "object") return build(config(), true);
  let pools = perRequest.get(context);
  if (!pools) perRequest.set(context, (pools = new Map()));
  let pool = pools.get(name);
  if (!pool) pools.set(name, (pool = build(config(), true)));
  return pool;
}
