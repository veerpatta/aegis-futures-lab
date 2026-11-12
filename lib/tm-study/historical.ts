/* The historical time machine filter test (tm-filter-v1), pure: bars and the
   stored study rows in, calls and one look out. No clock, no I/O.

   1. Regenerate: each (symbol, month) chunk of the registered study is rebuilt
      from the same archive window with the study's own code (checkBars,
      streamIdeas, replayIdea), so every eligible row gets its idea's exact
      stop and target. A regenerated outcome that differs from the stored one
      is a mismatch; any mismatch stops the test before scoring.
   2. Call: the filter runs on each eligible row with the learner's reference
      price at that row's decision time and a pool of archive days before it
      (days touching a flagged data-fault window left out).
   3. Score: one look on every row (lib/tm-study/score.ts). */

import type { Bar } from "@/lib/types";
import type { Opportunity } from "@/lib/experiment/types";
import { HIST_RULES } from "@/lib/history/rules";
import { checkBars, type FlaggedWindow } from "@/lib/history/quality";
import { monthBounds, replayIdea, sessionOf, streamIdeas, type ContextRowLike, type ReplayExample } from "@/lib/history/replay";
import { indexDays, type TmDay } from "@/lib/timemachine";
import { nyMeta } from "@/lib/time/ny";
import { filterCallDays, type FilterCall } from "./filter";
import { historicalLook, type TmLookResult, type TmRow } from "./score";

const DAY = 86_400;
const BAR = 300;

export interface Eligible {
  /** `${mode}:${familyId}`, as in the study dataset. */
  key: string;
  example: ReplayExample;
}

export interface Regenerated {
  key: string;
  op: Opportunity;
  example: ReplayExample;
  refPrice: number | null;
}

export interface Mismatch {
  key: string;
  why: string;
}

const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-6);

/** Compare the outcome fields a regenerated example must reproduce. */
export function mismatchOf(stored: ReplayExample, fresh: ReplayExample): string | null {
  if (stored.decidedAt !== fresh.decidedAt) return "decision time";
  if (stored.outcomeStatus !== fresh.outcomeStatus) return "outcome status";
  if (!same(stored.fillTs, fresh.fillTs) || !same(stored.fillPrice, fresh.fillPrice)) return "fill";
  if (!same(stored.exitTs, fresh.exitTs) || !same(stored.exitPrice, fresh.exitPrice) || stored.exitReason !== fresh.exitReason) return "exit";
  if (!same(stored.netPc, fresh.netPc)) return "result";
  return null;
}

/** The learner's reference price at a decision: the close of the last bar closed by then (as replayIdea feeds stepTick). */
export function refPriceAt(bars: readonly Bar[], decidedAt: number): number | null {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time + BAR <= decidedAt) lo = mid + 1;
    else hi = mid;
  }
  const last = bars[lo - 1];
  return last && last.time >= decidedAt - 3 * DAY ? last.close : null;
}

/** Rebuild one chunk's eligible ideas from the archive window the study read. */
export function regenerateChunk(input: {
  raw: Bar[]; symbol: "MES" | "MNQ"; month: string; ctx: ContextRowLike[]; lagSec: number; eligible: ReadonlyMap<string, Eligible>;
}): { found: Regenerated[]; mismatches: Mismatch[] } {
  const { clean, report } = checkBars(input.raw, input.symbol, HIST_RULES);
  const { start, end } = monthBounds(input.month);
  const found: Regenerated[] = [];
  const mismatches: Mismatch[] = [];
  for (const op of streamIdeas(clean, input.symbol, start, end, input.ctx)) {
    const key = `${HIST_RULES.primaryMode}:${op.key}`;
    const e = input.eligible.get(key);
    if (!e) continue;
    const fresh = replayIdea(op, clean, HIST_RULES.primaryMode, input.lagSec, input.month, report.windows, HIST_RULES);
    const why = mismatchOf(e.example, fresh);
    if (why) mismatches.push({ key, why });
    else found.push({ key, op, example: e.example, refPrice: refPriceAt(clean, e.example.decidedAt) });
  }
  return { found, mismatches };
}

/** The archive window a chunk read (month, 60 days of warm-up, 2-day tail). */
export function chunkWindow(month: string): { from: number; to: number } {
  const { start, end } = monthBounds(month);
  return { from: start - HIST_RULES.warmupDays * DAY, to: end + HIST_RULES.tailDays * DAY };
}

/** Pool days for one symbol: the whole archive cleaned once, without any day that touches a flagged window. */
export function poolDays(raw: Bar[], symbol: "MES" | "MNQ"): { days: TmDay[]; flaggedDays: number } {
  const { clean, report } = checkBars(raw, symbol, HIST_RULES);
  const bad = new Set<string>();
  // Every New York date the window (with the study's 1-hour lead and the same lag after) touches.
  for (const w of report.windows as FlaggedWindow[]) {
    const from = w.from - HIST_RULES.quality.quarantineLeadSec, to = w.to + HIST_RULES.quality.quarantineLeadSec;
    for (let t = from; t < to; t += 3600) bad.add(nyMeta(t).dateKey);
    bad.add(nyMeta(to).dateKey);
  }
  const days = indexDays(clean).filter((d) => !bad.has(d.dateKey));
  return { days, flaggedDays: bad.size };
}

export interface HistoricalCall {
  key: string;
  decidedAt: number;
  call: FilterCall;
}

/** The filter's call for each regenerated idea. */
export function callAll(found: readonly Regenerated[], daysBySymbol: Record<"MES" | "MNQ", TmDay[]>): HistoricalCall[] {
  return found.map((f) => {
    const e = f.example;
    const call: FilterCall = f.refPrice === null
      ? { ok: false, skip: false, refusal: "no-reference-price" }
      : filterCallDays(daysBySymbol[e.symbol as "MES" | "MNQ"], { symbol: e.symbol as "MES" | "MNQ", side: e.side, stop: f.op.stop, target: f.op.target, refPrice: f.refPrice, decidedAt: e.decidedAt });
    return { key: f.key, decidedAt: e.decidedAt, call };
  });
}

/** Rows for the scorer, in decision order; the result is the one-contract result after costs. */
export function scoreRows(calls: readonly HistoricalCall[], found: readonly Regenerated[]): TmRow[] {
  const byKey = new Map(found.map((f) => [f.key, f]));
  return calls
    .map((c) => {
      const e = byKey.get(c.key)!.example;
      return { key: c.key, session: sessionOf(e.signalTs), order: e.decidedAt, state: "resolved" as const, skip: c.call.skip, net: e.netPc };
    })
    .sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : 1));
}

export interface Breakdown {
  ideas: number;
  skipped: number;
  keptNet: number;
  skippedNet: number;
}

/** Descriptive splits (not part of the verdict): by symbol, strategy and year. */
export function breakdowns(rows: readonly TmRow[], found: readonly Regenerated[]): Record<string, Record<string, Breakdown>> {
  const byKey = new Map(found.map((f) => [f.key, f.example]));
  const out: Record<string, Record<string, Breakdown>> = { symbol: {}, strategy: {}, year: {} };
  for (const r of rows) {
    const e = byKey.get(r.key)!;
    for (const [dim, v] of [["symbol", e.symbol], ["strategy", e.strategy], ["year", nyMeta(e.decidedAt).dateKey.slice(0, 4)]] as const) {
      const b = (out[dim][v] ??= { ideas: 0, skipped: 0, keptNet: 0, skippedNet: 0 });
      b.ideas++;
      if (r.skip) { b.skipped++; b.skippedNet += r.net ?? 0; } else b.keptNet += r.net ?? 0;
    }
  }
  for (const dim of Object.values(out)) for (const b of Object.values(dim)) { b.keptNet = Math.round(b.keptNet * 100) / 100; b.skippedNet = Math.round(b.skippedNet * 100) / 100; }
  return out;
}

export function scoreHistorical(rows: readonly TmRow[], studyId: string): TmLookResult {
  return historicalLook(rows, studyId);
}
