/* Turn-of-the-month.
 *
 * PHASE 4 HYPOTHESIS — NOT a promoted strategy.
 *
 * SOURCE. Carchano & Pardo tested 188 calendar anomalies on index futures and
 * found turn-of-the-month the one that survived. That is a meaningfully
 * stronger starting point than the other candidates: it was found by a study
 * explicitly designed to kill calendar effects, on the asset class this app
 * trades, rather than being carried over from equities.
 *
 * WHAT THIS IMPLEMENTATION CAN AND CANNOT TEST, stated up front because the
 * gap is the main threat to reading the result:
 *
 *   The published effect is a MULTI-DAY window — roughly the last trading day
 *   of the month plus the first three of the next — held THROUGH the overnight
 *   session. This engine flattens every day at 15:25 (SESSION_EXIT_MINUTE) and
 *   has no multi-day holding path. So what runs here is the INTRADAY component
 *   only: long from the session open to the session close on turn-of-month
 *   days.
 *
 *   That matters more than it sounds. The brief's own note is that most equity
 *   drift historically accrued OVERNIGHT, not intraday — see
 *   lib/diagnostics/overnight.ts, which measures exactly that split on this
 *   archive. If turn-of-the-month is an overnight phenomenon, this intraday
 *   version should find nothing EVEN IF the effect is entirely real, and a
 *   null result here is therefore not evidence against the published finding.
 *   It is evidence about what an intraday-only system can capture.
 *
 * Long-only by default, which is what the literature describes. A short
 * variant is available but is not the hypothesis.
 */

import { nyMeta, NY_SESSION_START_MIN } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import { atr } from "@/lib/indicators";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

interface Ctx {
  /** bar index -> whether it is the session's first bar on a TOM day. */
  bySymbol: Record<string, Map<number, { dateKey: string; position: number }>>;
  atrBySymbol: Record<string, (number | null)[]>;
}

const ATR_LEN = 14;

/** Below this many sessions, a month is a data fragment, not a month. */
export const MIN_SESSIONS_PER_MONTH = 15;

/* Position of a session within the turn-of-month window, using TRADING days
   rather than calendar days: the effect is described in trading sessions, and
   a calendar-day rule would land on weekends and holidays.

   Negative = counting back from the month's last trading session (-1 is the
   last), positive = counting forward from the first (1 is the first). */
export function turnOfMonthPositions(sessions: string[]): Map<string, number> {
  const byMonth = new Map<string, string[]>();
  for (const key of sessions) {
    const month = key.slice(0, 7);
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(key);
  }
  const out = new Map<string, number>();
  const months = [...byMonth.keys()].sort();
  for (const month of months) {
    const days = byMonth.get(month)!.sort();
    /* A month is only usable if the data actually contains it. Month
       boundaries are inferred from the sessions present, so a truncated slice
       — the first or last month of any window, or an archive with gaps —
       would otherwise have its LAST AVAILABLE session labelled "month end"
       and manufacture signals on ordinary mid-month days. A real trading
       month has 18-23 sessions; anything under 15 is a fragment. */
    if (days.length < MIN_SESSIONS_PER_MONTH) continue;
    days.forEach((d, i) => {
      // Last-days get a negative index; first-days a positive one. A short
      // month could make both apply, so last-days win (they come first in the
      // published window).
      const fromEnd = days.length - i;
      if (fromEnd <= 4) out.set(d, -fromEnd);
      else if (i < 4) out.set(d, i + 1);
    });
  }
  return out;
}

function build(bars: Bar[], lastDays: number, firstDays: number) {
  const sessions = new Set<string>();
  for (const b of bars) {
    const m = nyMeta(b.time);
    if (m.minutes >= NY_SESSION_START_MIN && m.minutes < 960) sessions.add(m.dateKey);
  }
  const positions = turnOfMonthPositions([...sessions].sort());
  const perBar = new Map<number, { dateKey: string; position: number }>();
  let currentDay = "";
  for (let i = 0; i < bars.length; i++) {
    const m = nyMeta(bars[i].time);
    if (m.minutes < NY_SESSION_START_MIN || m.minutes >= 960) continue;
    if (m.dateKey === currentDay) continue; // first session bar only
    currentDay = m.dateKey;
    const position = positions.get(m.dateKey);
    if (position === undefined) continue;
    const inWindow = position < 0 ? -position <= lastDays : position <= firstDays;
    if (inWindow) perBar.set(i, { dateKey: m.dateKey, position });
  }
  return perBar;
}

export const turnOfMonth: Strategy<Ctx> = {
  id: "turn-of-month",
  name: "Turn of the month",
  blurb:
    "Phase 4 hypothesis, untested. Buy the open on the last trading days of the month and the first of the next, flat by the close. The published effect is a multi-day, overnight-inclusive one; this engine can only test its intraday component.",
  symbolMode: "single",
  params: [
    {
      key: "lastDays",
      label: "Last sessions of the month",
      type: "number",
      default: 1,
      min: 0,
      max: 4,
      step: 1,
      help: "How many sessions before month end to include. Each value is a separate trial.",
    },
    {
      key: "firstDays",
      label: "First sessions of the month",
      type: "number",
      default: 3,
      min: 0,
      max: 4,
      step: 1,
    },
    { key: "atrMult", label: "ATR stop multiple", type: "number", default: 2, min: 0.5, max: 6, step: 0.25 },
    { key: "targetR", label: "Target (R)", type: "number", default: 2, min: 0.5, max: 10, step: 0.5 },
    {
      key: "direction",
      label: "Direction",
      type: "select",
      default: "long",
      options: [
        { value: "long", label: "Long only (the published effect)" },
        { value: "both", label: "Long and short" },
      ],
    },
  ],

  prepare(series, params) {
    const lastDays = num(params.lastDays, 1);
    const firstDays = num(params.firstDays, 3);
    const bySymbol: Ctx["bySymbol"] = {};
    const atrBySymbol: Ctx["atrBySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      bySymbol[symbol] = build(bars, lastDays, firstDays);
      atrBySymbol[symbol] = atr(bars, ATR_LEN);
    }
    return { bySymbol, atrBySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    for (const v of visibleSymbols(snap)) {
      const day = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!day) continue;
      note("evaluated");
      const a = ctx.atrBySymbol[v.symbol]?.[v.index];
      if (a === null || a === undefined || !(a > 0)) {
        note("noSignal");
        continue;
      }
      const dist = num(params.atrMult, 2) * a;
      // Long-only is the published claim; "both" exists to show a short
      // variant finds nothing, not because the literature suggests it.
      const side: "LONG" | "SHORT" = "LONG";
      out.push({
        symbol: v.symbol,
        side,
        stop: v.bar.close - dist,
        target: { kind: "rMultiple", r: num(params.targetR, 2) },
        tags: {
          trigger:
            day.position < 0
              ? `${-day.position} session(s) before month end`
              : `session ${day.position} of the month`,
        },
      });
    }
    return out;
  },

  liveReadout(ctx, snap): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const day = ctx.bySymbol[v.symbol]?.get(v.index);
      rows.push({
        label: `${v.symbol} turn-of-month window`,
        value: day
          ? day.position < 0
            ? `yes — ${-day.position} before month end`
            : `yes — session ${day.position}`
          : "no",
        tone: day ? "good" : "dim",
      });
    }
    return rows;
  },
};
