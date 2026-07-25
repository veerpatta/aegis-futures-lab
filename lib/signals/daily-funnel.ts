/* Item 2.7 — "why no signal today?"

   The most common question a quiet system provokes is whether it is broken or
   just patient, and until now the honest answer took a support conversation.
   Everything needed to answer it already existed: the backtest engine tallies a
   per-day skip funnel (`skipReasonsByDay`), the breakers know which streams are
   benched, and the bar-age gate knows whether the feed stalled. None of it was
   ever surfaced for TODAY.

   The engine writes this payload to learned_stats under stat_key
   'daily_funnel' every run (no migration — the table is already versioned by
   (stat_key, date_key)), and Home renders it as one plain sentence plus a small
   table. Read-only bookkeeping: nothing here can change a signal. */

/** Per-day funnel as the engine tallied it, summed across every tier stream. */
export interface DailyFunnelPayload {
  dateKey: string; // NY trading day
  computedAt: string;
  /** Five-minute bars the engine walked today, per symbol. */
  bars: Record<string, number>;
  /** Raw skip-reason counts for today, summed across streams. */
  funnel: Record<string, number>;
  /** Per-stream status so "quiet" can be told apart from "switched off". */
  streams: {
    key: string;
    label: string;
    tier: "A" | "B";
    status: "active" | "benched" | "stale-data";
    signalsToday: number;
  }[];
  /** Set when the run was computed on bars past the age limit (item 2.4). */
  staleData: boolean;
  worstBarAgeMin: number;
}

export const DAILY_FUNNEL_STAT_KEY = "daily_funnel";

/* Plain-language names for the gates a trader actually cares about. Deliberately
   fewer and blunter than FUNNEL_LABELS: this is the "is it broken?" answer, not
   the Lab's diagnostic table. */
const PLAIN: Record<string, string> = {
  nesting: "no matching 1H zone",
  noHtf: "price nowhere near a daily or 4-hour zone",
  noTouch: "waiting for price to reach the zone",
  weakZone: "zone too weak to trade",
  notFresh: "zone already used once",
  blocked80: "blocked by the 80% rule",
  belowMinScore: "zone scored too low",
  intermarket: "the two markets disagreed",
  firstZone: "first market to the zone (skipped on purpose)",
  riskUnfit: "risk did not fit",
  invalidFill: "price gapped straight through the entry",
  noConfirm: "no confirmation candle",
  hours: "outside trading hours",
  lock: "daily discipline limit",
  news: "news lockout",
  noSignal: "no trigger",
};

/* Reasons that describe the pipeline rather than a blocked setup — they must
   never appear as a "blocker" in the sentence. */
const NOT_A_BLOCKER = new Set(["evaluated", "qualified", "refined15", "nyCaution"]);

/* `hours` and `noSignal` are true of almost every bar, so they drown the real
   answer. Kept in the table, never in the sentence. */
const TOO_LOUD_FOR_THE_SENTENCE = new Set(["hours", "noSignal", "noHtf"]);

export interface FunnelSummary {
  /** One sentence for the panel headline. */
  sentence: string;
  /** Ranked blockers for the small table: plain label + count. */
  blockers: { reason: string; label: string; count: number }[];
  /** Bars walked across all symbols. */
  barsChecked: number;
  zonesTouched: number;
  qualified: number;
  signalsToday: number;
}

/* Zones price actually reached today: every setup that got past the touch check.
   `noTouch` counts the ones still waiting, so touched = everything that reached
   a decision after the touch gate — which is qualified plus the gates that sit
   downstream of it. */
const AFTER_TOUCH = ["qualified", "noConfirm", "belowMinScore", "intermarket", "firstZone", "invalidFill"];

export function summarizeDailyFunnel(payload: DailyFunnelPayload | null): FunnelSummary {
  if (!payload)
    return {
      sentence: "Today's check has not run yet.",
      blockers: [],
      barsChecked: 0,
      zonesTouched: 0,
      qualified: 0,
      signalsToday: 0,
    };

  const f = payload.funnel;
  const barsChecked = Object.values(payload.bars).reduce((a, b) => a + b, 0);
  const qualified = f.qualified ?? 0;
  const zonesTouched = AFTER_TOUCH.reduce((a, k) => a + (f[k] ?? 0), 0);
  const signalsToday = payload.streams.reduce((a, s) => a + s.signalsToday, 0);

  const blockers = Object.entries(f)
    .filter(([reason]) => !NOT_A_BLOCKER.has(reason))
    .map(([reason, count]) => ({ reason, label: PLAIN[reason] ?? reason, count }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);

  const headline =
    `Today: ${barsChecked.toLocaleString()} bars checked · ` +
    `${zonesTouched} zone${zonesTouched === 1 ? "" : "s"} touched · ` +
    `${qualified} qualified`;

  // The "why" clause names only gates a trader can act on, and only the top few.
  const named = blockers
    .filter((b) => !TOO_LOUD_FOR_THE_SENTENCE.has(b.reason))
    .slice(0, 3)
    .map((b) => `${b.count} by ${b.label}`);

  const benched = payload.streams.filter((s) => s.status === "benched");
  const parts: string[] = [headline];
  if (signalsToday > 0)
    parts.push(`${signalsToday} idea${signalsToday === 1 ? "" : "s"} posted`);
  else if (named.length) parts.push(`nothing qualified — ${named.join(", ")}`);
  else parts.push("nothing qualified, and nothing came close");

  if (payload.staleData)
    parts.push(
      `the price feed stalled (freshest bar ${payload.worstBarAgeMin} min old), so today's ideas are flagged and left out of the scores`
    );
  if (benched.length)
    parts.push(
      `${benched.length} stream${benched.length === 1 ? " is" : "s are"} benched by the breaker`
    );

  return {
    sentence: `${parts.join(". ")}.`,
    blockers,
    barsChecked,
    zonesTouched,
    qualified,
    signalsToday,
  };
}
