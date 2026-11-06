/* The facts table the AI reads before proposing skip rules: the learner's
   finished decisions, bucketed by each whitelisted field, with the count,
   wins and the one-contract result per idea after costs.

   Our code computes every number; the AI only reads them. Its summary is
   accepted only if each number it quotes appears here. */

import { FIELD_NAMES, FIELDS, type DecisionFields, type FieldName } from "./dsl";

export interface FinishedDecision {
  key: string;
  session: string;
  fields: DecisionFields;
  /** One-contract result after costs. */
  net: number;
}

export interface Bucket {
  /** In the rule language, e.g. "rr < 1.5", "side = SHORT", "1.5 <= rr <= 2". */
  bucket: string;
  n: number;
  wins: number;
  win_rate_pct: number;
  net_per_idea_usd: number;
  total_net_usd: number;
}

export interface FactsTable {
  overall: { finished_ideas: number; sessions: number; wins: number; win_rate_pct: number; net_per_idea_usd: number; total_net_usd: number; first_session: string | null; last_session: string | null };
  by_field: Partial<Record<FieldName, Bucket[]>>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function bucketOf(label: string, rows: FinishedDecision[]): Bucket {
  const wins = rows.filter((r) => r.net > 0).length;
  const total = rows.reduce((a, r) => a + r.net, 0);
  return { bucket: label, n: rows.length, wins, win_rate_pct: rows.length ? Math.round((100 * wins) / rows.length) : 0, net_per_idea_usd: rows.length ? r2(total / rows.length) : 0, total_net_usd: r2(total) };
}

/** Value at quantile q of sorted numbers (nearest rank), rounded for display. */
function cut(sorted: number[], q: number, dp: number): number {
  const v = sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function factsTable(rows: readonly FinishedDecision[]): FactsTable {
  const sessions = [...new Set(rows.map((r) => r.session))].sort();
  const all = bucketOf("all", [...rows]);
  const by_field: FactsTable["by_field"] = {};
  for (const field of FIELD_NAMES) {
    const spec = FIELDS[field];
    const withValue = rows.filter((r) => r.fields[field] !== undefined);
    if (!withValue.length) continue;
    const buckets: Bucket[] = [];
    const distinct = [...new Set(withValue.map((r) => r.fields[field]))];
    if (spec.type !== "number" || distinct.length <= 6) {
      // Categories, flags and numbers with few values: one bucket per value.
      for (const v of distinct.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)))))
        buckets.push(bucketOf(`${field} = ${String(v)}`, withValue.filter((r) => r.fields[field] === v)));
    } else {
      // Continuous numbers: thirds, labelled with the rule language's own operators.
      const dp = field === "risk_usd" ? 0 : 2;
      const sorted = withValue.map((r) => r.fields[field] as number).sort((a, b) => a - b);
      const lo = cut(sorted, 1 / 3, dp), hi = cut(sorted, 2 / 3, dp);
      const val = (r: FinishedDecision) => r.fields[field] as number;
      buckets.push(bucketOf(`${field} < ${lo}`, withValue.filter((r) => val(r) < lo)));
      buckets.push(bucketOf(`${lo} <= ${field} <= ${hi}`, withValue.filter((r) => val(r) >= lo && val(r) <= hi)));
      buckets.push(bucketOf(`${field} > ${hi}`, withValue.filter((r) => val(r) > hi)));
    }
    by_field[field] = buckets.filter((b) => b.n > 0);
  }
  return {
    overall: {
      finished_ideas: all.n, sessions: sessions.length, wins: all.wins, win_rate_pct: all.win_rate_pct,
      net_per_idea_usd: all.net_per_idea_usd, total_net_usd: all.total_net_usd, first_session: sessions[0] ?? null, last_session: sessions.at(-1) ?? null,
    },
    by_field,
  };
}
