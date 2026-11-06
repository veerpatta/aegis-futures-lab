/* One pass of the AI research ideas, inside POST /api/ai/run:
   1. score every testing rule on the decisions recorded since it was proposed,
      and retire it when the preregistered rules say so (no AI call);
   2. once a week, if a slot is free and enough decisions have finished, ask
      the AI for new skip rules and a short summary of what it noticed.
   Nothing here changes the account, the learner or the methods. */

import type { ChatRequest, ChatResult } from "@/lib/ai-free/nvidia";
import { DEEPSEEK_V41_FLASH, FreeAiError, GEMMA_4, KIMI_K26, KIMI_K31_PRO, NEMOTRON_ULTRA } from "@/lib/ai-free/nvidia";
import { cleanText } from "@/lib/ai-free/text";
import { stableHash } from "@/lib/experiment/hash";
import { nyMeta } from "@/lib/time/ny";
import { callTimeout, canCall, type RunBudget } from "@/lib/ai-judge/runner";
import type { CoachNote } from "@/lib/ai-coach/runner";
import type { LookRowState, StoredLook } from "@/lib/ai-judge/looks";
import { matches, ruleHash, type DecisionFields, type Rule } from "./dsl";
import { factsTable, type FinishedDecision } from "./facts";
import { parseProposal, proposalSystem, proposalUser } from "./propose";
import { IDEAS_PROMPT_VERSION, IDEAS_RULES } from "./rules";
import { dueIdeaLook, retireReason, type IdeaLookResult, type IdeaRow } from "./score";

/* The proposal is the longest answer the helper asks for. On 2026-11-07
   Nemotron 3 Ultra needed about 49 s for it (it reasons first) and Gemma 4
   about 19 s, inside a 60 s function that caps each call at 40 s. So after
   Kimi, the faster models are asked first; the model is recorded with each
   rule. DeepSeek V4.1 Flash is asked only once it has answered (probation,
   lib/ai-free/health.ts). */
export const PROPOSAL_MODELS: readonly string[] = Object.freeze([KIMI_K31_PRO, KIMI_K26, DEEPSEEK_V41_FLASH, GEMMA_4, NEMOTRON_ULTRA]);

export interface HypothesisRow {
  id: string;
  /** Unix seconds. */
  proposedAt: number;
  model: string;
  promptVersion: string;
  rule: Rule;
  ruleHash: string;
  status: "testing" | "retired";
  retiredAt: number | null;
  retireReason: string | null;
}
export interface PopulationRow {
  key: string;
  session: string;
  /** When the decision was recorded, unix seconds (the looks' fixed order). */
  order: number;
  state: LookRowState;
  fields: DecisionFields;
  net: number | null;
}
export interface IdeasStore {
  hypotheses(): Promise<HypothesisRow[]>;
  /** Unix seconds of the latest proposal attempt (a rule or a week note). */
  lastProposalAt(): Promise<number | null>;
  finished(): Promise<FinishedDecision[]>;
  /** Learner decisions recorded after `sinceSec` (and up to `untilSec`), with
      the preregistered exclusions applied and net null while unresolved. */
  population(sinceSec: number, untilSec: number | null): Promise<PopulationRow[]>;
  looks(ruleId: string): Promise<StoredLook[]>;
  /** Write-once; false when this look was already stored. */
  saveLook(ruleId: string, result: IdeaLookResult, atMs: number): Promise<boolean>;
  insert(h: { id: string; proposedAtMs: number; model: string; promptVersion: string; rule: Rule; ruleHash: string }): Promise<boolean>;
  retire(id: string, atMs: number, reason: string): Promise<boolean>;
  saveWeekNote(note: CoachNote, atMs: number): Promise<boolean>;
}
export interface IdeasDeps {
  store: IdeasStore;
  chat: (req: ChatRequest) => Promise<ChatResult>;
  now: () => number;
}
export interface IdeasReport {
  retired: string[];
  looks: { idea: string; look: number; verdict: string }[];
  proposed: number;
  rejected: number;
  summary: "accepted" | "rejected" | null;
  /** Why no proposal was asked for in this pass, when none was. */
  waiting: "not-due" | "no-free-slot" | "too-few-finished" | "no-budget" | null;
  errors: number;
}

/** ISO week of a New York date, e.g. "2026-W46". */
export function isoWeekKey(sec: number): string {
  const [y, m, d] = nyMeta(sec).dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The rule's rows: decisions recorded after it was proposed (and, once
    retired, up to its retirement), each marked skip when the rule matches. */
export async function ruleRows(store: IdeasStore, h: HypothesisRow): Promise<IdeaRow[]> {
  const rows = await store.population(h.proposedAt, h.status === "retired" ? h.retiredAt : null);
  return rows.map((r) => ({ key: r.key, session: r.session, order: r.order, state: r.state, net: r.net, skip: matches(h.rule, r.fields) }));
}

export async function runIdeas(deps: IdeasDeps, budget: RunBudget): Promise<IdeasReport> {
  const report: IdeasReport = { retired: [], looks: [], proposed: 0, rejected: 0, summary: null, waiting: null, errors: 0 };
  const nowMs = deps.now(), nowSec = Math.floor(nowMs / 1000);
  const all = await deps.store.hypotheses();
  let testing = all.filter((h) => h.status === "testing");

  for (const h of testing) {
    // Take a due look first (stored once), then retire from the stored looks.
    const stored = await deps.store.looks(h.id);
    const due = dueIdeaLook(await ruleRows(deps.store, h), stored, h.id, IDEAS_RULES, nowSec);
    if ("due" in due && (await deps.store.saveLook(h.id, due.due, deps.now()))) {
      stored.push({ look: due.due.look, verdict: due.due.verdict, takenAt: new Date(deps.now()).toISOString() });
      report.looks.push({ idea: h.id, look: due.due.look, verdict: due.due.verdict });
    }
    const reason = retireReason(stored, h.proposedAt, nowSec, IDEAS_RULES);
    if (reason && (await deps.store.retire(h.id, deps.now(), reason))) report.retired.push(h.id);
  }
  testing = testing.filter((h) => !report.retired.includes(h.id));

  const free = IDEAS_RULES.maxTesting - testing.length;
  if (free <= 0) return { ...report, waiting: "no-free-slot" };
  const last = await deps.store.lastProposalAt();
  if (last !== null && nowSec - last < IDEAS_RULES.proposalEveryDays * 86400) return { ...report, waiting: "not-due" };
  const finished = await deps.store.finished();
  if (finished.length < IDEAS_RULES.minFinishedForProposal) return { ...report, waiting: "too-few-finished" };
  if (!canCall(budget, deps.now())) return { ...report, waiting: "no-budget" };

  const facts = factsTable(finished);
  budget.calls--;
  let result: ChatResult;
  try {
    result = await deps.chat({ system: proposalSystem(free), user: proposalUser(facts, testing.map((h) => h.rule), free), models: PROPOSAL_MODELS, maxTokens: 2500, temperature: 0.4, timeoutMs: callTimeout(budget, deps.now()), deadline: budget.hardStop });
  } catch (err) {
    if (!(err instanceof FreeAiError)) throw err;
    report.errors++;
    return report;
  }
  const proposedAtMs = deps.now();
  const parsed = parseProposal(result.text, facts, free, new Set(testing.map((h) => h.ruleHash)));
  for (const rule of parsed.rules) {
    const hash = ruleHash(rule);
    const ok = await deps.store.insert({ id: `idea-${stableHash([hash, proposedAtMs]).slice(0, 12)}`, proposedAtMs, model: result.model, promptVersion: IDEAS_PROMPT_VERSION, rule, ruleHash: hash });
    if (ok) report.proposed++;
  }
  report.rejected = parsed.rejected.length;
  // The week note also marks that a proposal was made, whatever its outcome.
  const accepted = parsed.summary !== null && parsed.summaryReject === null;
  const note: CoachNote = {
    kind: "week", subject: isoWeekKey(nowSec), facts: facts as unknown as CoachNote["facts"], factsHash: stableHash(facts), model: result.model,
    promptVersion: IDEAS_PROMPT_VERSION, status: accepted ? "accepted" : "rejected",
    text: cleanText(parsed.summary ?? result.text.replace(/\s+/g, " ").trim(), 2000) || "(empty answer)", rejectReason: accepted ? null : parsed.summaryReject,
  };
  if (await deps.store.saveWeekNote(note, deps.now())) report.summary = accepted ? "accepted" : "rejected";
  return report;
}
