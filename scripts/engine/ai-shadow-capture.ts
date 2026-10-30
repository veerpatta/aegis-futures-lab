/** Best-effort source capture for a separate AI shadow study.
 * Call only after a successful source pass has written its signals, and use a
 * dedicated pg client: this function manages its own transaction. It never
 * updates a signal, account or existing learner table and never calls OpenAI.
 */
import { captureShadowIdea, SHADOW_MAX_DATA_AGE_SECONDS, type ShadowSourceIdea } from "@/lib/ai-shadow/study";

export interface ShadowCaptureSignal {
  dedupe_key: string; tier: "A" | "B"; symbol: string; direction: string; signal_ts: string;
  entry_price: number; stop_price: number; target_price: number | null; score: number | null; rr: number | null;
  status: string; suppressed: boolean; stale_data: boolean; orphaned: boolean;
  exit_ts?: string | null; exit_price?: number | null; pnl_usd?: number | null;
}

export interface ShadowCaptureOptions {
  study: { id: string; registeredAt: string };
  signals: readonly ShadowCaptureSignal[];
  /** Time of the most recently received complete market bar, in epoch seconds. */
  marketAsOf: Record<string, number | null>;
  sourceCodeSha: string | null;
  /** Clock injection for tests; omit in production to use actual receipt time. */
  now?: () => number;
}

export interface CaptureClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}
export type ShadowCapturePass = { ok: true; inserted: number; rejected: number; duplicates: number } |
  { ok: false; inserted: 0; rejected: 0; duplicates: 0; error: string };

/** Collection requires both an explicit enable and an exact study ID. */
export function configuredShadowStudyId(enabled: string | undefined, id: string | undefined): string | null {
  const selected = id?.trim();
  return enabled === "true" && selected ? selected : null;
}

/** Archive fallback does not prove the direct feed's actual receipt or freshness. */
export function shadowMarketAsOf(lastBarStart: number | null | undefined, fromArchive: boolean): number | null {
  return !fromArchive && typeof lastBarStart === "number" && Number.isFinite(lastBarStart) ? lastBarStart + 300 : null;
}

/** The database's study/key uniqueness preserves the first observed receipt,
 * including a first rejection. Subsequent replays can never convert it into
 * fresh prospective evidence. Writes are all-or-nothing on a dedicated client;
 * returning a failure rather than throwing keeps the source engine independent. */
export async function captureAiShadowPass(client: CaptureClient, options: ShadowCaptureOptions): Promise<ShadowCapturePass> {
  let began = false;
  try {
    const observedMs = (options.now ?? Date.now)();
    const registeredMs = Date.parse(options.study.registeredAt);
    if (!options.study.id || !Number.isFinite(observedMs) || !Number.isFinite(registeredMs) || registeredMs > observedMs)
      throw new Error("A registered study and actual receipt time are required.");
    const observedAt = Math.floor(observedMs / 1000);
    const registeredAt = Math.floor(registeredMs / 1000);
    const observedIso = new Date(observedMs).toISOString();
    let inserted = 0, rejected = 0, duplicates = 0;
    await client.query("BEGIN");
    began = true;
    for (const row of options.signals) {
      const signalMs = Date.parse(row.signal_ts);
      // A historical row whose source timestamp predates the study is not a
      // new observation. No seven-day mirror backfill becomes fresh evidence.
      if (!Number.isFinite(signalMs) || signalMs < registeredMs || !row.dedupe_key || row.dedupe_key.length > 256 ||
          !["MES", "MNQ"].includes(row.symbol) || !["long", "short"].includes(row.direction)) continue;
      const keyParts = row.dedupe_key.split(":");
      const strategy = keyParts[1] === "shadow" ? keyParts[2] : keyParts[1];
      const dataAsOf = options.marketAsOf[row.symbol];
      const source: ShadowSourceIdea = {
        key: row.dedupe_key, symbol: row.symbol as "MES" | "MNQ", side: row.direction === "long" ? "LONG" : "SHORT",
        strategy: strategy ?? "", tier: row.tier, status: row.status, signalTs: Math.floor(signalMs / 1000), observedAt,
        dataAsOf: typeof dataAsOf === "number" && Number.isFinite(dataAsOf) && Math.abs(dataAsOf) <= 8640000000000 ? dataAsOf : null,
        stale: row.stale_data, orphaned: row.orphaned, suppressed: row.suppressed,
        entry: row.entry_price, stop: row.stop_price, target: row.target_price, score: row.score, rr: row.rr,
      };
      // A source row carrying any exit/outcome cannot become a prospective
      // input even if its status is unexpectedly still "triggered".
      if (row.exit_ts != null || row.exit_price != null || row.pnl_usd != null) source.status = "already-closed";
      const capture = captureShadowIdea(source, registeredAt);
      const eligible = capture.kind === "eligible";
      const payload = eligible ? capture.snapshot : {};
      const dataIso = source.dataAsOf === null ? null : new Date(source.dataAsOf * 1000).toISOString();
      const fresh = !row.stale_data && source.dataAsOf !== null && source.dataAsOf <= observedAt &&
        observedAt - source.dataAsOf <= SHADOW_MAX_DATA_AGE_SECONDS;
      const query = await client.query(
        `INSERT INTO public.ai_shadow_snapshots
          (study_id, opportunity_key, source_signal_at, observed_at, symbol, side, source_paused, source_fresh,
           data_as_of, eligibility, rejection_reason, payload, source_code_sha)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         ON CONFLICT (study_id, opportunity_key) DO NOTHING RETURNING opportunity_key`,
        [options.study.id, row.dedupe_key, new Date(signalMs).toISOString(), observedIso, source.symbol, source.side,
          row.suppressed, fresh, dataIso,
          capture.kind, capture.reason, JSON.stringify(payload), options.sourceCodeSha],
      );
      if (query.rowCount) { inserted++; if (!eligible) rejected++; } else duplicates++;
    }
    await client.query("COMMIT");
    return { ok: true, inserted, rejected, duplicates };
  } catch (err) {
    if (began) { try { await client.query("ROLLBACK"); } catch { /* the failed client is discarded by its owner */ } }
    return { ok: false, inserted: 0, rejected: 0, duplicates: 0,
      error: (err instanceof Error ? err.message : "AI shadow capture failed").slice(0, 160) };
  }
}
