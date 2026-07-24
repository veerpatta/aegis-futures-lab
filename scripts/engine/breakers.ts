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
  suppressed: boolean;
  signal_ts: string;
}

export interface BreakerDecision {
  suppressed: boolean; // state to stamp on this run's rows for the stream
  flip: null | {
    action: "paused" | "resumed";
    reason: string;
    metrics: Record<string, unknown>;
  };
}

const pf = (pnls: number[]) => profitFactor(pnls);
const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/* Pure decision: given a stream's closed-signal history (ascending by ts),
   its current paused state and last flip time, return the resulting suppressed
   state and any flip to record. No I/O. */
export function evaluateBreaker(args: {
  currentlyPaused: boolean;
  lastFlipSec: number | null;
  closed: ClosedSignal[]; // ascending by signal_ts
  nowSec: number;
  frozen: boolean;
}): BreakerDecision {
  const { currentlyPaused, lastFlipSec, closed, nowSec, frozen } = args;
  const stay: BreakerDecision = { suppressed: currentlyPaused, flip: null };

  // Not enough evidence to ever act — a young stream is always active.
  if (closed.length < MIN_CLOSED_TO_EVALUATE) return { suppressed: currentlyPaused, flip: null };
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
        suppressed: true,
        flip: {
          action: "paused",
          reason: `rolling PF ${round2(rollingPf)} over last ${recent.length} closed (< ${PAUSE_PF})`,
          metrics: { rollingPf: round2(rollingPf), window: recent.length },
        },
      };
    return { suppressed: false, flip: null };
  }

  // Currently paused → check the silent (suppressed) simulation for recovery.
  const suppressedClosed = exDoubtful(closed.filter((r) => r.suppressed)).slice(-RESUME_WINDOW);
  const recoveryPf = pf(suppressedClosed.map((r) => r.pnl_usd ?? 0));
  if (recoveryPf !== null && suppressedClosed.length >= 1 && recoveryPf >= RESUME_PF)
    return {
      suppressed: false,
      flip: {
        action: "resumed",
        reason: `recovery PF ${round2(recoveryPf)} over last ${suppressedClosed.length} suppressed closed (≥ ${RESUME_PF})`,
        metrics: { recoveryPf: round2(recoveryPf), window: suppressedClosed.length },
      },
    };
  return { suppressed: true, flip: null };
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
): Promise<{ suppressedByStream: Map<string, boolean>; notes: string[] }> {
  const frozen = process.env.BOT_POLICY_FREEZE === "1";
  const out = new Map<string, boolean>();
  const notes: string[] = [];

  for (const key of STREAM_KEYS) {
    try {
      const { data: pol, error: polErr } = await supabase
        .from("bot_policy")
        .select("action, changed_at")
        .eq("stream", key)
        .order("changed_at", { ascending: false })
        .limit(1);
      if (polErr) throw new Error(polErr.message);
      const last = pol?.[0] as { action: string; changed_at: string } | undefined;
      const currentlyPaused = last ? last.action === "paused" : false;
      const lastFlipSec = last ? Math.floor(Date.parse(last.changed_at) / 1000) : null;

      let q = supabase
        .from("signals")
        .select("pnl_usd, fill_confidence, suppressed, signal_ts")
        .not("pnl_usd", "is", null)
        .order("signal_ts", { ascending: true });
      q = key === "A" ? q.eq("tier", "A") : q.eq("tier", "B").eq("symbol", key.slice(2));
      const { data: sigs, error: sigErr } = await q;
      if (sigErr) throw new Error(sigErr.message);
      const closed: ClosedSignal[] = (sigs ?? []).map((r) => ({
        pnl_usd: r.pnl_usd === null ? null : Number(r.pnl_usd),
        fill_confidence: (r.fill_confidence as string | null) ?? null,
        suppressed: Boolean(r.suppressed),
        signal_ts: String(r.signal_ts),
      }));

      const decision = evaluateBreaker({ currentlyPaused, lastFlipSec, closed, nowSec, frozen });
      out.set(key, decision.suppressed);

      if (decision.flip) {
        const { error: insErr } = await supabase.from("bot_policy").insert({
          actor: "breaker",
          stream: key,
          action: decision.flip.action,
          reason: decision.flip.reason,
          metrics: decision.flip.metrics,
        });
        if (insErr) throw new Error(`bot_policy insert: ${insErr.message}`);
        const paused = decision.flip.action === "paused";
        await sendTelegram(
          `${paused ? "⏸️" : "▶️"} ${paused ? "Paused" : "Resumed"} ${streamLabel(key)}: ${decision.flip.reason}. ` +
            `${paused ? "Still simulating silently — it wins its spot back in practice." : "Back to presenting ideas."} ` +
            `<i>paper only, delayed data</i>`
        );
        notes.push(`${key} ${decision.flip.action}`);
      }
    } catch (e) {
      out.set(key, false); // fail safe: never suppress on a breaker error
      notes.push(`${key} breaker_error: ${String(e instanceof Error ? e.message : e).slice(0, 80)}`);
    }
  }
  return { suppressedByStream: out, notes };
}
