/* Plain words for the free AI helper (docs/AI-HELPER.md, plan
   docs/superpowers/plans/2026-11-07-free-ai-and-ui-revamp.md).

   The AI gives a second opinion on each idea the bot decides. It never changes
   a trade: the study scores its calls against "take every idea", random picks
   of the same size and "no trade", after costs, under rules written before the
   first call (docs/research/2026-11-07-ai-second-opinion-preregistration.md).

   The honesty rules of docs/design-language.md apply: too little evidence is
   amber, never red, and no rate is shown without its n. Pure; pinned by
   tests/plain-ai.test.ts. */

export type AiVerdict = "too-early" | "inconclusive" | "pass" | "fail";
export type AiTone = "amber" | "green" | "red";

export interface AiStudyScore {
  id: string;
  label: string;
  model: string;
  status: "active" | "waiting-for-model";
  startedAt: string | null;
  calls: number;
  resolved: number;
  taken: number;
  skipped: number;
  sessions: number;
  aiNet: number;
  takeAllNet: number;
  randomPercentile: number | null;
  delta: { est: number; lo: number; hi: number } | null;
  verdict: AiVerdict;
  nextLook: 60 | 150 | null;
}

export interface AiCall {
  decisionKey: string;
  studyId: string;
  model: string;
  decision: "take" | "skip";
  confidence: number;
  reason: string;
  calledAt: string;
}

export interface AiNote {
  kind: "trade" | "day" | "week";
  subject: string;
  text: string;
  model: string;
  createdAt: string;
}

/** The first fair look needs this many finished calls over this many trading days. */
export const AI_FIRST_LOOK = { resolved: 60, sessions: 15 } as const;

export const AI_VERDICT_WORDS: Record<AiVerdict, { label: string; tone: AiTone; detail: string }> = {
  "too-early": {
    label: "Too early to tell",
    tone: "amber",
    detail: `The first fair check needs ${AI_FIRST_LOOK.resolved} finished calls over ${AI_FIRST_LOOK.sessions} trading days.`,
  },
  inconclusive: {
    label: "No clear answer yet",
    tone: "amber",
    detail: "Its picks were neither clearly better nor clearly worse than the alternatives. The study carries on.",
  },
  pass: {
    label: "Passed its check",
    tone: "green",
    detail: "Its picks beat taking every idea and random picks, after costs. You may choose to let it filter trades in a new campaign.",
  },
  fail: {
    label: "Did worse",
    tone: "red",
    detail: "Its picks did worse than the alternatives, so it does not get to filter the bot's trades.",
  },
};

const MODEL_NAMES: Record<string, string> = {
  "moonshotai/kimi-k3.1-pro": "Kimi K3.1 Pro",
  "moonshotai/kimi-k2.6": "Kimi K2.6",
  "nvidia/nemotron-3-ultra-550b-a55b": "Nemotron 3 Ultra",
  "google/gemma-4-31b-it": "Gemma 4",
};

/** "nvidia/nemotron-3-ultra-550b-a55b" → "Nemotron 3 Ultra". */
export function aiModelName(model: string | null | undefined): string {
  if (!model) return "AI";
  return MODEL_NAMES[model] ?? model.split("/").at(-1) ?? model;
}

/** "Would skip it · 85% sure". */
export function aiCallWords(call: Pick<AiCall, "decision" | "confidence">): string {
  const sure = Number.isFinite(call.confidence) ? ` · ${Math.round(Math.min(100, Math.max(0, call.confidence)))}% sure` : "";
  return `${call.decision === "take" ? "Would take it" : "Would skip it"}${sure}`;
}

/** Whether the AI agreed with what the bot did. */
export function aiAgreement(call: Pick<AiCall, "decision">, botAction: "take" | "skip"): string {
  return call.decision === botAction ? "Agrees with the bot" : botAction === "take" ? "The bot took it anyway" : "The bot skipped it anyway";
}

/** Progress toward the next fair look, with its n. */
export function aiProgress(s: Pick<AiStudyScore, "resolved" | "sessions" | "nextLook" | "calls">): string {
  const target = s.nextLook ?? AI_FIRST_LOOK.resolved;
  const head = `${s.resolved} of ${target} finished calls`;
  if (s.nextLook === null) return `${s.calls} calls · ${s.resolved} finished · all checks done`;
  return s.nextLook === AI_FIRST_LOOK.resolved
    ? `${head} · ${Math.min(s.sessions, AI_FIRST_LOOK.sessions)} of ${AI_FIRST_LOOK.sessions} trading days`
    : `${head} for the final check`;
}

/** One line for the Today card. */
export function aiSummaryLine(s: AiStudyScore | null): string {
  if (!s) return "AI second opinion: not running yet";
  if (s.status === "waiting-for-model") return `${aiModelName(s.model)}: waiting for NVIDIA to switch it on`;
  if (s.calls === 0) return `AI second opinion (${aiModelName(s.model)}): waiting for the next idea`;
  return `AI second opinion: ${AI_VERDICT_WORDS[s.verdict].label.toLowerCase()} · ${s.calls} call${s.calls === 1 ? "" : "s"}, ${s.resolved} finished`;
}

export interface AiComparisonLine {
  label: string;
  value: string;
  tone: "good" | "bad" | "dim" | "amber";
  note?: string;
}

/** The three-way comparison, money already masked by the caller's formatter. */
export function aiComparison(s: AiStudyScore, money: (n: number) => string): AiComparisonLine[] {
  const early = s.verdict === "too-early";
  const tone = (n: number): AiComparisonLine["tone"] => (early ? "amber" : n > 0 ? "good" : n < 0 ? "bad" : "dim");
  const lines: AiComparisonLine[] = [
    { label: "Following the AI", value: money(s.aiNet), tone: tone(s.aiNet), note: `took ${s.taken} of ${s.resolved} finished ideas` },
    { label: "Taking every idea", value: money(s.takeAllNet), tone: tone(s.takeAllNet), note: `n=${s.resolved}` },
  ];
  lines.push(
    s.randomPercentile === null || s.taken === 0
      ? { label: "Random picks of the same size", value: "—", tone: "dim", note: "needs at least one AI pick" }
      : {
          label: "Random picks of the same size",
          value: `beat ${Math.round(s.randomPercentile)}% of them`,
          tone: early ? "amber" : s.randomPercentile >= 95 ? "good" : s.randomPercentile < 50 ? "bad" : "dim",
          note: `n=${s.taken}`,
        },
  );
  return lines;
}

/** The study that should speak for the AI on a screen: a running Kimi study
    first (the owner asked for Kimi), then any running one, then a waiting one. */
export function primaryStudy(studies: readonly AiStudyScore[]): AiStudyScore | null {
  const active = studies.filter((s) => s.status === "active");
  return active.find((s) => s.model.startsWith("moonshotai/") && s.calls > 0) ?? active[0] ?? studies[0] ?? null;
}

/** The newest call on a decision, preferring the primary study's model. */
export function callForDecision(calls: readonly AiCall[], decisionKey: string, preferStudy?: string | null): AiCall | null {
  const mine = calls.filter((c) => c.decisionKey === decisionKey);
  if (!mine.length) return null;
  return (preferStudy && mine.find((c) => c.studyId === preferStudy)) || [...mine].sort((a, b) => b.calledAt.localeCompare(a.calledAt))[0];
}

/** Why AI words are shown only to the signed-in owner. */
export const AI_OWNER_ONLY =
  "AI-written words are shown only to the signed-in owner: NVIDIA's free key is for testing and evaluation, and its terms do not allow sharing AI text with the public.";

/* ── AI research ideas (docs/research/2026-11-07-ai-ideas-preregistration.md) ──
   Each week the AI may propose up to three simple skip rules. The app tests
   each one only on decisions made after it was proposed, against taking every
   idea and random skips of the same size, after costs. A rule that passes is
   only eligible for a future campaign the owner starts; nothing changes the
   account. The rule's wording is AI-written, so it is shown to the owner only;
   everyone sees the numbers. */

export type IdeaField =
  | "side" | "symbol" | "strategy" | "tier" | "paused" | "regime" | "vix_bucket"
  | "rr" | "atr_pct" | "vwap_atr" | "risk_usd" | "hour_ny" | "weekday";

export interface AiIdeaCondition { field: IdeaField | string; op: "<" | ">" | "=" | "!="; value: string | number | boolean }

/** Owner-only: what the rule says. */
export interface AiIdea { id: string; name: string; why: string; when: AiIdeaCondition[]; proposedAt: string; model: string }

/** Public: how the rule is doing on fresh decisions, numbers only. */
export interface AiIdeaScore {
  id: string;
  proposedAt: string;
  model: string;
  status: "testing" | "retired";
  tested: number;
  resolved: number;
  skipped: number;
  sessions: number;
  keptNet: number;
  takeAllNet: number;
  delta: { est: number; lo: number; hi: number } | null;
  randomPercentile: number | null;
  verdict: AiVerdict;
  nextLook: 60 | 150 | null;
}

export const IDEA_VERDICT_WORDS: Record<AiVerdict, { label: string; tone: AiTone; detail: string }> = {
  "too-early": { label: "Too early to tell", tone: "amber", detail: "It needs 60 finished trades made after it was proposed, over 15 trading days." },
  inconclusive: { label: "No clear answer yet", tone: "amber", detail: "Skipping these ideas has not clearly helped or hurt. The test carries on." },
  pass: { label: "Improved results", tone: "green", detail: "On fresh trades, skipping these ideas beat taking every idea and random skips, after costs. You may add it to a new campaign." },
  fail: { label: "Made results worse", tone: "red", detail: "On fresh trades it skipped more winners than losers, so it is dropped." },
};

const REGIME_WORDS: Record<string, string> = {
  "trend-high-vol": "trending with big swings", "trend-low-vol": "trending calmly",
  "range-high-vol": "going sideways with big swings", "range-low-vol": "going sideways calmly",
};
const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const METHOD_WORDS: Record<string, string> = { "zone-v5": "Zone setups", "rsi-reversion": "RSI reversion" };
const toNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
const OP_WORDS: Record<AiIdeaCondition["op"], string> = { "<": "below", ">": "above", "=": "exactly", "!=": "not" };

/** One condition of an AI rule in plain words, e.g. "the bot would sell (bet on a fall)". */
export function ideaConditionWords(c: AiIdeaCondition): string {
  const yes = c.op === "=", no = c.op === "!=";
  const v = toNumber(c.value), op = OP_WORDS[c.op];
  switch (c.field) {
    case "side": {
      const sell = String(c.value).toUpperCase() === "SHORT";
      return (yes ? sell : !sell) ? "the bot would sell (bet on a fall)" : "the bot would buy (bet on a rise)";
    }
    case "symbol":
      return `the market is ${no ? "not " : ""}the ${String(c.value) === "MNQ" ? "Nasdaq micro" : "S&P micro"}`;
    case "strategy":
      return `the method is ${no ? "not " : ""}${METHOD_WORDS[String(c.value)] ?? String(c.value)}`;
    case "tier":
      return `the idea is ${no ? "not " : ""}a ${String(c.value) === "A" ? "zone setup" : "daily-flow idea"}`;
    case "paused": {
      const paused = String(c.value) === "true";
      return (yes ? paused : !paused) ? "its method is paused after a losing streak" : "its method is not paused";
    }
    case "regime":
      return `the market is ${no ? "not " : ""}${REGIME_WORDS[String(c.value)] ?? String(c.value).replace(/-/g, " ")}`;
    case "vix_bucket":
      return `the fear index (VIX) is ${no ? "not " : ""}${String(c.value)}`;
    case "rr":
      return `the possible gain is ${op} ${v} times the possible loss`;
    case "atr_pct":
      return `recent swings are ${op} ${v}% of the price`;
    case "vwap_atr":
      if (c.op === ">") return v >= 0 ? `price is more than ${v} typical swings above the day's average price` : `price is above ${v} typical swings from the day's average price`;
      if (c.op === "<") return v <= 0 ? `price is more than ${Math.abs(v)} typical swings below the day's average price` : `price is less than ${v} typical swings above the day's average price`;
      return `the distance from the day's average price is ${op} ${v} typical swings`;
    case "risk_usd":
      return `one contract risks ${op} $${v}`;
    case "hour_ny":
      return c.op === ">" ? `it is after ${v}:00 New York time` : c.op === "<" ? `it is before ${v}:00 New York time` : `the hour is ${op} ${v}:00 New York time`;
    case "weekday":
      return `it is ${no ? "not " : ""}a ${WEEKDAYS[v] ?? String(c.value)}`;
    default:
      return `${c.field} is ${op} ${String(c.value)}`;
  }
}

/** "Skip the idea when the bot would sell (bet on a fall) and price is more than 3 typical swings above the day's average price." */
export function ideaRuleWords(idea: Pick<AiIdea, "when">): string {
  const parts = idea.when.map(ideaConditionWords);
  if (!parts.length) return "—";
  return `Skip the idea when ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.`;
}

/** Progress of one rule's fresh test, with its n. */
export function ideaProgress(s: Pick<AiIdeaScore, "resolved" | "sessions" | "skipped" | "nextLook" | "status">): string {
  if (s.status === "retired" || s.nextLook === null) return `${s.resolved} fresh trades tested · finished`;
  const head = `${s.resolved} of ${s.nextLook} fresh trades tested · it would have skipped ${s.skipped}`;
  return s.nextLook === 60 ? `${head} · ${Math.min(s.sessions, 15)} of 15 trading days` : head;
}
