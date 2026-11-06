/* Frozen looks, shared by the AI second opinion and the AI research ideas.

   A look must be taken once, on a fixed set of decisions, and never move.
   Two things could move it: shadow trades resolve out of decision order, and
   (for the second opinion) an answer about an earlier decision can still be
   recorded up to two hours after that decision. So:

   - rows are ordered by when the DECISION was recorded (then by key);
   - the look's window is the shortest prefix with enough resolved rows and
     sessions, skipping rows that are final but excluded (void, or too large
     for the account);
   - if any row inside that prefix is still open, the look is not yet taken;
   - and not until no new row can appear before the window's end (the
     `settleSec` after its last decision: 2 h for the second opinion, 0 for
     ideas, whose rows are the decisions themselves).
   Once taken, the result is stored write-once (ai_looks) and the scoreboard
   shows the stored look; running totals are shown only as information. */

export type LookRowState = "resolved" | "open" | "excluded";

export interface LookRow {
  key: string;
  session: string;
  /** When the decision was recorded, unix seconds: the fixed order. */
  order: number;
  state: LookRowState;
}

export type LookWindow<T extends LookRow> =
  | { taken: true; rows: T[]; last: T }
  | { taken: false; waiting: string };

export function sortForLooks<T extends LookRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The window for one look, or why it cannot be taken yet. `rows` must be
    sorted with sortForLooks. */
export function lookWindow<T extends LookRow>(rows: readonly T[], minResolved: number, minSessions: number, nowSec: number, settleSec: number): LookWindow<T> {
  const window: T[] = [];
  const sessions = new Set<string>();
  let open = 0;
  for (const r of rows) {
    if (r.state === "excluded") continue;
    if (r.state === "open") { open++; continue; }
    window.push(r);
    sessions.add(r.session);
    if (window.length >= minResolved && sessions.size >= minSessions) {
      if (open > 0) return { taken: false, waiting: `${open} earlier ${open === 1 ? "decision is" : "decisions are"} still open` };
      if (nowSec < r.order + settleSec) return { taken: false, waiting: "answers about earlier decisions may still be recorded" };
      return { taken: true, rows: window, last: r };
    }
  }
  return { taken: false, waiting: `${window.length} of ${minResolved} resolved over ${sessions.size} of ${minSessions} sessions` };
}

/** A stored look (ai_looks), as read back. */
export interface StoredLook {
  look: number;
  verdict: "pass" | "fail" | "inconclusive";
  takenAt: string;
}

/** The public verdict and the next look from the stored looks only. */
export function verdictFromLooks(stored: readonly StoredLook[], lookSizes: readonly number[]): { verdict: "too-early" | "inconclusive" | "pass" | "fail"; nextLook: number | null } {
  const latest = [...stored].sort((a, b) => b.look - a.look)[0];
  if (!latest) return { verdict: "too-early", nextLook: lookSizes[0] ?? null };
  if (latest.verdict !== "inconclusive") return { verdict: latest.verdict, nextLook: null };
  return { verdict: "inconclusive", nextLook: lookSizes[latest.look] ?? null };
}

/** The next look to take (1-based), or null when the looks are over. */
export function nextLookIndex(stored: readonly StoredLook[], lookCount: number): number | null {
  const latest = [...stored].sort((a, b) => b.look - a.look)[0];
  if (!latest) return 1;
  if (latest.verdict !== "inconclusive" || latest.look >= lookCount) return null;
  return latest.look + 1;
}
