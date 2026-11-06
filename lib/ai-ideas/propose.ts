/* The weekly proposal: the AI reads the facts table and may suggest up to the
   free number of simple skip rules, plus a short summary of what it noticed.

   It is told the truth: the methods have not beaten random entries, small
   buckets are mostly noise, and every rule will be tested only on decisions
   made after it is proposed, against strict preregistered thresholds. A rule
   is kept only if it parses in the rule language (lib/ai-ideas/dsl.ts), is not
   already being tested, and quotes no number that the facts do not contain. */

import { extractJson } from "@/lib/ai-free/nvidia";
import { factNumbers, validateNote } from "@/lib/ai-coach/validate";
import { describeWhen, FIELD_NAMES, FIELDS, parseRule, ruleHash, type FieldSpec, type Rule } from "./dsl";
import type { FactsTable } from "./facts";

function fieldGuide(): string {
  return FIELD_NAMES.map((f) => {
    const s: FieldSpec = FIELDS[f];
    if (s.type === "enum") return `${f} (${s.note}): one of ${s.values.join(", ")}; ops = or !=`;
    if (s.type === "bool") return `${f} (${s.note}): true or false; ops = or !=`;
    return `${f} (${s.note}): ${s.integer ? "whole " : ""}number ${s.min} to ${s.max}; ops < > = !=`;
  }).join("\n");
}

export function proposalSystem(freeSlots: number): string {
  return [
    "You help research a virtual (practice) futures trading bot. No real money is involved.",
    "You get statistics of its finished ideas: for each field, buckets with the number of ideas (n), wins, and the one-contract result per idea after costs.",
    "The methods that produce these ideas have not beaten random entries. Small buckets are mostly noise. Each rule you propose will be tested only on decisions made after today, against strict thresholds, and most rules are expected to fail.",
    `Propose at most ${freeSlots} simple rule(s) that SKIP the ideas you think are worse. Each rule: 1 to 3 conditions that must all hold, then "skip".`,
    "Prefer rules that would skip between 10% and 60% of ideas, backed by buckets with more ideas. Do not repeat a rule that is already being tested. Proposing no rule is fine.",
    "Allowed fields:",
    fieldGuide(),
    "Also write a summary of 2 to 4 plain sentences of what you noticed, for an owner who has never traded. Quote only numbers from the statistics.",
    'Reply with one JSON object only, no markdown: {"summary": string, "ideas": [{"name": "at most 60 characters of plain words", "why": "at most 300 characters", "when": [{"field": string, "op": "<" | ">" | "=" | "!=", "value": string | number | boolean}], "then": "skip"}]}',
  ].join("\n");
}

export function proposalUser(facts: FactsTable, testing: readonly Pick<Rule, "name" | "when">[], freeSlots: number): string {
  return JSON.stringify({ free_slots: freeSlots, rules_already_testing: testing.map((r) => ({ name: r.name, when: describeWhen(r.when) })), statistics: facts });
}

export interface ParsedProposal {
  summary: string | null;
  /** Why the summary was not accepted, if it was not. */
  summaryReject: string | null;
  rules: Rule[];
  rejected: { reason: string }[];
}

/** Numbers a rule's own name/why may quote: the facts plus its own thresholds. */
function ruleNumbersOk(rule: Rule, facts: FactsTable): boolean {
  const pool = [...factNumbers(facts), ...rule.when.flatMap((c) => (typeof c.value === "number" ? [Math.abs(c.value)] : [])), ...factNumbers(rule.when.map((c) => String(c.value)))];
  const text = `${rule.name} ${rule.why}`;
  for (const token of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const value = Number(token.replace(/,/g, ""));
    const dot = token.indexOf(".");
    const f = 10 ** (dot < 0 ? 0 : Math.min(token.length - dot - 1, 6));
    if (!pool.some((p) => Math.abs(Math.round(p * f) / f - value) < 1e-9)) return false;
  }
  return true;
}

export function parseProposal(text: string, facts: FactsTable, freeSlots: number, testingHashes: ReadonlySet<string>): ParsedProposal {
  const out: ParsedProposal = { summary: null, summaryReject: "unparseable", rules: [], rejected: [] };
  const value = extractJson(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const v = value as Record<string, unknown>;
  if (typeof v.summary === "string") {
    const summary = v.summary.replace(/\s+/g, " ").trim();
    const check = validateNote(summary, facts, "week");
    out.summary = summary;
    out.summaryReject = check.ok ? null : check.reason;
  }
  const ideas = Array.isArray(v.ideas) ? v.ideas : [];
  const seen = new Set(testingHashes);
  for (const raw of ideas.slice(0, 6)) {
    const parsed = parseRule(raw);
    if (!parsed.ok) { out.rejected.push({ reason: parsed.error }); continue; }
    const hash = ruleHash(parsed.rule);
    if (seen.has(hash)) { out.rejected.push({ reason: "duplicate" }); continue; }
    if (!ruleNumbersOk(parsed.rule, facts)) { out.rejected.push({ reason: "unsupported-number" }); continue; }
    if (out.rules.length >= freeSlots) { out.rejected.push({ reason: "no-free-slot" }); continue; }
    seen.add(hash);
    out.rules.push(parsed.rule);
  }
  return out;
}
