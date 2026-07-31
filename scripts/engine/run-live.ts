/* Scheduled paper-signal engine (GitHub Actions, every 15 min in market
   hours). Each run is a full deterministic recompute over the trailing 60
   days of delayed Yahoo 5m data:

     fetch bars → run every tier stream (tiers.ts) through the one backtest
     simulator → upsert the last LOOKBACK_DAYS of simulated trades as signal
     rows (stable dedupe keys, so statuses transition in place) → snapshot
     the current zone stacks → heartbeat row in engine_runs.

   Idempotent by construction: re-running with the same data writes the same
   rows, so cron jitter and manual re-runs are harmless.
   Run with: npx tsx scripts/engine/run-live.ts */

import { createClient } from "@supabase/supabase-js";
import type { Bar, Trade } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { alignArchiveSlice } from "@/lib/data/window";
import { statusFromExit } from "@/lib/signals/status";
import { assessStaleness, lastBarBySymbol, staleAtSignal } from "@/lib/signals/freshness";
import { DAILY_FUNNEL_STAT_KEY, type DailyFunnelPayload } from "@/lib/signals/daily-funnel";
import { streamKeyFor } from "@/lib/engine/streams";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { MARKET_HOLIDAYS, flattenMinuteNy, holidayFor } from "@/lib/market/holidays";
import { nyMeta, tradingDayKey } from "@/lib/time/ny";
import type { OpenPosition } from "@/lib/strategies/types";
import { fetchYahooBars } from "./data";
import { STALE_MARKER, inEntryWindow } from "@/lib/time/session";
import { diffSignalAlerts, escapeHtml, formatAlertMessage } from "./alerts";
import { loadContextRows, updateContextDaily, vixBucketFor, type ContextRow } from "./context";
import { auditFill, type FillConfidence } from "./fill-audit";
import { sendTelegram } from "./notify";
import { computeRegime } from "./regime";
import { runShadows } from "./shadow";
import { applyBreakers, isSuppressedAt, streamKeyForRow } from "./breakers";
import { applyWinProb } from "./model";
import { zoneRows } from "./zone-rows";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "./tiers";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { DEFAULT_BAR_SOURCE } from "@/lib/data/source";

const LOOKBACK_DAYS = 7; // how far back simulated trades are mirrored as signal rows

const url = process.env.SUPABASE_URL || SUPABASE_URL;
const key = process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY;
/* RLS blocks anonymous writes on the engine tables, so a CI run without the
   service-role key would fail row by row. Fail fast with the fix instead. */
if (process.env.GITHUB_ACTIONS && (!process.env.SUPABASE_KEY || key === SUPABASE_PUBLISHABLE_KEY)) {
  console.error(
    "SUPABASE_KEY is missing or is the publishable key — engine writes are blocked by RLS.\n" +
      "Add the Supabase service-role key as the SUPABASE_SERVICE_ROLE_KEY repo secret\n" +
      "(GitHub → Settings → Secrets and variables → Actions) so the workflow can pass it."
  );
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

interface SignalRow {
  dedupe_key: string;
  tier: "A" | "B";
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  target_price: number | null;
  rr: number | null;
  qty: number | null;
  score: number | null;
  status: string;
  reason: string;
  signal_ts: string;
  exit_ts: string | null;
  exit_price: number | null;
  pnl_usd: number | null;
  risk_usd: number | null;
  regime: string | null;
  fill_confidence: FillConfidence | null;
  vix_bucket: string | null;
  suppressed: boolean;
  /* Item 2.4 — the run that produced this row was computed on bars older than
     STALE_BAR_AGE_MIN. Same treatment as `suppressed`: out of headline stats,
     out of Telegram, out of the model's training set, visible in the drawer. */
  stale_data: boolean;
  win_prob: number | null;
  model_veto: boolean;
  updated_at: string;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/* ── Bar archive (bars_5m) ───────────────────────────────────────────────
   Yahoo only serves a sliding 60-day window of 5m history, so every
   successful fetch is upserted into bars_5m (only bars newer than what is
   already stored — steady-state writes are a handful of rows). When Yahoo
   fails all retries the trailing 60d is loaded back from the archive and
   the run continues with a warning; the run only errors when BOTH sources
   are unavailable. When both exist, Yahoo wins — the archive is a fallback
   and a long-term store, never a merge source.

   Every read and write below pins source = 'yahoo'. bars_5m is keyed
   (symbol, source, time) since 20260730105000_bars_5m_source, and the
   Databento backfill lands the real CME contracts on the SAME timestamps.
   Without the filter the max(time) probe would see Databento's rows and stop
   archiving Yahoo, and the Yahoo-down fallback would read both feeds back as
   duplicate bars. */

const ARCHIVE_CHUNK = 1000; // rows per request, safely under Supabase limits
const ARCHIVE_WINDOW_SEC = 60 * 86400;

async function archiveNewBars(symbol: FeedSymbol, bars: Bar[]): Promise<number> {
  const { data, error } = await supabase
    .from("bars_5m")
    .select("time")
    .eq("symbol", symbol)
    .eq("source", DEFAULT_BAR_SOURCE)
    .order("time", { ascending: false })
    .limit(1);
  if (error) throw new Error(`bars_5m max(time) for ${symbol}: ${error.message}`);
  const maxStored = data?.length ? Number(data[0].time) : null;
  const fresh = maxStored === null ? bars : bars.filter((b) => b.time > maxStored);
  for (let i = 0; i < fresh.length; i += ARCHIVE_CHUNK) {
    const chunk = fresh.slice(i, i + ARCHIVE_CHUNK).map((b) => ({
      symbol,
      source: DEFAULT_BAR_SOURCE,
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 0,
    }));
    const { error: upsertError } = await supabase
      .from("bars_5m")
      .upsert(chunk, { onConflict: "symbol,source,time" });
    if (upsertError) throw new Error(`bars_5m upsert for ${symbol}: ${upsertError.message}`);
  }
  return fresh.length;
}

async function archiveTrailingBars(symbol: FeedSymbol, nowSec: number): Promise<Bar[]> {
  const from = nowSec - ARCHIVE_WINDOW_SEC;
  const out: Bar[] = [];
  for (let offset = 0; ; offset += ARCHIVE_CHUNK) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .eq("source", DEFAULT_BAR_SOURCE)
      .gte("time", from)
      .order("time", { ascending: true })
      .range(offset, offset + ARCHIVE_CHUNK - 1);
    if (error) throw new Error(`bars_5m read for ${symbol}: ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      });
    if (!data || data.length < ARCHIVE_CHUNK) break;
  }
  // Same whole-session trim the funnel uses: this is the Yahoo-down fallback,
  // so a truncated leading day here would reach LIVE signals (lib/data/window.ts).
  return alignArchiveSlice(out);
}

async function loadBars(
  symbol: FeedSymbol,
  nowSec: number,
  warnings: string[]
): Promise<{ bars: Bar[]; fromArchive: boolean }> {
  try {
    return { bars: await fetchYahooBars(symbol), fromArchive: false };
  } catch (yahooErr) {
    const yahooMsg = yahooErr instanceof Error ? yahooErr.message : String(yahooErr);
    let archived: Bar[];
    try {
      archived = await archiveTrailingBars(symbol, nowSec);
    } catch (archiveErr) {
      const archiveMsg = archiveErr instanceof Error ? archiveErr.message : String(archiveErr);
      throw new Error(`${symbol}: yahoo (${yahooMsg}) and archive (${archiveMsg}) both unavailable`);
    }
    if (!archived.length) throw new Error(`${symbol}: yahoo down (${yahooMsg}), archive empty`);
    warnings.push(`${symbol} from archive (yahoo down)`);
    return { bars: archived, fromArchive: true };
  }
}

function rowFromTrade(tier: "A" | "B", label: string, t: Trade): SignalRow {
  const status = statusFromExit(t.exitReason, t.pnl);
  const stopDist = Math.abs(t.entryPrice - t.stop);
  return {
    dedupe_key: `${tier}:${label}:${t.symbol}:${t.entryTime}`,
    tier,
    symbol: t.symbol,
    timeframe: t.tags?.entryTf ?? "5m",
    direction: t.side === "LONG" ? "long" : "short",
    entry_price: t.entryPrice,
    stop_price: t.stop,
    target_price: t.target,
    rr: t.target !== null && stopDist > 0 ? +(Math.abs(t.target - t.entryPrice) / stopDist).toFixed(2) : null,
    qty: t.qty,
    score: t.score ?? null,
    status,
    reason: `${label}: ${t.tags?.pattern ?? t.tags?.trigger ?? "signal"}`,
    signal_ts: iso(t.entryTime),
    exit_ts: iso(t.exitTime),
    exit_price: t.exitPrice,
    pnl_usd: +t.pnl.toFixed(2),
    risk_usd: t.rMultiple ? +Math.abs(t.pnl / t.rMultiple).toFixed(2) : null,
    regime: null, // stamped by the caller from the symbol's bars
    fill_confidence: null, // stamped by the caller (fill-audit.ts)
    vix_bucket: null, // stamped by the caller (context.ts)
    suppressed: false, // stamped by the caller (breakers.ts)
    stale_data: false, // stamped by the caller (lib/signals/freshness.ts)
    win_prob: null, // stamped by the caller (model.ts)
    model_veto: false, // stamped by the caller (model.ts)
    updated_at: new Date().toISOString(),
  };
}

function rowFromOpen(tier: "A" | "B", label: string, p: OpenPosition): SignalRow {
  const stopDist = Math.abs(p.entry - p.stop);
  return {
    dedupe_key: `${tier}:${label}:${p.symbol}:${p.openedAt}`,
    tier,
    symbol: p.symbol,
    timeframe: p.tags?.entryTf ?? "5m",
    direction: p.side === "LONG" ? "long" : "short",
    entry_price: p.entry,
    stop_price: p.stop,
    target_price: p.target,
    rr:
      p.target !== null && stopDist > 0
        ? +(Math.abs(p.target - p.entry) / stopDist).toFixed(2)
        : null,
    qty: p.qty,
    score: p.score ?? null,
    status: "triggered",
    reason: `${label}: ${p.tags?.pattern ?? p.tags?.trigger ?? "signal"} (open)`,
    signal_ts: iso(p.openedAt),
    exit_ts: null,
    exit_price: null,
    pnl_usd: null,
    risk_usd: +p.risk.toFixed(2),
    regime: null, // stamped by the caller from the symbol's bars
    fill_confidence: null, // stamped by the caller (fill-audit.ts)
    vix_bucket: null, // stamped by the caller (context.ts)
    suppressed: false, // stamped by the caller (breakers.ts)
    stale_data: false, // stamped by the caller (lib/signals/freshness.ts)
    win_prob: null, // stamped by the caller (model.ts)
    model_veto: false, // stamped by the caller (model.ts)
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const started = Date.now();
  const nowSec = Math.floor(started / 1000);

  // CME full holiday: no NY day session. Record a green heartbeat (the cron
  // did run — watchdog and run-dots stay calm) and skip the recompute.
  // The TRADING day, not the calendar one: the engine now runs through the
  // Globex evening, and a 20:00 ET pass is working on the NEXT session. On the
  // evening before a full holiday that session is the holiday's, so it is
  // correctly skipped; on the holiday's own evening the market has reopened for
  // the day after and the engine correctly runs.
  const todayHoliday = holidayFor(tradingDayKey(nowSec));
  if (todayHoliday?.kind === "closed") {
    const message = `holiday: ${todayHoliday.name} — market closed, run skipped`;
    const { error } = await supabase.from("engine_runs").insert({
      status: "ok",
      symbols: ["MES", "MNQ"],
      duration_ms: Date.now() - started,
      source: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
      message,
    });
    if (error) throw new Error(`engine_runs insert: ${error.message}`);
    console.log(message);
    return;
  }

  // Early-close days flatten positions 5 min before the halt. Built for every
  // early-close date in the table so historical half-days inside the 60d
  // recompute window simulate correctly too — configuration through the
  // sessionExitMinute plumbing, never a strategy change.
  const exitMinuteByDay: Record<string, number> = {};
  for (const h of MARKET_HOLIDAYS)
    if (h.kind === "early-close")
      exitMinuteByDay[h.date] = flattenMinuteNy(h.date, SESSION_EXIT_MINUTE);

  const warnings: string[] = [];
  const phaseT = (label: string, since: number) =>
    console.log(`phase ${label}: ${((Date.now() - since) / 1000).toFixed(1)}s`);
  let phaseStart = Date.now();
  const [mesLoad, mnqLoad] = await Promise.all([
    loadBars("MES", nowSec, warnings),
    loadBars("MNQ", nowSec, warnings),
  ]);
  phaseT("fetch", phaseStart);
  phaseStart = Date.now();

  // Market context (context_daily): refresh once per NY day, load the rows
  // for vix_bucket tagging. Both non-fatal — buckets just stay null.
  let ctxRows: ContextRow[] = [];
  try {
    const refreshed = await updateContextDaily(supabase, nowSec);
    if (refreshed) console.log(`context_daily: refreshed ${refreshed} rows`);
  } catch (e) {
    warnings.push(`context update failed: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }
  try {
    ctxRows = await loadContextRows(supabase);
  } catch {
    /* buckets stay null this run */
  }
  const bucketFor = (entrySec: number) =>
    vixBucketFor(ctxRows, nyMeta(entrySec).dateKey);
  const mes = mesLoad.bars;
  const mnq = mnqLoad.bars;
  const bySymbol: Record<string, Bar[]> = { MES: mes, MNQ: mnq };
  const cutoff = nowSec - LOOKBACK_DAYS * 86400;

  // Archive fresh Yahoo bars for the long-term store; never archive bars
  // that themselves came from the archive. Best effort — an archive write
  // failure must not kill the signal run.
  for (const [symbol, load] of [
    ["MES", mesLoad],
    ["MNQ", mnqLoad],
  ] as const) {
    if (load.fromArchive) continue;
    try {
      const n = await archiveNewBars(symbol, load.bars);
      if (n) console.log(`${symbol}: archived ${n} new bars`);
    } catch (e) {
      warnings.push(`${symbol} archive write failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 1) Signals from every tier stream.
  const signalRows = new Map<string, SignalRow>();
  let tierA = 0;
  let tierB = 0;
  // Item 2.7 — today's skip funnel, summed across streams, for the Home panel.
  /* The trading day this pass belongs to. Was nyMeta(nowSec).dateKey, which
     was fine while the cron stopped at 17:45 ET but files a zeroed funnel row
     under a calendar Sunday once the engine runs through the Globex evening —
     and Home's "why no signal today?" reads the newest date_key, so that empty
     Sunday would hide Friday's real one. */
  const todayKey = tradingDayKey(nowSec);
  const todayFunnel: Record<string, number> = {};
  const streamStatus: DailyFunnelPayload["streams"] = [];
  for (const stream of tierStreams()) {
    const res = executeRun({
      strategyId: stream.strategyId,
      params: stream.params,
      series: Object.fromEntries(stream.symbols.map((s) => [s, bySymbol[s]])),
      execution: {
        ...EXECUTION,
        fillModel: stream.fillModel,
        // Per-symbol risk cap (item 2.3); absent ⇒ the shared EXECUTION value.
        maxRisk: stream.maxRisk ?? EXECUTION.maxRisk,
      },
      locks: stream.locks,
      startingCapital: STARTING_CAPITAL,
      sessionExitMinute: SESSION_EXIT_MINUTE,
      sessionExitMinuteByDay: exitMinuteByDay,
      pointValues: POINT_VALUES,
      keepOpenAtEnd: true,
    });
    // Fill-realism audit against the bars in memory. For limit streams the
    // resting level is recovered as entry ∓ slippage (the engine fills at
    // limit + slippage when price arrives against the order).
    const audit = (
      side: "LONG" | "SHORT",
      symbol: string,
      entryPrice: number,
      entryTime: number,
      exitTime: number | null
    ) =>
      auditFill({
        fillModel: stream.fillModel,
        direction: side === "LONG" ? "long" : "short",
        limit:
          stream.fillModel === "limit"
            ? side === "LONG"
              ? entryPrice - EXECUTION.slippage
              : entryPrice + EXECUTION.slippage
            : entryPrice,
        entryTime,
        exitTime,
        bars: bySymbol[symbol] ?? [],
      });
    for (const t of res.trades) {
      if (t.entryTime < cutoff) continue;
      const row = rowFromTrade(stream.tier, stream.label, t);
      row.regime = computeRegime(bySymbol[t.symbol] ?? [], t.entryTime);
      row.fill_confidence = audit(t.side, t.symbol, t.entryPrice, t.entryTime, t.exitTime);
      row.vix_bucket = bucketFor(t.entryTime);
      signalRows.set(row.dedupe_key, row);
    }
    if (res.openPosition && res.openPosition.openedAt >= cutoff) {
      const p = res.openPosition;
      const row = rowFromOpen(stream.tier, stream.label, p);
      row.regime = computeRegime(bySymbol[p.symbol] ?? [], p.openedAt);
      row.fill_confidence = audit(p.side, p.symbol, p.entry, p.openedAt, null);
      row.vix_bucket = bucketFor(p.openedAt);
      signalRows.set(row.dedupe_key, row);
    }
    const n = res.trades.filter((t) => t.entryTime >= cutoff).length + (res.openPosition ? 1 : 0);
    if (stream.tier === "A") tierA += n;
    else tierB += n;
    // Item 2.7 — today's funnel and this stream's own count for the Home panel.
    for (const [reason, count] of Object.entries(res.skipReasonsByDay[todayKey] ?? {}))
      todayFunnel[reason] = (todayFunnel[reason] ?? 0) + count;
    streamStatus.push({
      key: streamKeyFor(stream.tier, stream.label, stream.symbols.join("+")),
      label: `${stream.label} ${stream.symbols.join("+")}`,
      tier: stream.tier,
      status: "active", // refined below once the breakers have run
      signalsToday:
        res.trades.filter((t) => tradingDayKey(t.entryTime) === todayKey).length +
        (res.openPosition && tradingDayKey(res.openPosition.openedAt) === todayKey ? 1 : 0),
    });
    console.log(
      `${stream.tier} ${stream.label} ${stream.symbols.join("+")}: ${n} signals in last ${LOOKBACK_DAYS}d`
    );
  }
  const signals = [...signalRows.values()];

  // 1a) Bar-age gate (item 2.4). One verdict for the run from the freshest bar
  // of each symbol; when the feed has stalled past the threshold every row this
  // run produced is flagged stale_data. The rows are still written — deleting
  // them would hide the outage — but they are excluded from headline stats,
  // Telegram and the model's training set, exactly like `suppressed`.
  const staleness = assessStaleness(bySymbol, nowSec);
  // Flag PER ROW, not per run. A run can be stale (the feed is behind right now)
  // while most of its rows are perfectly well observed — every pass recomputes
  // the trailing 7 days, so a weekend run would otherwise flag Friday's rows and
  // drain the headline stats. What taints a row is sitting at the blind edge of
  // the data, which is also what makes its fill audit unjudgeable.
  const lastBars = lastBarBySymbol(bySymbol);
  let flagged = 0;
  for (const row of signals) {
    const signalSec = Math.floor(new Date(row.signal_ts).getTime() / 1000);
    row.stale_data = staleAtSignal(signalSec, lastBars[row.symbol] ?? null);
    if (row.stale_data) flagged++;
  }
  if (staleness.stale) warnings.push(staleness.note as string);
  if (flagged || staleness.stale)
    console.log(
      `stale data: worst bar age ${staleness.worstAgeMin}m (limit ${staleness.thresholdMin}m) — ` +
        `${flagged} of ${signals.length} row(s) flagged stale_data`
    );

  // 1b) Circuit breakers (Ring 1a). Read each stream's closed history + policy
  // state, decide pause/resume, record flips (bot_policy + Telegram), and stamp
  // suppressed on this run's rows. Presentation-layer only: the simulator ran
  // unchanged above; suppressed just hides a benched stream from headline stats
  // and alerts while it keeps simulating. Never fails the run (fail-safe:
  // active). Frozen via BOT_POLICY_FREEZE.
  let breakerNotes: string[] = [];
  try {
    const { intervalsByStream, pausedStreams, notes } = await applyBreakers(supabase, nowSec);
    breakerNotes = notes;
    // Item 2.7 — a benched stream is quiet on purpose; the panel must say which.
    const paused = new Set(pausedStreams);
    for (const s of streamStatus)
      if (paused.has(s.key)) s.status = "benched";
    // Per-row suppression at ENTRY TIME: a row is suppressed iff its stream was
    // paused at the row's signal_ts (derived from the pause-interval history).
    // A pause/resume therefore never rewrites already-decided history, and the
    // result is deterministic each run (idempotent upsert).
    for (const row of signals) {
      const intervals = intervalsByStream.get(streamKeyForRow(row)) ?? [];
      row.suppressed = isSuppressedAt(intervals, Math.floor(new Date(row.signal_ts).getTime() / 1000));
    }
    console.log(
      `breakers: ${pausedStreams.length ? `paused ${pausedStreams.join(", ")}` : "all active"}` +
        (notes.length ? ` · ${notes.join("; ")}` : "")
    );
  } catch (e) {
    warnings.push(`breaker_error: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }
  if (breakerNotes.length) warnings.push(`breakers: ${breakerNotes.join("; ")}`);

  // 1c) Win-probability model (Ring 1b). Score each signal's win_prob and flag
  // the bottom decile of the trailing distribution as model_veto. The veto only
  // takes real effect (alert exclusion) when the model is ACTIVE; in observe/
  // demoted it is a ghost flag the digest grades. Never fails the run.
  let modelActive = false;
  try {
    const res = await applyWinProb(supabase, signals);
    modelActive = res.active;
    if (res.status)
      console.log(
        `winprob: model ${res.status}, threshold ${res.threshold?.toFixed(3) ?? "—"}, ` +
          `${res.vetoed} bottom-decile${res.active ? " (vetoed)" : " (ghost)"}`
      );
  } catch (e) {
    warnings.push(`winprob_error: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }

  // Telegram diff baseline: what the table says BEFORE this run rewrites it.
  // A failed read only disables alerting (null) — never the run, and never
  // a spam-everything-as-new fallback.
  let oldStatus: Map<string, string> | null = new Map();
  try {
    const keys = signals.map((s) => s.dedupe_key);
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await supabase
        .from("signals")
        .select("dedupe_key, status")
        .in("dedupe_key", keys.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) oldStatus.set(r.dedupe_key as string, r.status as string);
    }
  } catch (e) {
    console.error(`alert baseline read failed — alerts skipped: ${e instanceof Error ? e.message : e}`);
    oldStatus = null;
  }

  if (signals.length) {
    const { error } = await supabase.from("signals").upsert(signals, { onConflict: "dedupe_key" });
    if (error) throw new Error(`signals upsert: ${error.message}`);
  }

  if (oldStatus) {
    // Suppressed (breaker-paused) streams never alert, and neither do rows
    // computed on stale bars (item 2.4). When the model is active, its
    // bottom-decile vetoes are also held back from NEW-idea alerts.
    const alertable = signals.filter(
      (s) => !s.suppressed && !s.stale_data && !(modelActive && s.model_veto)
    );
    const message = formatAlertMessage(diffSignalAlerts(oldStatus, alertable));
    if (message) await sendTelegram(message); // never throws
  }
  phaseT("signals", phaseStart);
  phaseStart = Date.now();

  // 2) Zone snapshot (tier-A structure: NY-session bars only).
  const zones = [...zoneRows("MES", mes, nowSec), ...zoneRows("MNQ", mnq, nowSec)];
  // Prune BEFORE upserting, not after: a fresh formation at a price level
  // that already has a row from an earlier run carries a different
  // dedupe_key but the SAME natural key (symbol, timeframe, zone_type,
  // price_high, price_low), and the leftover row aborts the whole upsert
  // (bit us live 2026-07-23). Anything not in this snapshot is superseded —
  // consumed, out of the nearest-N window, or an older formation of a level
  // this batch re-emits — so drop it first.
  {
    const query = supabase.from("zones").delete();
    const { error } = zones.length
      ? await query.filter(
          "dedupe_key",
          "not.in",
          `(${zones.map((z) => `"${z.dedupe_key}"`).join(",")})`
        )
      : await query.gte("id", 0);
    if (error) throw new Error(`zones cleanup: ${error.message}`);
  }
  if (zones.length) {
    const { error } = await supabase.from("zones").upsert(zones, { onConflict: "dedupe_key" });
    if (error) throw new Error(`zones upsert: ${error.message}`);
  }
  phaseT("zones", phaseStart);
  phaseStart = Date.now();

  // 2a) Today's funnel for the Home "why no signal today?" panel (item 2.7).
  // Written to the existing versioned learned_stats table — no migration, and a
  // re-run on the same NY date overwrites the same row. Best effort: this is
  // presentation bookkeeping and must never fail a signal run.
  try {
    // Only call a stream "stale price feed" when a row of its own was
    // actually flagged — a behind feed that cost nothing is not a stream fault.
    if (flagged > 0) for (const s of streamStatus) s.status = "stale-data";
    const funnelPayload: DailyFunnelPayload = {
      dateKey: todayKey,
      computedAt: new Date().toISOString(),
      // Bars are attributed to the session they belong to, so the Sunday-evening
      // bars of Monday's session count toward Monday rather than vanishing.
      bars: { MES: mes.filter((b) => tradingDayKey(b.time) === todayKey).length,
              MNQ: mnq.filter((b) => tradingDayKey(b.time) === todayKey).length },
      funnel: todayFunnel,
      streams: streamStatus,
      staleData: staleness.stale,
      worstBarAgeMin: staleness.worstAgeMin,
      staleRowsFlagged: flagged,
    };
    const { error } = await supabase.from("learned_stats").upsert(
      {
        stat_key: DAILY_FUNNEL_STAT_KEY,
        date_key: todayKey,
        computed_at: funnelPayload.computedAt,
        payload: funnelPayload,
      },
      { onConflict: "stat_key,date_key" }
    );
    if (error) throw new Error(error.message);
  } catch (e) {
    warnings.push(`daily_funnel write failed: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }

  // 2b) Shadow auditions — observation only. Quarantined: separate table,
  // no Telegram, and NOTHING here may fail the run; a 60s budget caps what
  // a slow strategy can cost the cron (skipped streams catch up next run).
  try {
    const shadow = await runShadows({
      supabase,
      bySymbol,
      nowSec,
      cutoff,
      exitMinuteByDay,
      timeBudgetMs: 60_000,
      vixBucketFor: bucketFor,
      // Same per-row gate the live signals get (item 2.4).
      staleAt: (symbol, signalSec) => staleAtSignal(signalSec, lastBars[symbol] ?? null),
    });
    console.log(
      `shadow: ${shadow.upserted} rows from ${shadow.streamsRun} streams` +
        (shadow.streamsSkipped ? ` (${shadow.streamsSkipped} skipped on time budget)` : "")
    );
    if (shadow.errors.length)
      warnings.push(`shadow_errors: ${shadow.errors.join(" | ").slice(0, 160)}`);
  } catch (e) {
    warnings.push(`shadow_errors: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
  }
  phaseT("shadow", phaseStart);
  phaseStart = Date.now();

  // 3) Heartbeat, with per-symbol data freshness. STALE_MARKER is the exact
  // token the dashboard looks for (lib/time/session.ts dataDelayed) — newest
  // bar more than 30 min old inside the 02:00–15:25 ET entry window. Shared as
  // a constant, not a copied literal: the dashboard used to match the bare
  // word "stale", which the un-gated verdict note below also contains, so
  // every weekend heartbeat tripped the "data delayed" banner.
  const mesAge = staleness.ageBySymbol.MES ?? 0;
  const mnqAge = staleness.ageBySymbol.MNQ ?? 0;
  // The dashboard's dataDelayed marker keeps its in-session-only meaning; the
  // row-level stale_data flag above is deliberately clock-independent.
  const stale = inEntryWindow(nowSec) && staleness.stale;
  const { error: runError } = await supabase.from("engine_runs").insert({
    status: "ok",
    symbols: ["MES", "MNQ"],
    zones_upserted: zones.length,
    signals_created: signals.length,
    tier_a_signals: tierA,
    tier_b_signals: tierB,
    duration_ms: Date.now() - started,
    source: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    message: [
      `bars MES ${mes.length} / MNQ ${mnq.length}, last ${iso(
        Math.min(mes[mes.length - 1].time, mnq[mnq.length - 1].time)
      )}`,
      `age MES ${mesAge}m / MNQ ${mnqAge}m${stale ? ` ${STALE_MARKER}` : ""}`,
      ...warnings,
    ].join("; "),
  });
  if (runError) throw new Error(`engine_runs insert: ${runError.message}`);

  console.log(
    `ok: ${signals.length} signal rows (A ${tierA} / B ${tierB}), ${zones.length} zones, ${Date.now() - started}ms`
  );
}

main().catch(async (err) => {
  console.error(err);
  const message = String(err instanceof Error ? err.message : err);
  try {
    await supabase.from("engine_runs").insert({
      status: "error",
      symbols: ["MES", "MNQ"],
      source: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
      message: message.slice(0, 500),
    });
  } catch {
    /* best effort */
  }
  await sendTelegram(`⚠️ Engine run failed: ${escapeHtml(message.slice(0, 200))}`); // never throws
  process.exit(1);
});
