/* A dependency-free Postgres query over Neon's SQL-over-HTTP endpoint.

   The engine clock (functions/aegisclock) must stay a few kilobytes so it can
   be deployed without a build pipeline, so it cannot bundle a Postgres driver.
   This is the same request the official @neondatabase/serverless driver makes
   in HTTP mode: POST https://api.<region host>/sql with the connection string
   in the `Neon-Connection-String` header. Rows come back as arrays of text.
   One statement per call; no transactions are needed by its callers. */

export type SqlRow = (string | null)[];
export type SqlFn = (query: string, params?: unknown[]) => Promise<SqlRow[]>;

/** api.<region host> — the driver replaces the first host label (the endpoint id). */
export function sqlEndpoint(connectionString: string): string {
  const host = new URL(connectionString).hostname;
  if (!host.includes(".")) throw new Error("The database host is not a Neon host.");
  return `https://${host.replace(/^[^.]+\./, "api.")}/sql`;
}

export function neonSql(connectionString: string, transport: typeof fetch = fetch, timeoutMs = 10_000): SqlFn {
  const endpoint = sqlEndpoint(connectionString);
  return async (query, params = []) => {
    const res = await transport(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Neon-Connection-String": connectionString,
        "Neon-Raw-Text-Output": "true",
        "Neon-Array-Mode": "true",
      },
      body: JSON.stringify({ query, params: params.map((p) => (p === undefined ? null : p)) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Never echo the connection string; the status and the server's own message are enough.
      let detail = "";
      try { detail = String(((await res.json()) as { message?: string }).message ?? "").slice(0, 160); } catch { /* not JSON */ }
      throw new Error(`database HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const body = (await res.json()) as { rows?: SqlRow[] };
    return Array.isArray(body.rows) ? body.rows : [];
  };
}
