import type { Bar } from "@/lib/types";
import type { CaptureClient } from "./ai-shadow-capture";

export interface ShadowBarFeed {
  symbol: "MES" | "MNQ";
  bars: readonly Bar[];
  /** Actual time the Yahoo fetch completed, not the bar's market time. */
  receivedAt: number;
  fromArchive: boolean;
}

/** First database receipt is the conservative time used by study evaluators.
 * Ignore archive fallbacks and old catch-up history; never fabricate receipt
 * times. Preserve the original bar and append any later changed OHLC. */
export async function captureAiShadowBars(client: CaptureClient, study: { id: string; registeredAt: string }, feeds: readonly ShadowBarFeed[]): Promise<void> {
  const registration = Date.parse(study.registeredAt);
  if (!Number.isFinite(registration)) throw new Error("Invalid study registration");
  const input = feeds.flatMap(feed => {
    if (feed.fromArchive || !Number.isFinite(feed.receivedAt) || feed.receivedAt < registration) return [];
    const receivedSec = feed.receivedAt / 1000;
    return feed.bars.filter(b => Number.isSafeInteger(b.time) && b.time * 1000 >= registration &&
      b.time + 300 <= receivedSec && b.time >= receivedSec - 86400 &&
      [b.open, b.high, b.low, b.close].every(n => Number.isFinite(n) && n > 0) &&
      b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close, b.high))
      .map(b => ({ symbol: feed.symbol, bar_time: b.time, open: b.open, high: b.high, low: b.low,
        close: b.close, source_received_at: new Date(feed.receivedAt).toISOString() }));
  });
  if (!input.length) return;
  const inputJson = JSON.stringify(input);
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    await client.query(`INSERT INTO public.ai_shadow_bars
      (study_id, symbol, bar_time, open, high, low, close, source_received_at)
      SELECT $1, b.symbol, b.bar_time, b.open, b.high, b.low, b.close, b.source_received_at
      FROM jsonb_to_recordset($2::jsonb) AS b(symbol text, bar_time bigint, open double precision, high double precision,
        low double precision, close double precision, source_received_at timestamptz)
      JOIN public.ai_shadow_studies s ON s.id = $1
      WHERE to_timestamp(b.bar_time) >= s.registered_at AND b.source_received_at >= s.registered_at
      ON CONFLICT (study_id, symbol, bar_time) DO NOTHING`, [study.id, inputJson]);
    await client.query(`INSERT INTO public.ai_shadow_bar_revisions (study_id, symbol, bar_time, open, high, low, close)
      SELECT old.study_id, old.symbol, old.bar_time, b.open, b.high, b.low, b.close
      FROM jsonb_to_recordset($2::jsonb) AS b(symbol text, bar_time bigint, open double precision, high double precision,
        low double precision, close double precision, source_received_at timestamptz)
      JOIN public.ai_shadow_bars old ON old.study_id = $1 AND old.symbol = b.symbol AND old.bar_time = b.bar_time
      WHERE (old.open, old.high, old.low, old.close) IS DISTINCT FROM (b.open, b.high, b.low, b.close)
      ON CONFLICT DO NOTHING`, [study.id, inputJson]);
    await client.query("COMMIT");
  } catch (error) {
    if (began) { try { await client.query("ROLLBACK"); } catch { /* owner releases the failed connection */ } }
    throw error;
  }
}
