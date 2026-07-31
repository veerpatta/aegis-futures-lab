/* Nightly report card (audit item 13).
   ─────────────────────────────────────────────────────────────────────────
   Reads the trading day's signals plus the engine's own skip funnel, composes
   a plain-language debrief (debrief-copy.ts) and sends it to Telegram — the
   channel this repo already has wired, rather than adding Discord for the
   same job.

   SCOPE, stated because the audit assumed otherwise: this covers the BOT's
   day only. The human journal lives behind Supabase Auth with owner-scoped
   RLS (journal_entries), so a GitHub Action holding a service-role key could
   technically read it but has no business doing so — the point of that
   migration was that the journal is private. Bot-vs-you comparison stays in
   the app, where the user is authenticated as themselves.

   Never fails the run: a debrief that breaks a workflow is worse than no
   debrief. Run with: npx tsx scripts/engine/debrief.ts */

import { createClient } from "@supabase/supabase-js";
import { tradingDayKey } from "@/lib/time/ny";
import { DAILY_FUNNEL_STAT_KEY, type DailyFunnelPayload } from "@/lib/signals/daily-funnel";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { buildDebrief, type DebriefRow } from "./debrief-copy";
import { sendTelegram } from "./notify";

const url = process.env.SUPABASE_URL || SUPABASE_URL;
const key = process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

/* Which day to report on. Defaults to the trading day that has just closed;
   DEBRIEF_DATE overrides it for a manual re-run of a specific session. */
function targetDay(nowSec: number): string {
  const override = process.env.DEBRIEF_DATE?.trim();
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override))
      throw new Error(`DEBRIEF_DATE must be YYYY-MM-DD, got "${override}"`);
    return override;
  }
  /* The job runs after the New York close, so "now" is already inside the
     NEXT trading day once the Globex evening starts. Step back far enough to
     land in the session that just finished. */
  return tradingDayKey(nowSec - 6 * 3600);
}

async function main(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const dateKey = targetDay(nowSec);

  /* A generous window either side, then filter by trading day — a signal
     stamped 20:05 ET belongs to the NEXT session, and a naive date-range
     query would file it under the wrong one. */
  const fromIso = new Date((nowSec - 3 * 86400) * 1000).toISOString();
  const { data, error } = await supabase
    .from("signals")
    .select("symbol, tier, status, pnl_usd, signal_ts, suppressed, stale_data")
    .gte("signal_ts", fromIso)
    .order("signal_ts", { ascending: true });
  if (error) throw new Error(`signals read: ${error.message}`);

  const rows = ((data ?? []) as DebriefRow[]).filter(
    (r) => tradingDayKey(Math.floor(new Date(r.signal_ts).getTime() / 1000)) === dateKey
  );

  // The engine's own funnel for the day, if it wrote one.
  let funnel: Record<string, number> | undefined;
  let barsSeen: number | undefined;
  try {
    const { data: fn } = await supabase
      .from("learned_stats")
      .select("payload")
      .eq("stat_key", DAILY_FUNNEL_STAT_KEY)
      .eq("date_key", dateKey)
      .limit(1);
    const payload = fn?.[0]?.payload as DailyFunnelPayload | undefined;
    if (payload) {
      funnel = payload.funnel;
      barsSeen = (payload.bars?.MES ?? 0) + (payload.bars?.MNQ ?? 0);
    }
  } catch {
    /* funnel is a nicety — its absence must not cost the debrief */
  }

  /* Engine health for the day: any error heartbeat means the numbers are
     incomplete, and the report card has to lead with that. */
  let engineHealthy = true;
  try {
    const { data: runs } = await supabase
      .from("engine_runs")
      .select("status, ran_at")
      .gte("ran_at", new Date((nowSec - 30 * 3600) * 1000).toISOString())
      .order("ran_at", { ascending: false })
      .limit(100);
    engineHealthy = !(runs ?? []).some((r) => r.status === "error");
  } catch {
    /* leave healthy — do not invent an outage from a read failure */
  }

  const text = buildDebrief({ dateKey, rows, funnel, barsSeen, engineHealthy });
  console.log(text.replace(/<\/?[a-z]+>/g, ""));
  await sendTelegram(text); // never throws
}

main().catch((err) => {
  // Loud in the log, but never red: a broken debrief must not mask the
  // engine's own health signal, which is what the watchdog actually reads.
  console.error(`debrief failed: ${err instanceof Error ? err.message : err}`);
  process.exit(0);
});
