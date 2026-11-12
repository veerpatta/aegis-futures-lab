/* The forward time machine filter test (tm-filter-v1), one pass. Runs in
   signal-engine.yml right after the learner's tick, best effort: it catches
   its own errors and always exits 0, so it can never fail or delay a pass.

   1. Register the forward study once; its registration time starts the test.
   2. Call: every learner decision recorded since then that has no call yet and
      is less than 24 hours old gets one, from the yahoo bars of days before its
      day and the learner's own reference price. Stored once (the database
      refuses a call later than 24 hours).
   3. Look: if a frozen look's window is complete, store it once.
   It reads the learner's records and never writes to them. */

import { experimentPool } from "@/lib/experiment/store-pg";
import { outcomeState } from "@/lib/ai-judge/store-pg";
import type { StoredLook } from "@/lib/ai-judge/looks";
import { DEFAULT_BAR_SOURCE } from "@/lib/data/source";
import { indexDays } from "@/lib/timemachine";
import type { Bar } from "@/lib/types";
import { filterCallDays } from "@/lib/tm-study/filter";
import { TM_FILTER_RULES, TM_FILTER_VERSION, TM_FWD_STUDY, tmFilterRulesHash } from "@/lib/tm-study/rules";
import { dueForwardLook, type TmRow } from "@/lib/tm-study/score";

const DAY = 86_400;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function main() {
  const pool = experimentPool();
  const nowSec = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO public.tm_filter_studies(id, version, kind, rules, rules_hash, code_sha) VALUES ($1,$2,'forward',$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [TM_FWD_STUDY, TM_FILTER_VERSION, JSON.stringify(TM_FILTER_RULES), tmFilterRulesHash(), process.env.GITHUB_SHA ?? null],
  );
  const st = (await pool.query(`SELECT rules_hash, extract(epoch FROM registered_at)::float8 AS reg FROM public.tm_filter_studies WHERE id=$1`, [TM_FWD_STUDY])).rows[0];
  if (st.rules_hash !== tmFilterRulesHash()) throw new Error("registered rules hash differs from the frozen rules");
  const registered = Number(st.reg);
  const deadline = TM_FILTER_RULES.forward.callDeadlineHours * 3600;

  const { rows: decisions } = await pool.query(
    `SELECT d.decision_key, d.session_key, d.symbol, d.side, d.ref_price, d.idea,
            extract(epoch FROM d.decided_at)::float8 AS decided, extract(epoch FROM d.created_at)::float8 AS created,
            o.outcome_status, o.net, o.standalone_qty, c.skip AS call_skip, c.ok AS call_ok
     FROM public.experiment_decisions d
     JOIN public.experiments e ON e.id = d.experiment_id
     LEFT JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key
     LEFT JOIN public.tm_filter_calls c ON c.study_id = $1 AND c.decision_key = d.decision_key
     WHERE e.lineage = 'learner' AND d.created_at > to_timestamp($2)
     ORDER BY d.created_at, d.decision_key`,
    [TM_FWD_STUDY, registered],
  );

  // 2. Calls for decisions that still can get one.
  const due = decisions.filter((d) => d.call_skip === null && nowSec <= Number(d.decided) + deadline);
  let made = 0;
  for (const symbol of [...new Set(due.map((d) => String(d.symbol)))]) {
    const mine = due.filter((d) => d.symbol === symbol);
    const from = Math.min(...mine.map((d) => Number(d.decided))) - TM_FILTER_RULES.timeMachine.lookbackDays * DAY;
    const to = Math.max(...mine.map((d) => Number(d.decided)));
    const r = await pool.query(
      `SELECT time, open, high, low, close FROM public.bars_5m WHERE symbol=$1 AND source=$2 AND time >= $3 AND time < $4 ORDER BY time`,
      [symbol, DEFAULT_BAR_SOURCE, from, to],
    );
    const days = indexDays(r.rows.map((x): Bar => ({ time: Number(x.time), open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close) })));
    for (const d of mine) {
      const idea = (d.idea ?? {}) as { stop?: unknown; target?: unknown };
      const ref = num(d.ref_price), stop = num(idea.stop), target = num(idea.target);
      const call = ref === null || stop === null
        ? { ok: false as const, skip: false as const, refusal: "no-reference-price" }
        : filterCallDays(days, { symbol: symbol as "MES" | "MNQ", side: d.side, stop, target, refPrice: ref, decidedAt: Number(d.decided) });
      const ok = call.ok ? call : null;
      const ins = await pool.query(
        `INSERT INTO public.tm_filter_calls(study_id, decision_key, decided_at, ok, skip, edge_r, avg_r, cost_r, target_first, stop_first, neither, sessions, refusal)
         VALUES ($1,$2,to_timestamp($3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (study_id, decision_key) DO NOTHING RETURNING skip`,
        [TM_FWD_STUDY, d.decision_key, Number(d.decided), call.ok, call.skip, ok?.edgeR ?? null, ok?.avgR ?? null, ok?.costR ?? null,
          ok?.targetFirst ?? null, ok?.stopFirst ?? null, ok?.neither ?? null, ok?.sessions ?? null, call.ok ? null : call.refusal],
      );
      if (ins.rows.length) {
        made++;
        d.call_skip = call.skip;
      }
    }
  }

  // 3. A frozen look, if one is due.
  const rows: TmRow[] = decisions.map((d) => {
    const base = { key: String(d.decision_key), session: String(d.session_key), order: Number(d.created) };
    if (d.call_skip === null) {
      // No call: still open while one can be stored, excluded (and counted) after the deadline.
      return nowSec <= Number(d.decided) + deadline ? { ...base, state: "open" as const, skip: false, net: null } : { ...base, state: "excluded" as const, skip: false, net: null };
    }
    return { ...base, skip: Boolean(d.call_skip), ...outcomeState(d) };
  });
  const stored: StoredLook[] = (await pool.query(`SELECT look, verdict, taken_at FROM public.tm_filter_looks WHERE study_id=$1 ORDER BY look`, [TM_FWD_STUDY])).rows
    .map((r) => ({ look: Number(r.look), verdict: r.verdict, takenAt: new Date(r.taken_at).toISOString() }));
  const final = stored.some((s) => s.verdict !== "inconclusive" || s.look >= TM_FILTER_RULES.forward.looks.length);
  const expired = nowSec - registered >= TM_FILTER_RULES.forward.maxWeeks * 7 * DAY;
  let look = "none due";
  if (!final && !expired) {
    const r = dueForwardLook(rows, stored, TM_FWD_STUDY, nowSec);
    if ("due" in r) {
      const missed = rows.filter((x) => x.state === "excluded" && decisions.find((d) => d.decision_key === x.key)?.call_skip === null).length;
      await pool.query(
        `INSERT INTO public.tm_filter_looks(study_id, look, window_size, last_decision_key, verdict, result) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [TM_FWD_STUDY, r.due.look, r.due.resolved, r.due.lastDecisionKey, r.due.verdict, JSON.stringify({ ...r.due, missedCalls: missed, rulesHash: tmFilterRulesHash() })],
      );
      look = `look ${r.due.look}: ${r.due.verdict}`;
    } else if (r.waiting) look = r.waiting;
  }
  console.log(`Time machine filter (forward): ${decisions.length} decisions since registration, ${made} new call(s); ${look}`);
}

main()
  .catch((e) => console.log(`Time machine filter (forward): skipped this pass: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`))
  .finally(() => experimentPool().end().catch(() => {}));
