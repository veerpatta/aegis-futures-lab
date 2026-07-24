/* Ring 1a — circuit breakers. A stream whose recent profit factor collapses is
   benched: it keeps simulating every run (its rows are written suppressed =
   true, treated like shadow rows at the presentation layer) but stops
   presenting ideas and stops counting in headline stats. When the silent
   simulation recovers it auto-resumes. Every flip writes a bot_policy audit
   row and a Telegram notice. Nothing here touches strategy code or params —
   it only flags rows AFTER the simulator has produced them.

   Gates (exact):
     PAUSE   when rolling PF over the last 20 closed signals (costs included,
             doubtful fills excluded) < 0.8.
     RESUME  when PF over the most recent 15 closed SUPPRESSED signals ≥ 1.1.
     Hysteresis: ≥ 3 trading days between flips per stream.
     Never evaluate with < 20 closed total (before that, always active).
     Freeze (BOT_POLICY_FREEZE = "1"): take no new actions; existing pauses
             stay put.

   Paper only, delayed data. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { nyMeta } from "@/lib/time/ny";
import { holidayFor } from "@/lib/market/holidays";
import { profitFactor } from "@/lib/stats";
import { streamKeyFor, streamLabel } from "@/lib/engine/streams";
import { sendTelegram } from "./notify";

export { streamKeyFor, streamLabel };

export const PAUSE_WINDOW = 20;
export const PAUSE_PF = 0.8;
export const RESUME_WINDOW = 15;
export const RESUME_PF = 1.1;
export const MIN_CLOSED_TO_EVALUATE = 20;
export const HYSTERESIS_TRADING_DAYS = 3;

/** NY trading days strictly after `fromSec`'s date up to and including
    `toSec`'s date (weekends and full holidays excluded). */
export function tradingDaysBetween(fromSec: number, toSec: number): number {
  if (toSec <= fromSec) return 0;
  const fromKey = nyMeta(fromSec).dateKey;
  const toKey = nyMeta(toSec).dateKey;
  let [y, m, d] = fromKey.split("-").map(Number);
  let count = 0;
  for (let i = 0; i < 400; i++) {
    const next = new Date(Date.UTC(y, m - 1, d) + 86400_000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const wd = next.getUTCDay();
    if (wd !== 0 && wd !== 6 && holidayFor(key)?.kind !== "closed") count++;
    if (key >= toKey) break;
  }
  return count;
}

export interface ClosedSignal {
  pnl_usd: number | null;
  fill_confidence: string | null;
  signal_ts: string;
}

export interface PolicyEvent {
  action: string;
  changed_at: string;
}

/** A pause period [start, end) in unix seconds; end === null while still open. */
export interface PauseInterval {
  start: number;
  end: number | null;
}

export interface BreakerDecision {
  currentlyPaused: boolean; // paused state BEFORE this run's flip
  flip: null | {
    action: "paused" | "resumed";
    reason: string;
    metrics: Record<string, unknown>;
    atSec: number;
  };
}

const pf = (pnls: number[]) => profitFactor(pnls);
const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const secOf = (ts: string) => Math.floor(Date.parse(ts) / 1000);

/* Build the stream's pause periods from its chronological bot_policy events.
   A `paused` opens a period; the next `resumed` closes it. The last period is
   open (end === null) while the stream is still benched. Deterministic — the
   same policy history always yields the same intervals, which is what makes
   per-row suppression idempotent. */
export function pauseIntervals(events: PolicyEvent[]): PauseInterval[] {
  const sorted = [...events].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  const intervals: PauseInterval[] = [];
  let open: number | null = null;
  for (const e of sorted) {
    if (e.action === "paused") {
      if (open === null) open = secOf(e.changed_at);
    } else if (e.action === "resumed") {
      if (open !== null) {
        intervals.push({ start: open, end: secOf(e.changed_at) });
        open = null;
      }
    }
  }
  if (open !== null) intervals.push({ start: open, end: null });
  return intervals;
}

/** True iff `sec` falls inside any pause period — the entry-time suppression rule. */
export function isSuppressedAt(intervals: PauseInterval[], sec: number): boolean {
  return intervals.some((iv) => sec >= iv.start && (iv.end === null || sec < iv.end));
}

/* Pure decision: given the stream's policy events and recent closed history
   (ascending by ts), return whether it is currently paused and any flip to
   record. Suppression itself is NOT returned per stream — rows are suppressed
   per-row at their entry time via the intervals (see isSuppressedAt), so a
   pause/resume never rewrites already-decided history. No I/O. */
export function evaluateBreaker(args: {
  events: PolicyEvent[];
  closed: ClosedSignal[]; // ascending by signal_ts, recent window
  nowSec: number;
  frozen: boolean;
}): BreakerDecision {
  const { events, closed, nowSec, frozen } = args;
  const intervals = pauseIntervals(events);
  const current = intervals.length ? intervals[intervals.length - 1] : null;
  const currentlyPaused = current !== null && current.end === null;
  const lastFlipSec = events.length
    ? Math.max(...events.map((e) => secOf(e.changed_at)))
    : null;
  const stay: BreakerDecision = { currentlyPaused, flip: null };

  // Not enough evidence to ever act — a young stream is always active.
  if (closed.length < MIN_CLOSED_TO_EVALUATE) return stay;
  // Freeze: no new actions, existing pauses persist.
  if (frozen) return stay;
  // Hysteresis: minimum trading days between flips.
  const daysSinceFlip = lastFlipSec === null ? Infinity : tradingDaysBetween(lastFlipSec, nowSec);
  if (daysSinceFlip < HYSTERESIS_TRADING_DAYS) return stay;

  const exDoubtful = (rows: ClosedSignal[]) => rows.filter((r) => r.fill_confidence !== "doubtful");

  if (!currentlyPaused) {
    const recent = exDoubtful(closed).slice(-PAUSE_WINDOW);
    const rollingPf = pf(recent.map((r) => r.pnl_usd ?? 0));
    if (rollingPf !== null && rollingPf < PAUSE_PF)
      return {
        currentlyPaused: false,
        flip: {
          action: "paused",
          reason: `rolling PF ${round2(rollingPf)} over last ${recent.length} closed (< ${PAUSE_PF})`,
          metrics: { rollingPf: round2(rollingPf), window: recent.length },
          atSec: nowSec,
        },
      };
    return stay;
  }

  // Currently paused → the silent-practice set is the closed rows whose entry
  // falls INSIDE the current (open) pause period — never retro-stamped losers.
  const inPause = exDoubtful(closed.filter((r) => current !== null && secOf(r.signal_ts) >= current.start));
  // Require a full RESUME_WINDOW of practice before judging recovery.
  if (inPause.length < RESUME_WINDOW) return stay;
  const window = inPause.slice(-RESUME_WINDOW);
  const pnls = window.map((r) => r.pnl_usd ?? 0);
  const wins = pnls.filter((p) => p > 0).length;
  const recoveryPf = pf(pnls);
  // Resume on PF ≥ 1.1, OR a zero-loss window with wins (PF is null but perfect).
  const passes = (recoveryPf !== null && recoveryPf >= RESUME_PF) || (recoveryPf === null && wins > 0);
  if (passes)
    return {
      currentlyPaused: true,
      flip: {
        action: "resumed",
        reason: `recovery ${recoveryPf === null ? "PF ∞ (no losses)" : `PF ${round2(recoveryPf)}`} over ${window.length} in-pause closed (≥ ${RESUME_PF})`,
        metrics: { recoveryPf: recoveryPf === null ? null : round2(recoveryPf), window: window.length, wins },
        atSec: nowSec,
      },
    };
  return stay;
}

const STREAM_KEYS = ["A", "B:MES", "B:MNQ"] as const;

/* Orchestration: read each stream's current policy state + closed history from
   Supabase, run the pure decision, record any flip (bot_policy row + Telegram),
   and return the suppressed state to stamp on this run's rows. Every step is
   wrapped so a breaker failure NEVER fails the engine run — on any error the
   stream defaults to active (unsuppressed) and the run continues. */
export async function applyBreakers(
  supabase: SupabaseClient,
  nowSec: number
): Promise<{ intervalsByStream: Map<string, PauseInterval[]>; pausedStreams: string[]; notes: string[] }> {
  const frozen = process.env.BOT_POLICY_FREEZE === "1";
  const intervalsByStream = new Map<string, PauseInterval[]>();
  const pausedStreams: string[] = [];
  const notes: string[] = [];

  for (const key of STREAM_KEYS) {
    try {
      // Full policy history for the stream (small table; newest-first, capped).
      const { data: pol, error: polErr } = await supabase
        .from("bot_policy")
        .select("action, changed_at")
        .eq("stream", key)
        .order("changed_at", { ascending: false })
        .range(0, 499);
      if (polErr) throw new Error(polErr.message);
      const events: PolicyEvent[] = (pol ?? [])
        .map((r) => ({ action: String(r.action), changed_at: String(r.changed_at) }))
        .reverse();

      // Most-recent closed signals for the stream (descending + range, then
      // reversed to ascending): windows of 20/15 only need the recent tail, and
      // this never blows past Supabase's 1000-row cap (finding 2).
      let q = supabase
        .from("signals")
        .select("pnl_usd, fill_confidence, signal_ts")
        .not("pnl_usd", "is", null)
        .order("signal_ts", { ascending: false })
        .range(0, 199);
      q = key === "A" ? q.eq("tier", "A") : q.eq("tier", "B").eq("symbol", key.slice(2));
      const { data: sigs, error: sigErr } = await q;
      if (sigErr) throw new Error(sigErr.message);
      const closed: ClosedSignal[] = (sigs ?? [])
        .map((r) => ({
          pnl_usd: r.pnl_usd === null ? null : Number(r.pnl_usd),
          fill_confidence: (r.fill_confidence as string | null) ?? null,
          signal_ts: String(r.signal_ts),
        }))
        .reverse();

      const decision = evaluateBreaker({ events, closed, nowSec, frozen });

      if (decision.flip) {
        const changedAt = new Date(decision.flip.atSec * 1000).toISOString();
        const { error: insErr } = await supabase.from("bot_policy").insert({
          actor: "breaker",
          stream: key,
          action: decision.flip.action,
          reason: decision.flip.reason,
          metrics: decision.flip.metrics,
          changed_at: changedAt,
        });
        if (insErr) throw new Error(`bot_policy insert: ${insErr.message}`);
        events.push({ action: decision.flip.action, changed_at: changedAt });
        const paused = decision.flip.action === "paused";
        await sendTelegram(
          `${paused ? "⏸️" : "▶️"} ${paused ? "Paused" : "Resumed"} ${streamLabel(key)}: ${decision.flip.reason}. ` +
            `${paused ? "Still simulating silently — it wins its spot back in practice." : "Back to presenting ideas."} ` +
            `<i>paper only, delayed data</i>`
        );
        notes.push(`${key} ${decision.flip.action}`);
      }

      // Final intervals (including any flip just recorded) drive per-row
      // suppression in run-live.ts — deterministic, so re-runs are idempotent.
      const intervals = pauseIntervals(events);
      intervalsByStream.set(key, intervals);
      const openNow = intervals.length && intervals[intervals.length - 1].end === null;
      if (openNow) pausedStreams.push(key);
    } catch (e) {
      intervalsByStream.set(key, []); // fail safe: no suppression on a breaker error
      notes.push(`${key} breaker_error: ${String(e instanceof Error ? e.message : e).slice(0, 80)}`);
    }
  }
  return { intervalsByStream, pausedStreams, notes };
}
