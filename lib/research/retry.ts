/* Retry with exponential backoff, for TRANSIENT connection failures only.
   ─────────────────────────────────────────────────────────────────────────
   Why this exists: the first weekly auto-benchmark (2026-10-04, GitHub run
   37184108060) measured MES for eleven minutes of synchronous CPU work, then
   failed on the very next database read:

     bars_5m read for MNQ (databento): Connection terminated unexpectedly

   Eleven minutes with the event loop blocked is long enough for Neon to drop an
   idle pooled connection (compute auto-suspend, pooler recycling), and the pool
   cannot notice until it next hands that connection out. The read itself was
   fine; the connection it was given was dead. A fresh connection two seconds
   later would have worked.

   What is retried, deliberately narrowly: lost or refused connections, socket
   resets and timeouts, and the server-side "connection is going away" codes.
   Everything else — a missing table, a write-once trigger refusing an edit, an
   empty archive, a bug — is thrown on the first attempt. Retrying a real
   failure only delays it, and retrying a refused WRITE can hide the refusal.

   Only wrap work that is safe to repeat: reads, and writes that are idempotent
   (ON CONFLICT DO NOTHING, or an UPDATE guarded by `outcome IS NULL`). */

/** Node socket errnos that mean "the network or the peer went away". */
const TRANSIENT_ERRNOS = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENETDOWN",
]);

/* PostgreSQL SQLSTATEs: class 08 is "connection exception"; 57P01-57P03 are
   the server shutting a connection or not accepting one yet; 53300 is too many
   connections, which a pooled serverless database clears within seconds. */
const TRANSIENT_SQLSTATES = new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03", "53300"]);

/* Messages, for errors that lost their code on the way up. lib/data/archive.ts
   rethrows a read error as `new Error(message)`, so by the time the caller sees
   "Connection terminated unexpectedly" the only evidence left is the text. */
const TRANSIENT_MESSAGES: RegExp[] = [
  /connection terminated/i, // pg: "unexpectedly", "due to connection timeout"
  /timeout exceeded when trying to connect/i, // pg-pool
  /connection error and is not queryable/i, // pg client after a socket error
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i, // 57P01
  /the database system is (starting up|shutting down)/i, // 57P03
  /couldn'?t connect to compute node/i, // Neon proxy while compute wakes
  /socket hang up/i,
  /connection (reset|refused|ended unexpectedly)/i,
  /\b(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b/,
];

/** True when the error is a lost/refused connection that a fresh connection
    can be expected to cure. Walks `cause` so wrapped errors are judged by
    their origin. */
export function isTransientConnectionError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (typeof e === "object") {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string" && (TRANSIENT_ERRNOS.has(code) || TRANSIENT_SQLSTATES.has(code))) return true;
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && TRANSIENT_MESSAGES.some((re) => re.test(message))) return true;
      e = (e as { cause?: unknown }).cause;
    } else if (typeof e === "string") {
      return TRANSIENT_MESSAGES.some((re) => re.test(e as string));
    } else break;
  }
  return false;
}

export interface RetryOptions {
  /** Retries AFTER the first attempt. Default 3, so 4 attempts in all. */
  retries?: number;
  /** First backoff; doubles each time. Default 2000 → 2s, 4s, 8s. */
  baseDelayMs?: number;
  /** Which errors are worth another attempt. Default: transient connection errors. */
  isRetryable?: (error: unknown) => boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Where retry notices go. Default console.warn. */
  log?: (line: string) => void;
}

/** Backoff schedule for `retries` retries starting at `baseDelayMs`: 2s, 4s, 8s by default. */
export function backoffDelays(retries = 3, baseDelayMs = 2000): number[] {
  return Array.from({ length: Math.max(0, retries) }, (_, i) => baseDelayMs * 2 ** i);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `work`; on a retryable error waits and runs it again, up to `retries`
    more times. A non-retryable error, or the last failure, is rethrown with
    the attempt count in its message (the original stays on `cause`). */
export async function withRetry<T>(label: string, work: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = backoffDelays(options.retries ?? 3, options.baseDelayMs ?? 2000);
  const retryable = options.isRetryable ?? isTransientConnectionError;
  const sleep = options.sleep ?? realSleep;
  const log = options.log ?? ((line: string) => console.warn(line));
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!retryable(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= delays.length)
        throw new Error(`${label}: still failing after ${attempt + 1} attempts — ${message}`, { cause: error });
      log(`${label}: transient connection error (${message}); retry ${attempt + 1} of ${delays.length} in ${delays[attempt] / 1000}s`);
      await sleep(delays[attempt]);
    }
  }
}
