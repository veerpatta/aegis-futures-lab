/* AI research ideas: the tiny rule language the AI may propose in.

   A rule only ever SKIPS ideas: { name, why, when: 1-3 conditions that must all
   hold, then: "skip" }. Conditions read a whitelist of fields that every
   learner decision has at decision time (experiment_decisions), with fixed
   types, values and ranges. Anything else is refused, so a proposal can never
   reach data from after the decision, change sizing, or do anything but skip.

   Matching is conservative: a field the decision does not have means the rule
   does not match, so the idea is taken as usual. */

import { stableHash } from "@/lib/experiment/hash";
import { nyMeta } from "@/lib/time/ny";

export const DSL_VERSION = "ai-ideas-dsl-v1";
export type Op = "<" | ">" | "=" | "!=";
export const OPS: readonly Op[] = Object.freeze(["<", ">", "=", "!="]);

type EnumSpec = { type: "enum"; values: readonly string[]; note: string };
type BoolSpec = { type: "bool"; note: string };
type NumSpec = { type: "number"; min: number; max: number; integer?: boolean; note: string };
export type FieldSpec = EnumSpec | BoolSpec | NumSpec;

export const FIELDS = Object.freeze({
  side: { type: "enum", values: Object.freeze(["LONG", "SHORT"]), note: "LONG buys, SHORT sells" },
  symbol: { type: "enum", values: Object.freeze(["MES", "MNQ"]), note: "MES = S&P 500 micro, MNQ = Nasdaq-100 micro" },
  strategy: { type: "enum", values: Object.freeze(["rsi-reversion", "zone-v5"]), note: "the method that produced the idea" },
  tier: { type: "enum", values: Object.freeze(["A", "B"]), note: "the method's stream" },
  paused: { type: "bool", note: "the method was paused after a losing streak" },
  regime: { type: "enum", values: Object.freeze(["trend-high-vol", "trend-low-vol", "range-high-vol", "range-low-vol"]), note: "market regime at the idea" },
  vix_bucket: { type: "enum", values: Object.freeze(["low", "high"]), note: "volatility index level that day" },
  rr: { type: "number", min: 0, max: 10, note: "reward to risk" },
  atr_pct: { type: "number", min: 0, max: 5, note: "average true range as a percent of price" },
  vwap_atr: { type: "number", min: -50, max: 50, note: "distance from the day's average price, in ATR" },
  risk_usd: { type: "number", min: 0, max: 5000, note: "estimated dollar risk of one contract" },
  hour_ny: { type: "number", min: 0, max: 23, integer: true, note: "New York hour of the decision" },
  weekday: { type: "enum", values: Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri"]), note: "New York weekday of the decision" },
} satisfies Record<string, FieldSpec>);
export type FieldName = keyof typeof FIELDS;
export const FIELD_NAMES = Object.freeze(Object.keys(FIELDS) as FieldName[]);

export type Value = string | number | boolean;
export interface Condition {
  field: FieldName;
  op: Op;
  value: Value;
}
export interface Rule {
  name: string;
  why: string;
  when: Condition[];
  then: "skip";
}
export type Parsed = { ok: true; rule: Rule } | { ok: false; error: string };

// Comparison signs are fine in a reason ("vwap_atr > 3"); markup, tags and links are not.
const PLAIN = /^[^`*#|{}\\]*$/;
const TAG = /<\s*[a-z/!?]/i;
const LINK = /https?:\/\/|www\./i;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function plainText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length >= min && s.length <= max && PLAIN.test(s) && !TAG.test(s) && !LINK.test(s) ? s : null;
}

function normValue(spec: FieldSpec, op: Op, raw: unknown): Value | null {
  if (spec.type === "number") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < spec.min || n > spec.max || (spec.integer && !Number.isInteger(n))) return null;
    return n;
  }
  // Categories and flags only compare for (in)equality.
  if (op !== "=" && op !== "!=") return null;
  if (spec.type === "bool") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "false") return raw === "true";
    return null;
  }
  if (typeof raw !== "string") return null;
  const found = spec.values.find((v) => v.toLowerCase() === raw.trim().toLowerCase());
  return found ?? null;
}

/** Strictly validate a proposed rule; normalises case and numeric strings. */
export function parseRule(raw: unknown): Parsed {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "not-an-object" };
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !["name", "why", "when", "then"].includes(k))) return { ok: false, error: "unknown-key" };
  if (r.then !== "skip") return { ok: false, error: "then-must-be-skip" };
  const name = plainText(r.name, 3, 60);
  if (!name) return { ok: false, error: "bad-name" };
  const why = plainText(r.why, 1, 300);
  if (!why) return { ok: false, error: "bad-why" };
  if (!Array.isArray(r.when) || r.when.length < 1 || r.when.length > 3) return { ok: false, error: "one-to-three-conditions" };
  const when: Condition[] = [];
  for (const c of r.when) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "bad-condition" };
    const cond = c as Record<string, unknown>;
    if (Object.keys(cond).some((k) => !["field", "op", "value"].includes(k)) || !has(cond, "value")) return { ok: false, error: "bad-condition" };
    if (typeof cond.field !== "string" || !has(FIELDS, cond.field)) return { ok: false, error: "unknown-field" };
    if (typeof cond.op !== "string" || !OPS.includes(cond.op as Op)) return { ok: false, error: "bad-op" };
    const field = cond.field as FieldName, op = cond.op as Op;
    const value = normValue(FIELDS[field], op, cond.value);
    if (value === null) return { ok: false, error: `bad-value:${field}` };
    if (when.some((w) => w.field === field && w.op === op)) return { ok: false, error: "duplicate-condition" };
    when.push({ field, op, value });
  }
  return { ok: true, rule: { name, why, when, then: "skip" } };
}

/** A rule's identity is its logic, not its wording: two rules that skip the
    same ideas are the same rule whatever they are called. */
export function ruleHash(rule: Pick<Rule, "when" | "then">): string {
  const when = [...rule.when].sort((a, b) => a.field.localeCompare(b.field) || a.op.localeCompare(b.op) || String(a.value).localeCompare(String(b.value)));
  return stableHash({ dsl: DSL_VERSION, when, then: rule.then });
}

export type DecisionFields = Partial<Record<FieldName, Value>>;

export interface DecisionRowLike {
  symbol: unknown;
  side: unknown;
  /** Market decision time, unix seconds. */
  decidedAt: number;
  estRisk: unknown;
  idea: Record<string, unknown> | null;
  features: Record<string, unknown> | null;
}

const asNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The whitelisted fields of one decision, from what it saved at decision time. */
export function decisionFields(row: DecisionRowLike): DecisionFields {
  const idea = row.idea ?? {};
  const features = row.features ?? {};
  const out: DecisionFields = {};
  const set = (field: FieldName, raw: unknown) => {
    if (raw === undefined) return;
    const spec = FIELDS[field];
    const v = spec.type === "number" ? (raw as number) : normValue(spec, "=", raw);
    if (v !== null && v !== undefined) out[field] = v;
  };
  set("side", asStr(row.side));
  set("symbol", asStr(row.symbol));
  set("strategy", asStr(idea.strategy) ?? asStr(features.strategy));
  set("tier", asStr(idea.tier) ?? asStr(features.tier));
  // v1/v2 campaigns never saw a paused method's ideas, so they carry no flag.
  if (typeof idea.sourcePaused === "boolean") set("paused", idea.sourcePaused);
  set("regime", asStr(features.regime) ?? asStr(idea.regime));
  set("vix_bucket", asStr(features.vix_bucket) ?? asStr(idea.vixBucket));
  set("rr", asNum(features.rr) ?? asNum(idea.rr));
  set("atr_pct", asNum(features.atr_pct));
  set("vwap_atr", asNum(features.vwap_atr));
  set("risk_usd", asNum(row.estRisk));
  if (Number.isFinite(row.decidedAt)) {
    const meta = nyMeta(row.decidedAt);
    set("hour_ny", meta.hour);
    set("weekday", meta.weekday);
  }
  return out;
}

function holds(c: Condition, v: Value | undefined): boolean {
  if (v === undefined || v === null) return false;
  switch (c.op) {
    case "=": return v === c.value;
    case "!=": return v !== c.value;
    case "<": return typeof v === "number" && typeof c.value === "number" && v < c.value;
    case ">": return typeof v === "number" && typeof c.value === "number" && v > c.value;
  }
}

/** True when every condition holds, i.e. the rule would SKIP this idea. A
    missing field never matches, so the idea is taken. */
export function matches(rule: Pick<Rule, "when">, fields: DecisionFields): boolean {
  return rule.when.length > 0 && rule.when.every((c) => holds(c, fields[c.field]));
}

/** "rr < 1.5 and side = SHORT": a rule's conditions in words, for prompts. */
export function describeWhen(when: readonly Condition[]): string {
  return when.map((c) => `${c.field} ${c.op} ${String(c.value)}`).join(" and ");
}
