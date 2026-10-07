/* Plain words for the historical study (Learn → Historical practice).

   Two rules the copy keeps: historical results never count as fresh trading
   days, and nothing here ever touches the virtual account. "No validated
   improvement yet" is an honest result, not a fault, so it is never red.
   Too little evidence is amber; red is only for a measured loss. */

import type { HistOverview } from "@/lib/history/view";
import { PREREG } from "@/lib/experiment/prereg";
import type { Tone } from "./experiment";

export const HIST_NAME = "Historical practice";

export const HIST_LEDE =
  "The bot replays older market data from its own archive. At each idea it decides only with what it could have known then, about 25 minutes late like the live learner. It then tests up to 3 new versions against fixed controls. This never changes the virtual account and never counts as fresh trading days.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09-23" → "23 September 2026" (or without the year). */
export function dayWords(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "2026-09" → "September 2026". */
export function monthWords(ym: string | null | undefined): string {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : "—";
}

export const STUDY_STATUS_WORDS: Record<HistOverview["status"], string> = {
  registered: "Rules frozen, replay not started",
  replaying: "Replaying older data",
  replayed: "Replay finished, test not run yet",
  evaluated: "Finished",
  partial: "Paused",
  failed: "Stopped",
};

/** Why a replayed idea was left out of the learning record. */
export const EXCLUSION_WORDS: Record<string, string> = {
  "other-mode": "Counted in the other replay mode",
  "duplicate-family": "Same idea seen twice",
  "structural-void": "Could not have been traded (already over, session over or stale prices)",
  "over-risk": "One contract would risk more than $100",
  quarantined: "Near a data fault such as a gap or a contract roll",
  "label-not-ready": "Its result was not known by the cut-off",
  "no-features": "Missing its saved values",
};

export const TRIAL_STATUS_WORDS: Record<string, { label: string; tone: Tone }> = {
  registered: { label: "Waiting", tone: "dim" },
  evaluated: { label: "Measured", tone: "dim" },
  selected: { label: "Chosen for the final test", tone: "warn" },
  failed_coverage: { label: "Too little data in a test period", tone: "warn" },
  invalid: { label: "Failed its checks", tone: "bad" },
};

export const FINAL_VERDICT_WORDS: Record<string, { label: string; tone: Tone }> = {
  pass: { label: "Passed the historical test", tone: "warn" }, // amber: older, already-seen data is not proof
  inconclusive: { label: "Inconclusive", tone: "warn" },
  fail: { label: "Rejected", tone: "bad" },
  invalid: { label: "Failed its checks", tone: "bad" },
};

export function specLine(s: { windowSessions: number | null; featureSet: string; l2: number } | null | undefined): string {
  if (!s) return "—";
  const win = s.windowSessions === null ? "all past trading days" : `the last ${s.windowSessions} trading days`;
  return `Learns from ${win}, ${s.featureSet === "v2" ? "with market-context values" : "basic values"}, smoothing ${s.l2}.`;
}

/** The two headline sentences (the plan's example copy). */
export function historyHeadline(h: HistOverview | null): { first: string; second: string | null } {
  if (!h) return { first: "Historical practice has not started yet.", second: null };
  const through = dayWords(h.scope?.to, false);
  const planned = h.planned_chunks ?? 0;
  const done = h.chunks?.done ?? 0;
  let first: string;
  if (h.status === "evaluated") first = `Historical practice complete through ${through}. This result uses older market data and does not count as fresh trading days.`;
  else if (h.status === "partial") first = `Historical practice paused: ${h.status_reason ?? "waiting"}. It resumes from where it stopped.`;
  else if (h.status === "failed") first = `Historical practice stopped: ${h.status_reason ?? "unknown reason"}.`;
  else first = `Historical practice in progress: ${done} of ${planned} market-months replayed. It uses older market data and does not count as fresh trading days.`;

  let second: string | null = null;
  if (h.shadow) {
    second = h.shadow.status === "adopted"
      ? "The historical candidate passed every check on fresh ideas and now decides for the virtual account."
      : "New candidate is observing future ideas. No validated improvement yet. The current virtual account has not changed.";
  } else if (h.status === "evaluated") {
    second = h.final
      ? `No candidate was sent for fresh testing (${FINAL_VERDICT_WORDS[h.final.verdict]?.label.toLowerCase() ?? h.final.verdict}). No validated improvement yet. The current virtual account has not changed.`
      : "No version had enough data in every test period. No validated improvement yet. The current virtual account has not changed.";
  }
  return { first, second };
}

export interface ChecklistItem {
  key: "data" | "historical" | "fresh" | "validated";
  label: string;
  state: "done" | "collecting" | "open" | "waiting";
  tone: Tone;
  reason: string;
}

/** The evidence checklist (instead of a maturity score). */
export function historyChecklist(h: HistOverview | null): ChecklistItem[] {
  const g = PREREG.gates;
  const planned = h?.planned_chunks ?? 0;
  const done = h?.chunks?.done ?? 0;
  const failed = h?.chunks?.failed ?? 0;
  const replayDone = !!h && (h.status === "replayed" || h.status === "evaluated");
  const openQuestion = (h?.permissions ?? []).find((p) => p.openQuestion);
  const data: ChecklistItem = replayDone && failed === 0
    ? {
        key: "data", label: "Data ready", state: openQuestion ? "open" : "done", tone: openQuestion ? "warn" : "good",
        reason: `${done} of ${planned} market-months quality-checked; gaps and contract-roll jumps kept out, never patched.${openQuestion ? " Open question for the owner: the archive licence scope is not yet confirmed." : ""}`,
      }
    : { key: "data", label: "Data ready", state: h ? "collecting" : "waiting", tone: h ? "warn" : "dim", reason: h ? `${done} of ${planned} market-months checked so far${failed ? `, ${failed} to retry` : ""}.` : "Not started." };

  const evaluated = h?.status === "evaluated";
  const coverageFails = (h?.trials ?? []).filter((t) => t.status === "failed_coverage").length;
  const historical: ChecklistItem = evaluated
    ? {
        key: "historical", label: "Historical test complete", state: "done", tone: "good",
        reason: h!.final
          ? `All ${h!.trials.length} registered versions measured against the controls; the chosen one was tested once on the final period: ${FINAL_VERDICT_WORDS[h!.final.verdict]?.label.toLowerCase() ?? h!.final.verdict}. That period was looked at by earlier research, so it is marked "already seen".`
          : `All ${h!.trials.length} registered versions measured; ${coverageFails} had too little data in a test period. No version reached the final test.`,
      }
    : { key: "historical", label: "Historical test complete", state: "waiting", tone: "dim", reason: replayDone ? "Replay finished; the test runs next." : "Waits for the replay to finish." };

  const s = h?.shadow;
  const fresh: ChecklistItem = s
    ? {
        key: "fresh", label: "Fresh confirmation collecting", state: s.status === "adopted" ? "done" : "collecting", tone: s.status === "adopted" ? "good" : "warn",
        reason: `${s.fresh_sessions} of ${g.freshSessions} fresh trading days, ${s.fresh_closed} of ${g.freshDecisions} fresh finished ideas, ${s.reviews_passed} of 2 passing reviews. Older data counts for none of these.`,
      }
    : {
        key: "fresh", label: "Fresh confirmation collecting", state: "waiting", tone: "dim",
        reason: evaluated ? "No historical candidate qualified for fresh testing. The live learner keeps collecting its own fresh results." : "Starts only after a candidate is frozen and registered.",
      };

  const validated: ChecklistItem = s?.status === "adopted"
    ? { key: "validated", label: "Validated paper improvement", state: "done", tone: "good", reason: "Every adoption check passed on fresh ideas. This is a paper result only — never proof for real-money trading." }
    : { key: "validated", label: "Validated paper improvement", state: "waiting", tone: "dim", reason: "Not yet. Every adoption check has to pass on fresh ideas first. Even then it is a paper result, never proof for real money." };

  return [data, historical, fresh, validated];
}

/** What the final verdict means, in one or two sentences. */
export function finalExplainer(f: HistOverview["final"]): string | null {
  if (!f) return null;
  const c = f.checks ?? {};
  if (f.verdict === "pass") return "It passed every check on older data. That earns it a fresh test, not a change: it still has to pass every check on new ideas.";
  if (c.beatsIncumbent && (!c.beatsRandom || !c.beatsNoTrade))
    return "It lost less than taking every idea, because it skipped some losers. But what it kept still lost money and did no better than random picks of the same size, so skipping is not an edge.";
  if (f.verdict === "inconclusive") return "Not enough evidence either way. That earns a fresh test only; nothing changes.";
  return "It did not clear the checks on older data, so it was not sent for fresh testing.";
}

/** The next gate the historical candidate has to clear, in one sentence. */
export function nextGate(h: HistOverview | null): string {
  if (!h) return "The study has not been registered yet.";
  if (h.status !== "replayed" && h.status !== "evaluated") return "Finish replaying the older data.";
  if (h.status === "replayed") return "Run the historical test once.";
  if (!h.final) return "None: no version reached the final test. A new study would need new rules registered first.";
  if (!h.shadow) return h.final.shadow_eligible ? "Register the frozen candidate to watch fresh ideas." : "None: the candidate was rejected on the final period.";
  const s = h.shadow;
  const g = PREREG.gates;
  if (s.fresh_sessions < g.freshSessions) return `Reach ${g.freshSessions} fresh trading days (now ${s.fresh_sessions}).`;
  if (s.fresh_closed < g.freshDecisions) return `Reach ${g.freshDecisions} fresh finished ideas (now ${s.fresh_closed}).`;
  if (s.reviews_passed < 2) return `Pass ${2 - s.reviews_passed} more weekly review${2 - s.reviews_passed === 1 ? "" : "s"}, at least 6 days apart.`;
  return "Every count is met; the next weekly review decides.";
}
