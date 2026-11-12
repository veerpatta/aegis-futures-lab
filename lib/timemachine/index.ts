/* The time machine: the honest odds of one bot trade, worked out only from
   prices the bot could have known before that trading day.

   Adapted from the "trader-timemachine" Claude skill
   (github.com/Jakeschincariol/day-trader-skill, MIT) for MES/MNQ futures and
   the learner's own execution rules. Pure: no clock, no I/O. Outside the
   research-code hash on purpose — it reads the ledger, it never feeds it.

   The bot may enter from 02:00 to 15:25 New York time (lib/time/session.ts
   inEntryWindow) and is flat by 15:25, so that is the stretch replayed.

   1. The pool: every trading day before the trade's day, up to the latest 59,
      that has every five-minute bar from the trade's time of day (less two
      bars) to the 15:25 flatten bar. Holidays and early-close days are left
      out. Each bar becomes four ratios (open, high, low, close) to the bar
      before it.
   2. One replay: start at the entry price on the trade's first bar. For every
      bar left until 15:25, pick a past bar from the same time of day (± 2
      bars) at random and scale it to the current price. Like the bot: the
      stop is checked first, a bar that touches both counts as the stop, a bar
      that opens through the stop fills at that open, a target fills at the
      target price, and whatever is still open closes at the 15:25 bar's close.
   3. 10,000 replays, seeded (19 by default), so the same trade on the same
      data always gives the same numbers on any device.
   4. The past days: the same bracket (the same distances from the entry, in
      proportion) placed at the same time of day on each pool session, walked
      on the real bars. That is a matched entry at random, not the method's
      own rule: it shows what this bracket did at this hour regardless of the
      idea.

   Results are in R: +1 is a win of one risk, -1 a loss of one risk. Costs are
   not in R. It is a simulation built from about 60 days, not a prediction. */

import { nyMeta, nyTimeToUnix } from "@/lib/time/ny";
import { earlyCloseMinuteNy, isMarketHoliday } from "@/lib/market/holidays";
import { SESSION_FLAT_MINUTE } from "@/lib/signals/open-state";

export const TM_BAR_SEC = 300;
/** 02:00 New York time: the start of the bot's entry window (inEntryWindow; tests pin the two equal). */
export const TM_FIRST_MIN = 120;
/** Slots 0..160: the bars that start 02:00 … 15:20 New York time. */
export const TM_SLOTS = (SESSION_FLAT_MINUTE - TM_FIRST_MIN) / 5;
/** Rows per day in a session window: the slots plus the bar before the first. */
export const TM_BARS_PER_DAY = TM_SLOTS + 1;
export interface TmOptions {
  replays: number;
  seed: number;
  window: number;
  minSessions: number;
  maxSessions: number;
}
export const TM_DEFAULTS: Readonly<TmOptions> = Object.freeze({ replays: 10_000, seed: 19, window: 2, minSessions: 20, maxSessions: 59 });
/** Calendar days of bars to fetch so 59 sessions fit (holidays included). */
export const TM_LOOKBACK_DAYS = 95;

export interface TmBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TmPlan {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number | null;
  /** Unix seconds: the trade's first bar starts at or after this. */
  startSec: number;
}

export interface TmSession {
  dateKey: string;
  /** TM_SLOTS entries in slot order; every slot from `fromSlot` on is present. */
  bars: (TmBar | undefined)[];
  /** 4 per slot: open, high, low, close over the previous close (zeros before `fromSlot`). */
  ratios: Float64Array;
}

export type TmRefusal =
  | { kind: "bad-plan"; why: "stop-side" | "target-side" | "no-risk" }
  | { kind: "outside-session" }
  | { kind: "early-close" }
  | { kind: "few-sessions"; have: number; need: number };

export interface TmOdds {
  replays: number;
  seed: number;
  targetFirst: number;
  stopFirst: number;
  neither: number;
  green: number; // target first, or above the entry when still open at 15:25
  avgR: number;
  medianR: number;
  p5R: number;
  p95R: number;
}

export interface TmHistory {
  sessions: number;
  target: number;
  stop: number;
  neither: number;
  avgR: number;
}

export type TmLean = "no-target" | "no-hits" | "even" | "leans-target" | "leans-stop" | "strong-target" | "strong-stop";

export interface TmVerdict {
  lean: TmLean;
  /** Reward over risk, e.g. 2 for a target twice as far as the stop. */
  rr: number | null;
  /** Share of side-hitting replays that must reach the target to break even: 1 / (1 + rr). */
  need: number | null;
  /** Share of side-hitting replays that did reach the target first. */
  got: number | null;
  /** More than 40% of replays hit neither side, so the 15:25 price decides most of them. */
  manyNeither: boolean;
  /** The average R points the other way from the lean (only the "neither" replays can do that). */
  avgAgainstLean: boolean;
}

export interface TmResult {
  ok: true;
  slot: number;
  barsLeft: number;
  sessions: number;
  firstSession: string;
  lastSession: string;
  risk: number; // points
  rr: number | null;
  odds: TmOdds;
  history: TmHistory;
  verdict: TmVerdict;
}

const dirOf = (side: TmPlan["side"]) => (side === "LONG" ? 1 : -1);

/** Days per request when fetching session windows: 6 × 162 bars stays under one 1,000-row page. */
export const TM_DAYS_PER_QUERY = Math.floor(1000 / TM_BARS_PER_DAY);

/** The 01:55–15:25 New York window of every open weekday that fits wholly inside [from, to], oldest first.
 *  The time machine needs only these bars, about 56% of a full Globex day. */
export function nySessionWindows(from: number, to: number, maxDays = 120): { dateKey: string; from: number; to: number }[] {
  const out: { dateKey: string; from: number; to: number }[] = [];
  let t = Date.parse(`${nyMeta(to).dateKey}T12:00:00Z`);
  const stop = Date.parse(`${nyMeta(from).dateKey}T12:00:00Z`);
  while (t >= stop && out.length < maxDays) {
    const d = new Date(t);
    const dateKey = d.toISOString().slice(0, 10);
    t -= 86_400_000;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || isMarketHoliday(dateKey)) continue;
    const a = nyTimeToUnix(dateKey, TM_FIRST_MIN - 5);
    const b = nyTimeToUnix(dateKey, SESSION_FLAT_MINUTE);
    if (a >= from && b <= to) out.push({ dateKey, from: a, to: b });
  }
  return out.reverse();
}

/** The slot of the first bar that starts at or after `sec`, or -1 outside 02:00–15:20. */
export function slotAtOrAfter(sec: number): number {
  const start = Math.ceil(sec / TM_BAR_SEC) * TM_BAR_SEC;
  const m = nyMeta(start);
  const slot = (m.minutes - TM_FIRST_MIN) / 5;
  return Number.isInteger(slot) && slot >= 0 && slot < TM_SLOTS ? slot : -1;
}

/** One weekday's bars by slot, plus the bar before the first slot. */
export interface TmDay {
  dateKey: string;
  slots: (TmBar | undefined)[];
  prev?: TmBar;
}

/** Group bars into open, normal-length weekdays (holidays and early-close days dropped), oldest first.
 *  Done once per series; `poolFromDays` then picks each trade's pool cheaply. */
export function indexDays(bars: readonly TmBar[]): TmDay[] {
  const days = new Map<string, TmDay>();
  for (const b of bars) {
    if (![b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0)) continue;
    const m = nyMeta(b.time);
    if (m.weekday === "Sat" || m.weekday === "Sun") continue;
    const rel = m.minutes - TM_FIRST_MIN;
    if (rel !== -5 && (rel < 0 || rel % 5 !== 0 || rel / 5 >= TM_SLOTS)) continue;
    let day = days.get(m.dateKey);
    if (!day) days.set(m.dateKey, (day = { dateKey: m.dateKey, slots: new Array(TM_SLOTS) }));
    if (rel === -5) day.prev = b;
    else day.slots[rel / 5] = b;
  }
  return [...days.values()]
    .filter((d) => !isMarketHoliday(d.dateKey) && earlyCloseMinuteNy(d.dateKey) === null)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** The latest `max` days strictly before `beforeDateKey` with every bar from `fromSlot` to the flatten bar, oldest first. */
export function poolFromDays(days: readonly TmDay[], beforeDateKey: string, max: number = TM_DEFAULTS.maxSessions, fromSlot = 0): TmSession[] {
  let lo = 0, hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].dateKey < beforeDateKey) lo = mid + 1;
    else hi = mid;
  }
  const out: TmSession[] = [];
  for (let d = lo - 1; d >= 0 && out.length < max; d--) {
    const day = days[d];
    const slots = day.slots;
    let full = true;
    for (let i = fromSlot; i < TM_SLOTS; i++) if (!slots[i]) { full = false; break; }
    if (!full) continue;
    const before = fromSlot === 0 ? day.prev : slots[fromSlot - 1];
    const ratios = new Float64Array(TM_SLOTS * 4);
    let prevClose = before?.close ?? (slots[fromSlot] as TmBar).open;
    for (let i = fromSlot; i < TM_SLOTS; i++) {
      const b = slots[i] as TmBar;
      ratios[i * 4] = b.open / prevClose;
      ratios[i * 4 + 1] = b.high / prevClose;
      ratios[i * 4 + 2] = b.low / prevClose;
      ratios[i * 4 + 3] = b.close / prevClose;
      prevClose = b.close;
    }
    out.push({ dateKey: day.dateKey, bars: slots, ratios });
  }
  return out.reverse();
}

/** Trading days strictly before `beforeDateKey` with every bar from `fromSlot` to the flatten bar, oldest first, at most the latest `max`. */
export function fullSessions(bars: readonly TmBar[], beforeDateKey: string, max: number = TM_DEFAULTS.maxSessions, fromSlot = 0): TmSession[] {
  return poolFromDays(indexDays(bars), beforeDateKey, max, fromSlot);
}

/** mulberry32: a tiny seeded generator, the same sequence on every device. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome = 0 | 1 | 2; // 0 target, 1 stop, 2 neither

/** One bar against an open bracket, the bot's way. Returns the exit price, or null to stay in. */
function exitOn(d: number, o: number, h: number, l: number, stop: number, target: number | null): { px: number; out: Outcome } | null {
  const lowSide = d > 0 ? l : -h; // adverse extreme, as a long
  const highSide = d > 0 ? h : -l; // favourable extreme, as a long
  const os = d * o;
  if (os <= d * stop) return { px: o, out: 1 }; // opened through the stop: filled at the open
  if (lowSide <= d * stop) return { px: stop, out: 1 }; // stop first, also when the bar touches both
  if (target !== null && highSide >= d * target) return { px: target, out: 0 }; // resting limit at the target
  return null;
}

function checkPlan(plan: TmPlan): TmRefusal | null {
  const d = dirOf(plan.side);
  if (!(Number.isFinite(plan.entry) && Number.isFinite(plan.stop))) return { kind: "bad-plan", why: "no-risk" };
  if (d * (plan.entry - plan.stop) <= 0) return { kind: "bad-plan", why: plan.entry === plan.stop ? "no-risk" : "stop-side" };
  if (plan.target !== null && d * (plan.target - plan.entry) <= 0) return { kind: "bad-plan", why: "target-side" };
  return null;
}

const quantile = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/** The whole time machine for one trade. `bars` may include any history; only sessions before the trade's day are used. */
export function timeMachine(
  bars: readonly TmBar[],
  plan: TmPlan,
  opts: Partial<TmOptions> = {},
): TmResult | ({ ok: false } & TmRefusal) {
  return timeMachineDays(indexDays(bars), plan, opts);
}

/** The same, from days already grouped by `indexDays` (for running many trades over one series). */
export function timeMachineDays(
  days: readonly TmDay[],
  plan: TmPlan,
  opts: Partial<TmOptions> = {},
): TmResult | ({ ok: false } & TmRefusal) {
  const o = { ...TM_DEFAULTS, ...opts };
  const bad = checkPlan(plan);
  if (bad) return { ok: false, ...bad };
  const slot = slotAtOrAfter(plan.startSec);
  if (slot < 0) return { ok: false, kind: "outside-session" };
  const day = nyMeta(Math.ceil(plan.startSec / TM_BAR_SEC) * TM_BAR_SEC).dateKey;
  if (earlyCloseMinuteNy(day) !== null) return { ok: false, kind: "early-close" };
  const fromSlot = Math.max(0, slot - o.window);
  const pool = poolFromDays(days, day, o.maxSessions, fromSlot);
  if (pool.length < o.minSessions) return { ok: false, kind: "few-sessions", have: pool.length, need: o.minSessions };

  const d = dirOf(plan.side);
  const risk = Math.abs(plan.entry - plan.stop);
  const rr = plan.target === null ? null : Math.abs(plan.target - plan.entry) / risk;
  const rOf = (px: number, entry: number, r: number) => (d * (px - entry)) / r;

  // Replays.
  const rnd = seeded(o.seed);
  const counts = [0, 0, 0];
  let green = 0;
  let sumR = 0;
  const rs = new Float64Array(o.replays);
  const span = 2 * o.window + 1;
  for (let r = 0; r < o.replays; r++) {
    let price = plan.entry;
    let result: { px: number; out: Outcome } | null = null;
    for (let i = slot; i < TM_SLOTS && !result; i++) {
      const s = pool[Math.floor(rnd() * pool.length)];
      const j = Math.min(TM_SLOTS - 1, Math.max(fromSlot, i + Math.floor(rnd() * span) - o.window));
      const k = j * 4;
      // The first bar opens exactly at the entry (the fill); later bars follow the replayed close.
      const base = i === slot ? plan.entry / s.ratios[k] : price;
      const bo = i === slot ? plan.entry : base * s.ratios[k];
      const bh = Math.max(bo, base * s.ratios[k + 1]);
      const bl = Math.min(bo, base * s.ratios[k + 2]);
      const bc = base * s.ratios[k + 3];
      result = exitOn(d, bo, bh, bl, plan.stop, plan.target);
      price = bc;
    }
    const final = result ?? { px: price, out: 2 as Outcome };
    counts[final.out]++;
    const R = rOf(final.px, plan.entry, risk);
    if (final.out === 0 || (final.out === 2 && R > 0)) green++;
    rs[r] = R;
    sumR += R;
  }
  const sorted = rs.slice().sort();
  const odds: TmOdds = {
    replays: o.replays,
    seed: o.seed,
    targetFirst: counts[0] / o.replays,
    stopFirst: counts[1] / o.replays,
    neither: counts[2] / o.replays,
    green: green / o.replays,
    avgR: sumR / o.replays,
    medianR: quantile(sorted, 0.5),
    p5R: quantile(sorted, 0.05),
    p95R: quantile(sorted, 0.95),
  };

  // The same bracket on each past session's real bars.
  const history: TmHistory = { sessions: pool.length, target: 0, stop: 0, neither: 0, avgR: 0 };
  let histR = 0;
  for (const s of pool) {
    const e = (s.bars[slot] as TmBar).open;
    const scale = e / plan.entry;
    const stop = plan.stop * scale;
    const target = plan.target === null ? null : plan.target * scale;
    const r0 = risk * scale;
    let res: { px: number; out: Outcome } | null = null;
    for (let i = slot; i < TM_SLOTS && !res; i++) {
      const b = s.bars[i] as TmBar;
      res = exitOn(d, i === slot ? e : b.open, b.high, b.low, stop, target);
    }
    const fin = res ?? { px: (s.bars[TM_SLOTS - 1] as TmBar).close, out: 2 as Outcome };
    if (fin.out === 0) history.target++;
    else if (fin.out === 1) history.stop++;
    else history.neither++;
    histR += rOf(fin.px, e, r0);
  }
  history.avgR = histR / pool.length;

  return {
    ok: true,
    slot,
    barsLeft: TM_SLOTS - slot,
    sessions: pool.length,
    firstSession: pool[0].dateKey,
    lastSession: pool[pool.length - 1].dateKey,
    risk,
    rr,
    odds,
    history,
    verdict: verdictOf(odds, rr),
  };
}

/** One honest line from the numbers, as in the skill: compare the target's share of side-hitting replays with break-even. */
export function verdictOf(odds: Pick<TmOdds, "targetFirst" | "stopFirst" | "neither" | "avgR">, rr: number | null): TmVerdict {
  const manyNeither = odds.neither > 0.4;
  if (rr === null) return { lean: "no-target", rr, need: null, got: null, manyNeither, avgAgainstLean: false };
  const hit = odds.targetFirst + odds.stopFirst;
  const need = 1 / (1 + rr);
  if (hit <= 0) return { lean: "no-hits", rr, need, got: null, manyNeither, avgAgainstLean: false };
  const got = odds.targetFirst / hit;
  const gap = (got - need) * 100;
  const lean: TmLean = Math.abs(gap) < 5 ? "even" : gap > 0 ? (gap >= 15 ? "strong-target" : "leans-target") : gap <= -15 ? "strong-stop" : "leans-stop";
  const avgAgainstLean = (lean.endsWith("target") && odds.avgR < 0) || (lean.endsWith("stop") && odds.avgR > 0);
  return { lean, rr, need, got, manyNeither, avgAgainstLean };
}
