import type { Trade } from "@/lib/types";
import type { SkipEvent } from "@/lib/backtest/engine";
import { nyDateKey } from "@/lib/time/ny";
import { journalPnl, type JournalTrade } from "./index";

/* Engine-vs-journal reconciliation. Per NY day: pair up trades with the same
   symbol and side whose holding intervals overlap (±1 bar of tolerance),
   greedily by largest overlap. Whatever the engine took and you didn't is
   "missed by you"; whatever you took and the engine skipped is explained by
   the nearest skip event for that symbol. */

const PAD_SEC = 300; // one 5m bar of tolerance on the user's interval

/* Pipeline chatter that never explains WHY a specific trade was skipped. */
const NON_EXPLANATORY = new Set(["evaluated", "qualified", "refined15", "nyCaution"]);

export type MatchRow =
  | { kind: "matched"; user: JournalTrade; engine: Trade; overlapSec: number }
  | { kind: "missedByYou"; engine: Trade }
  | {
      kind: "engineSkipped";
      user: JournalTrade;
      nearestSkip: { time: number; reason: string } | null;
    };

function overlapSeconds(user: JournalTrade, engine: Trade): number {
  const start = Math.max(user.entryTime - PAD_SEC, engine.entryTime);
  const end = Math.min(user.exitTime + PAD_SEC, engine.exitTime);
  return Math.max(0, end - start);
}

export function matchDay(
  engine: Trade[],
  user: JournalTrade[],
  events?: SkipEvent[]
): MatchRow[] {
  // Globally greedy: consider every candidate pair, best overlaps first, so
  // the pairing does not depend on which user trade happens to come first.
  const pairs: { user: JournalTrade; engine: Trade; overlap: number }[] = [];
  for (const u of user)
    for (const e of engine) {
      if (e.symbol !== u.symbol || e.side !== u.side) continue;
      const overlap = overlapSeconds(u, e);
      if (overlap > 0) pairs.push({ user: u, engine: e, overlap });
    }
  pairs.sort((a, b) => b.overlap - a.overlap);

  const rows: MatchRow[] = [];
  const takenUser = new Set<JournalTrade>();
  const takenEngine = new Set<Trade>();
  for (const p of pairs) {
    if (takenUser.has(p.user) || takenEngine.has(p.engine)) continue;
    takenUser.add(p.user);
    takenEngine.add(p.engine);
    rows.push({ kind: "matched", user: p.user, engine: p.engine, overlapSec: p.overlap });
  }
  for (const u of user) {
    if (takenUser.has(u)) continue;
    let nearest: { time: number; reason: string } | null = null;
    if (events) {
      let bestDist = Infinity;
      for (const ev of events) {
        if (ev.symbol !== u.symbol || NON_EXPLANATORY.has(ev.reason)) continue;
        const dist = Math.abs(ev.time - u.entryTime);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = { time: ev.time, reason: ev.reason };
        }
      }
    }
    rows.push({ kind: "engineSkipped", user: u, nearestSkip: nearest });
  }
  for (const e of engine) if (!takenEngine.has(e)) rows.push({ kind: "missedByYou", engine: e });
  return rows.sort((a, b) => rowTime(a) - rowTime(b));
}

function rowTime(r: MatchRow): number {
  return r.kind === "missedByYou" ? r.engine.entryTime : r.user.entryTime;
}

export function matchAll(
  engine: Trade[],
  user: JournalTrade[],
  events?: SkipEvent[]
): Record<string, MatchRow[]> {
  const days = new Map<string, { engine: Trade[]; user: JournalTrade[]; events: SkipEvent[] }>();
  const bucket = (d: string) => {
    let b = days.get(d);
    if (!b) days.set(d, (b = { engine: [], user: [], events: [] }));
    return b;
  };
  for (const t of engine) bucket(nyDateKey(t.entryTime)).engine.push(t);
  for (const t of user) bucket(nyDateKey(t.entryTime)).user.push(t);
  for (const ev of events ?? []) {
    const b = days.get(ev.date);
    if (b) b.events.push(ev);
  }
  const out: Record<string, MatchRow[]> = {};
  for (const [d, b] of [...days.entries()].sort(([a], [c]) => a.localeCompare(c)))
    out[d] = matchDay(b.engine, b.user, events ? b.events : undefined);
  return out;
}

export interface MatchSummary {
  engineNet: number;
  userGross: number;
  matched: number;
  missedByYou: number;
  engineSkipped: number;
}

export function summarize(rows: MatchRow[]): MatchSummary {
  const s: MatchSummary = { engineNet: 0, userGross: 0, matched: 0, missedByYou: 0, engineSkipped: 0 };
  for (const r of rows) {
    if (r.kind === "matched") {
      s.matched++;
      s.engineNet += r.engine.pnl;
      s.userGross += journalPnl(r.user).grossPnl;
    } else if (r.kind === "missedByYou") {
      s.missedByYou++;
      s.engineNet += r.engine.pnl;
    } else {
      s.engineSkipped++;
      s.userGross += journalPnl(r.user).grossPnl;
    }
  }
  return s;
}
