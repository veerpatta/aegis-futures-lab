import { nyMeta, NY_SESSION_START_MIN } from "@/lib/time/ny";
import { etWindowLabel } from "@/lib/time/zones";
import type { Bar } from "@/lib/types";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

/* The Day Trader skill's opening-range breakout, ported as a Lab method.
 *
 * SOURCE. github.com/Jakeschincariol/day-trader-skill (MIT, commit 3d0f4ef),
 * the skills `trader-entry` (the trigger) and `trader-exit` (the stop and the
 * target). The skill pack itself lives in .claude/skills/ for Claude Code; this
 * file is the same RULE run on Aegis's own bars, engine, fills and costs.
 *
 * THE SKILL'S RULE, as written in its SKILL.md files:
 *   - Opening range = the high and low of the first 15 minutes (the 09:30,
 *     09:35 and 09:40 five-minute bars).
 *   - Trigger = the FIRST completed bar after the range that CLOSES strictly
 *     above the range high. A wick is not a trigger; a close at the high is not
 *     above it. One trigger per day: later closes do not reset it.
 *   - Long only (the skill's v2 plans longs only).
 *   - No entries before 09:45 or after 15:30 New York time.
 *   - Stop at the opening range's midpoint; target 2R (its default; the reel
 *     used 1R); flat by 15:55.
 *   - Optional volume check: the trigger bar's volume at least N times the
 *     range bars' average (off by default).
 *
 * WHAT CHANGES ON AEGIS, and why.
 *   - Markets: MES and MNQ futures, not US stocks. The skill was built and
 *     shown on single stocks; nothing says the rule transfers.
 *   - Flat by 15:25, Aegis's session exit, not 15:55. So the last trigger is
 *     the bar that opens 15:15 (closes 15:20): the engine fills on the next
 *     bar's open and must still be in before the flatten.
 *   - Fills, costs and sizing are the engine's, not the skill's "price = the
 *     trigger bar's close": next bar's open plus slippage, both sides charged.
 *   - The range must be complete (all of its bars present). A holiday or a
 *     feed gap leaves a short range, and the skill reports "2 of 3 bars"
 *     rather than trading it.
 *
 * STANDING. Unmeasured when added (2026-11-26). Aegis's own `orb` (30-minute
 * range, both sides, stop at the far side) was measured and refuted on
 * 2026-10-18. This is a DIFFERENT rule, so it gets its own id and its own
 * benchmark; it does not inherit that verdict, and it earns no trust either.
 * It goes through the weekly beat-random test and the promotion gate like
 * every other idea, never straight to a tier. */

interface DayRange {
  dateKey: string;
  high: number;
  low: number;
  mid: number;
  bars: number;
  avgVolume: number;
  complete: boolean;
  /** Bar index of the first close above the high, or null. */
  triggerIndex: number | null;
  /** True once the first close above the high happened too late to trade. */
  expired: boolean;
}

interface Ctx {
  bySymbol: Record<string, Map<number, DayRange>>;
}

const BAR_MINUTES = 5;

/* The last bar that may trigger: it must close, and the next bar's open must
   fill, before the 15:25 flatten. The skill's own cutoff (15:30) is later. */
export const DT_ORB_LAST_TRIGGER_OPEN_MIN = 15 * 60 + 15; // bar opening 15:15, closing 15:20

export function buildDayRanges(
  bars: Bar[],
  rangeMinutes: number,
  minVolumeX: number,
): Map<number, DayRange> {
  const perIndex = new Map<number, DayRange>();
  const rangeEnd = NY_SESSION_START_MIN + rangeMinutes;
  const expectedBars = Math.round(rangeMinutes / BAR_MINUTES);
  let day: DayRange | null = null;
  let volumeSum = 0;
  for (let i = 0; i < bars.length; i++) {
    const meta = nyMeta(bars[i].time);
    if (!day || day.dateKey !== meta.dateKey) {
      day = null;
      volumeSum = 0;
    }
    if (meta.minutes >= NY_SESSION_START_MIN && meta.minutes < rangeEnd) {
      if (!day) {
        day = {
          dateKey: meta.dateKey,
          high: bars[i].high,
          low: bars[i].low,
          mid: 0,
          bars: 0,
          avgVolume: 0,
          complete: false,
          triggerIndex: null,
          expired: false,
        };
      }
      day.high = Math.max(day.high, bars[i].high);
      day.low = Math.min(day.low, bars[i].low);
      day.bars += 1;
      volumeSum += bars[i].volume ?? 0;
      day.mid = (day.high + day.low) / 2;
      day.avgVolume = volumeSum / day.bars;
      day.complete = day.bars >= expectedBars;
    } else if (day && meta.minutes >= rangeEnd) {
      const undecided = day.complete && day.triggerIndex === null && !day.expired;
      if (undecided && bars[i].close > day.high) {
        const volumeOk = minVolumeX <= 0 || (bars[i].volume ?? 0) >= minVolumeX * day.avgVolume;
        if (volumeOk) {
          if (meta.minutes <= DT_ORB_LAST_TRIGGER_OPEN_MIN) day.triggerIndex = i;
          else day.expired = true;
        }
      }
    }
    if (day) perIndex.set(i, day);
  }
  return perIndex;
}

export const dayTraderOrb: Strategy<Ctx> = {
  id: "day-trader-orb",
  name: "Day Trader opening range (skill pack)",
  blurb:
    "The Day Trader skill pack's rule: mark the first 15 minutes of the New York session, buy the first 5-minute close above that range, stop at the range's middle, target 2R, flat by the close. Long only. Built for US stocks; on futures it is untested.",
  symbolMode: "single",
  params: [
    {
      key: "rangeMinutes",
      label: "Opening range",
      type: "number",
      default: 15,
      min: 15,
      max: 60,
      step: 5,
      unit: "min",
    },
    {
      key: "targetR",
      label: "Target (R)",
      type: "number",
      default: 2,
      min: 1,
      max: 4,
      step: 0.5,
      help: "The skill's default is 2R; its worked example used 1R.",
    },
    {
      key: "minVolumeX",
      label: "Volume check",
      type: "number",
      default: 0,
      min: 0,
      max: 3,
      step: 0.5,
      unit: "×",
      help: "The trigger bar's volume must be this many times the range's average bar. 0 = off, the skill's default.",
    },
    {
      key: "session",
      label: "Entry session",
      type: "select",
      default: "rth",
      options: [{ value: "rth", label: `NY session only — ${etWindowLabel("09:30", "15:25")}` }],
      help: "Fixed: the rule only exists in the New York session.",
    },
  ],

  prepare(series, params) {
    const rangeMinutes = num(params.rangeMinutes, 15);
    const minVolumeX = num(params.minVolumeX, 0);
    const bySymbol: Ctx["bySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series))
      bySymbol[symbol] = buildDayRanges(bars, rangeMinutes, minVolumeX);
    return { bySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    for (const v of visibleSymbols(snap)) {
      const day = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!day || !day.complete) continue;
      note("evaluated");
      if (day.triggerIndex !== v.index) {
        note("noSignal");
        continue;
      }
      out.push({
        symbol: v.symbol,
        side: "LONG",
        stop: day.mid,
        target: { kind: "rMultiple", r: num(params.targetR, 2) },
        tags: {
          trigger: `first close above ${day.high.toFixed(2)} (range ${day.low.toFixed(2)}–${day.high.toFixed(2)})`,
          source: "day-trader-skill",
        },
      });
    }
    return out;
  },

  liveReadout(ctx, snap): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const day = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!day) continue;
      rows.push({
        label: `${v.symbol} opening range`,
        value: day.complete
          ? `${day.low.toFixed(2)} – ${day.high.toFixed(2)} · stop ${day.mid.toFixed(2)}`
          : "forming…",
        tone: day.complete ? undefined : "dim",
      });
    }
    return rows;
  },
};
