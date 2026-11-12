/* The historical time machine filter test (tm-filter-v1). Run ONLY through the
   manual `tm-filter-study.yml` workflow: it reads production.

   Reads: the registered historical study's rows (history_*), the Databento
   archive (bars_5m, source databento) and context_daily. Writes: one study row,
   one call per eligible idea and ONE look, all write-once (tm_filter_*). If the
   look is already stored it prints it and stops: the result is never
   recomputed. Virtual only: no broker, no paid data, no paid AI. */

import { appendFileSync } from "node:fs";
import { experimentPool } from "@/lib/experiment/store-pg";
import { PgHistoryStore } from "@/lib/history/store-pg";
import { buildStudyDataset } from "@/lib/history/dataset";
import { HIST_RULES } from "@/lib/history/rules";
import type { Bar } from "@/lib/types";
import { TM_FILTER_RULES, TM_FILTER_VERSION, TM_HIST_STUDY, tmFilterRulesHash } from "@/lib/tm-study/rules";
import { breakdowns, callAll, chunkWindow, poolDays, regenerateChunk, scoreHistorical, scoreRows, type Eligible, type Regenerated } from "@/lib/tm-study/historical";
import type { TmDay } from "@/lib/timemachine";

const DAY = 86_400;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function readSeries(pool: ReturnType<typeof experimentPool>, symbol: "MES" | "MNQ", from: number, to: number): Promise<Bar[]> {
  const out: Bar[] = [];
  const step = 180 * DAY;
  for (let a = from; a < to; a += step) {
    const r = await pool.query(
      `SELECT time, open, high, low, close, volume FROM bars_5m WHERE symbol=$1 AND source=$2 AND time >= $3 AND time < $4 ORDER BY time`,
      [symbol, HIST_RULES.scope.source, a, Math.min(to, a + step)],
    );
    for (const x of r.rows) out.push({ time: Number(x.time), open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume ?? 0) });
  }
  return out;
}

/** The rows a chunk read: [from, to) in time order (the series is sorted). */
function slice(series: Bar[], from: number, to: number): Bar[] {
  const lb = (t: number) => { let lo = 0, hi = series.length; while (lo < hi) { const m = (lo + hi) >> 1; if (series[m].time < t) lo = m + 1; else hi = m; } return lo; };
  return series.slice(lb(from), lb(to));
}

async function main() {
  const pool = experimentPool();
  const H = TM_FILTER_RULES.historical;

  const stored = await pool.query(`SELECT verdict, result FROM tm_filter_looks WHERE study_id=$1 AND look=1`, [TM_HIST_STUDY]);
  if (stored.rows.length) {
    log("The historical look is already stored; it is never recomputed.");
    console.log(JSON.stringify(stored.rows[0], null, 1));
    return;
  }
  await pool.query(
    `INSERT INTO tm_filter_studies(id, version, kind, rules, rules_hash, code_sha) VALUES ($1,$2,'historical',$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [TM_HIST_STUDY, TM_FILTER_VERSION, JSON.stringify(TM_FILTER_RULES), tmFilterRulesHash(), process.env.GITHUB_SHA ?? null],
  );
  const reg = await pool.query(`SELECT rules_hash FROM tm_filter_studies WHERE id=$1`, [TM_HIST_STUDY]);
  if (reg.rows[0]?.rules_hash !== tmFilterRulesHash()) throw new Error("The registered rules hash differs from this code's frozen rules; stopping.");

  // The registered study's eligible rows, with its own exclusions.
  const hist = new PgHistoryStore(pool);
  const study = (await pool.query(`SELECT observation_lag_sec, manifest FROM history_studies WHERE id=$1`, [H.sourceStudy])).rows[0];
  if (!study) throw new Error(`No registered study ${H.sourceStudy}`);
  const lagSec = Number(study.observation_lag_sec);
  const months: string[] = study.manifest.months;
  const examples = await hist.examples(H.sourceStudy);
  const cutoff = Math.floor(Date.parse(`${HIST_RULES.scope.to}T23:59:59Z`) / 1000);
  const ds = buildStudyDataset(examples, cutoff, H.mode);
  const byKey = new Map(examples.filter((e) => e.mode === H.mode).map((e) => [`${H.mode}:${e.familyId}`, e]));
  const eligible = new Map<string, Eligible>();
  for (const r of ds.rows) eligible.set(r.key, { key: r.key, example: byKey.get(r.key)! });
  log(`Study ${H.sourceStudy}: ${examples.length} examples, ${ds.rows.length} eligible rows, rows hash ${ds.rowsHash.slice(0, 12)}.`);

  const ctx = await hist.contextRows();
  const found: Regenerated[] = [];
  const mismatches: { key: string; why: string }[] = [];
  const days = {} as Record<"MES" | "MNQ", TmDay[]>;
  const flagged: Record<string, number> = {};
  for (const symbol of HIST_RULES.scope.symbols) {
    const first = chunkWindow(months[0]).from - TM_FILTER_RULES.timeMachine.lookbackDays * DAY;
    const last = chunkWindow(months[months.length - 1]).to;
    const series = await readSeries(pool, symbol, first, last);
    log(`${symbol}: ${series.length} archive bars read.`);
    const p = poolDays(series, symbol);
    days[symbol] = p.days;
    flagged[symbol] = p.flaggedDays;
    const mine = new Map([...eligible].filter(([, e]) => e.example.symbol === symbol));
    for (const month of months) {
      const w = chunkWindow(month);
      const r = regenerateChunk({ raw: slice(series, w.from, w.to), symbol, month, ctx, lagSec, eligible: mine });
      found.push(...r.found);
      mismatches.push(...r.mismatches);
    }
    log(`${symbol}: ${found.filter((f) => f.example.symbol === symbol).length} rows regenerated, ${mismatches.length} mismatches so far.`);
  }
  const missing = [...eligible.keys()].filter((k) => !found.some((f) => f.key === k) && !mismatches.some((m) => m.key === k));
  if (mismatches.length || missing.length) {
    log(`STOPPED before scoring: ${mismatches.length} regenerated outcomes differ from the stored ones and ${missing.length} rows were not regenerated.`);
    console.log(JSON.stringify({ mismatches: mismatches.slice(0, 20), missing: missing.slice(0, 20) }, null, 1));
    process.exitCode = 2;
    return;
  }

  const t0 = Date.now();
  const calls = callAll(found, days);
  log(`${calls.length} filter calls in ${Math.round((Date.now() - t0) / 1000)} s.`);
  for (let i = 0; i < calls.length; i += 200) {
    const batch = calls.slice(i, i + 200);
    const vals: unknown[] = [];
    const tuples = batch.map((c, j) => {
      const k = j * 13;
      const ok = c.call.ok ? c.call : null;
      vals.push(TM_HIST_STUDY, c.key, new Date(c.decidedAt * 1000).toISOString(), c.call.ok, c.call.skip, ok?.edgeR ?? null, ok?.avgR ?? null, ok?.costR ?? null,
        ok?.targetFirst ?? null, ok?.stopFirst ?? null, ok?.neither ?? null, ok?.sessions ?? null, c.call.ok ? null : c.call.refusal);
      return `(${Array.from({ length: 13 }, (_, n) => `$${k + n + 1}`).join(",")})`;
    });
    await pool.query(
      `INSERT INTO tm_filter_calls(study_id, decision_key, decided_at, ok, skip, edge_r, avg_r, cost_r, target_first, stop_first, neither, sessions, refusal)
       VALUES ${tuples.join(",")} ON CONFLICT (study_id, decision_key) DO NOTHING`, vals);
  }

  const rows = scoreRows(calls, found);
  const look = scoreHistorical(rows, TM_HIST_STUDY);
  const notRun: Record<string, number> = {};
  for (const c of calls) if (!c.call.ok) notRun[c.call.refusal] = (notRun[c.call.refusal] ?? 0) + 1;
  const result = {
    ...look,
    label: H.label,
    sourceStudy: H.sourceStudy,
    rowsHash: ds.rowsHash,
    exclusions: ds.exclusions,
    notRun,
    flaggedPoolDays: flagged,
    breakdowns: breakdowns(rows, found),
    rulesHash: tmFilterRulesHash(),
  };
  const saved = await pool.query(
    `INSERT INTO tm_filter_looks(study_id, look, window_size, last_decision_key, verdict, result) VALUES ($1, 1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING verdict`,
    [TM_HIST_STUDY, rows.length, look.lastDecisionKey, look.verdict, JSON.stringify(result)],
  );
  log(saved.rows.length ? `Stored the historical look: ${look.verdict.toUpperCase()}.` : "A look was stored by another run first; this one was not saved.");
  console.log(JSON.stringify(result, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Time machine filter, historical look: ${look.verdict}\n\n\`\`\`json\n${JSON.stringify(result, null, 1)}\n\`\`\`\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => experimentPool().end().catch(() => {}));
