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
  /** Set when the FEED is behind — the run read bars past the age limit. This
      says nothing about whether any row was flagged: staleness is judged per
      row (lib/signals/freshness.ts staleAtSignal), and a weekend recompute of
      well-observed rows reads a stale feed while flagging nothing. */
  staleData: boolean;
  worstBarAgeMin: number;
  /** How many of this run's rows were actually flagged stale_data. Absent on
      payloads written before the per-row fix. */
  staleRowsFlagged?: number;
}

export const DAILY_FUNNEL_STAT_KEY = "daily_funnel";

/* ── Reading the payload back ─────────────────────────────────────────────
   `learned_stats.payload` is typed `unknown` because it is jsonb, and Home
   used to reach it with a bare `payload as DailyFunnelPayload`. A cast is not
   a check: `Object.values(payload.bars)` on a row missing `bars` throws
   "Cannot convert undefined or null to object", and with no error boundary
   anywhere that TypeError blanked the entire dashboard.

   This is not a hypothetical row. The writer in run-live.ts is deliberately
   wrapped in a swallow-everything try/catch marked "must never fail a signal
   run", so a partially-written payload is the DESIGNED failure mode of the
   producer — the consumer just never accounted for it.

   Same shape as lib/signals/context.ts, which is the one place in the app
   that already read jsonb defensively. Missing fields become their empty
   values rather than throwing, so a half-written row degrades to a quiet
   panel instead of taking the page with it. */

function numberRecord(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[k] = raw;
  }
  return out;
}

function parseStreams(v: unknown): DailyFunnelPayload["streams"] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const s = raw as Record<string, unknown>;
    const status = s.status;
    return [
      {
        key: typeof s.key === "string" ? s.key : "",
        label: typeof s.label === "string" ? s.label : "",
        tier: s.tier === "A" ? ("A" as const) : ("B" as const),
        status:
          status === "benched" || status === "stale-data" || status === "active"
            ? status
            : ("active" as const),
        signalsToday: typeof s.signalsToday === "number" ? s.signalsToday : 0,
      },
    ];
  });
}

/** Null when the row is absent or too malformed to mean anything. */
export function parseDailyFunnel(raw: unknown): DailyFunnelPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  /* dateKey is the one field with no sensible default: without it the panel
     cannot tell today's funnel from an old one, which is the distinction the
     "Today:" headline depends on. */
  if (typeof p.dateKey !== "string" || !p.dateKey) return null;
  return {
    dateKey: p.dateKey,
    computedAt: typeof p.computedAt === "string" ? p.computedAt : "",
    bars: numberRecord(p.bars),
    funnel: numberRecord(p.funnel),
    streams: parseStreams(p.streams),
    staleData: p.staleData === true,
    worstBarAgeMin: typeof p.worstBarAgeMin === "number" ? p.worstBarAgeMin : 0,
    staleRowsFlagged: typeof p.staleRowsFlagged === "number" ? p.staleRowsFlagged : undefined,
  };
}

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
  stopTooTight: "stop too tight to be a real fill",
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

/* Day label for the headline. The sentence used to open with a hardcoded
   "Today:" whatever day the row was actually describing, and WhyNoSignal
   fetches the NEWEST funnel row regardless of date — so on any morning before
   the first pass, and through the whole Globex evening, "Today:" sat above
   another session's counts.

   It is also not a bug that can be fixed by fetching more carefully. Home's
   "Ideas today" counts by nyMeta().dateKey (the NY calendar day, how signals
   group) while the engine files the funnel under tradingDayKey() (the 18:00 ET
   Globex roll, so an evening pass does not file a zeroed row under Sunday).
   Between 18:00 ET and midnight those are different days ON PURPOSE, and the
   two panels sit in one viewport. The honest fix is for the sentence to say
   which session it is describing rather than to assert "today". */
function dayPrefix(payloadDay: string, todayKey: string | null | undefined): string {
  if (!todayKey || payloadDay === todayKey) return "Today";
  return payloadDay;
}

export function summarizeDailyFunnel(
  payload: DailyFunnelPayload | null,
  todayKey?: string | null
): FunnelSummary {
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
    `${dayPrefix(payload.dateKey, todayKey)}: ${barsChecked.toLocaleString()} bars checked · ` +
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

  /* Report what is actually true, which is two separate facts: the feed is
     behind, and (separately) how many rows that cost. Claiming rows were
     "flagged and left out" whenever the feed is behind was wrong — staleness is
     judged per row, so a weekend recompute reads a stale feed and flags nothing. */
  if (payload.staleData) {
    const flagged = payload.staleRowsFlagged;
    const age = `the price feed is behind (freshest bar ${payload.worstBarAgeMin} min old)`;
    if (flagged === undefined) parts.push(age);
    else if (flagged === 0)
      parts.push(`${age}, but no idea was close enough to the gap to be affected`);
    else
      parts.push(
        `${age}, so ${flagged} idea${flagged === 1 ? " is" : "s are"} flagged and left out of the scores`
      );
  }
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
