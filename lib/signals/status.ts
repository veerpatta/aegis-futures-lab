/* One place that turns a simulated exit into a stored status, shared by the
   live engine (run-live.ts) and the shadow auditions (shadow.ts) so the two
   can never disagree.

   The bug this replaces (item 2.2): both mapped everything that was not a
   target or stop hit to "expired", which the UI renders as FLAT CLOSE. A
   strategy whose exit style is its own signal — `{kind: "signalOnly"}`, e.g.
   ema-cross on an RSI/EMA recross — has NO price target by construction, so
   `tryOpen` leaves `position.target` null and the target-hit branch can never
   fire. Every one of its exits therefore landed in "expired", including the
   profitable ones. Live evidence: 2 of ema-cross's 28 rows and 1 of orb's
   were profitable exits stamped "expired".

   Note what was NOT broken, because the brief assumed otherwise: every win
   rate in the app is computed from money (`pnl_usd > 0`) in digest-stats.ts,
   promotion.ts and learn.ts, never from the status string. The scoreboard was
   already reporting ema-cross at 0% / 14%, not "0 wins in 28". What the status
   string corrupted was the LABEL a trader reads, and the target-hit rate — a
   metric that is structurally unreachable for a targetless stream, which is
   what `targetlessStream` below refuses to dress up as a win rate. */

/** Terminal statuses a closed signal row can carry. */
export type ClosedStatus = "hit_target" | "hit_stop" | "closed_win" | "expired";

/* Exit reasons the backtest simulator emits: "target" | "stop" | "signal" |
   "session" | "windowEnd". The last three are all "closed without touching
   either bracket", so the honest split between them is the money. */
export function statusFromExit(exitReason: string, pnl: number): ClosedStatus {
  if (exitReason === "target") return "hit_target";
  if (exitReason === "stop") return "hit_stop";
  return pnl > 0 ? "closed_win" : "expired";
}

/** Every status that means "this row is finished". */
export const CLOSED_STATUSES: ReadonlySet<string> = new Set<string>([
  "hit_target",
  "hit_stop",
  "closed_win",
  "expired",
]);

/** A closed row that made money, whatever route it took out. */
export const isWinStatus = (status: string): boolean =>
  status === "hit_target" || status === "closed_win";

/* A stream with NO price target on any row cannot have a target-hit rate, and
   its win rate is not comparable with a bracketed stream's (there is no R to
   normalise by — the exit is wherever the strategy said so). Any surface that
   ranks streams side by side must say that rather than print a number that
   looks like the others. */
export const TARGETLESS_NOTE = "no target defined — win rate not meaningful";

export function targetlessStream(rows: { target_price: number | null }[]): boolean {
  return rows.length > 0 && rows.every((r) => r.target_price === null);
}

/* The label and colour a status wears on screen. One definition, shared by
   Home's recent list, the Signals blotter and the detail sheet, so the three
   surfaces can never label the same row differently. */
export type StatusTone = "good" | "bad" | "info" | "warn" | "dim";

export interface StatusLook {
  label: string;
  tone: StatusTone;
}

export function statusLook(status: string): StatusLook {
  switch (status) {
    case "hit_target":
      return { label: "TARGET HIT", tone: "good" };
    case "hit_stop":
      return { label: "STOPPED", tone: "bad" };
    case "triggered":
      return { label: "OPEN", tone: "info" };
    case "pending":
      return { label: "WAITING", tone: "warn" };
    case "closed_win":
      return { label: "CLOSED UP", tone: "good" };
    case "expired":
      return { label: "FLAT CLOSE", tone: "dim" };
    default:
      return { label: status.toUpperCase(), tone: "dim" };
  }
}
