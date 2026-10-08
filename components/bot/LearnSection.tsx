"use client";

/* Learn — what the experimental learner has tried, kept or rejected.

   The active model, every candidate with its progress toward the adoption
   floors (each shown with its count), every review's verdict with the checks
   it failed in plain words, and the full change timeline. Every trial is kept,
   including the failed ones. A training job finishing is never shown as a
   learning success: only an adopted change is. */

import { useCallback, useEffect, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { useExperiment, EXPERIMENT_LINEAGE } from "@/components/providers/ExperimentProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { readCache, useLiveRefresh, writeCache } from "@/lib/hooks/useLiveRefresh";
import { Term } from "@/components/ui/Glossary";
import ShowNumbers from "@/components/ui/ShowNumbers";
import BotCompanion from "./BotCompanion";
import { checkedLearningExamples } from "@/lib/plain/companion";
import type { ExpLearning } from "@/lib/experiment/view";
import { PREREG } from "@/lib/experiment/prereg";
import {
  BLOCKER_WORDS, CHECK_WORDS, VERDICT_WORDS, VERSION_STATUS_WORDS, changeWords, specWords, versionName,
} from "@/lib/plain/experiment";
import { dateShortIn } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import styles from "@/components/experiment/experiment.module.css";

const sec = (iso: string) => Date.parse(iso) / 1000;
const num = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");

function Meter({ label, n, of }: { label: string; n: number; of: number }) {
  const pct = Math.max(0, Math.min(100, (n / of) * 100));
  return (
    <div className={styles.meter}>
      <span>
        {label}: <b className="num">{n}</b> of {of}
      </span>
      <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={Math.min(of, n)} aria-label={label}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const TONE_CLASS: Record<string, string> = { good: "tl_good", warn: "tl_warn", bad: "tl_bad", dim: "" };
const CHANGE_TONE: Record<string, string> = {
  adopted: "good", campaign_started: "good", rejected: "dim", inconclusive: "warn", rolled_back: "bad", challenger_invalid: "bad", locked: "bad", day_halted: "warn", paused: "warn", rules_amended: "warn",
};

export default function LearnSection() {
  const exp = useExperiment();
  const { zone } = useZone();
  const [data, setData] = useState<ExpLearning | null>(null);
  const [failed, setFailed] = useState(false);
  const [allChanges, setAllChanges] = useState(false);
  const request = useRef(0);
  const experimentId = exp.data?.experiment.id;

  const load = useCallback(async () => {
    if (!experimentId) return;
    const current = ++request.current;
    try {
      const res = await getNeon().from("experiment_learning").select("*").eq("lineage", EXPERIMENT_LINEAGE).limit(1);
      if (res.error) throw new Error(res.error.message);
      if (current !== request.current) return;
      const next = (res.data?.[0] ?? null) as ExpLearning | null;
      if (next && next.experiment_id !== experimentId) throw new Error("Learning record is for another campaign");
      setData(next);
      if (next) writeCache(`aegis.learning.${experimentId}`, next);
      setFailed(false);
    } catch {
      if (current === request.current) setFailed(true);
    }
  }, [experimentId]);
  useEffect(() => {
    setData(experimentId ? readCache<ExpLearning>(`aegis.learning.${experimentId}`)?.value ?? null : null);
    void load();
    return () => { request.current++; };
  }, [load, experimentId]);
  useLiveRefresh(() => void load(), 5 * 60_000);

  const g = { ...PREREG.gates, ...data?.prereg?.gates };
  const fairReview = g.minTrainRows * (g.folds + 1); // an illustration, not a rule: six date blocks, the first must train fold 1
  const active = data?.versions.find((v) => v.id === data.active_version_id) ?? null;
  const shadowing = data?.versions.filter((v) => v.status === "shadowing") ?? [];
  const lastEval = (id: string) => data?.evaluations.find((e) => e.model_version_id === id && e.kind === "walk_forward") ?? null;
  const passes = (id: string) => data?.evaluations.filter((e) => e.model_version_id === id && e.kind === "walk_forward" && e.verdict === "pass").length ?? 0;
  const checked = checkedLearningExamples(data, exp.data);
  const closed = checked?.count ?? 0;
  const changes = data?.changes ?? [];

  return (
    <section className={page.stack} aria-label="What the learner has learned" id="learning">
      <BotCompanion data={data} failed={failed} />
      <div className={page.sectionHead}>
        <h2>
          <Term k="experimentalLearner">Experimental learner</Term> · learning
        </h2>
      </div>
      <p className={page.paperLine}>VIRTUAL ONLY · {data?.mode === "synthetic" ? "Synthetic prices" : "Delayed data"}</p>

      <section className={`${page.card} ${styles.card}`} aria-label="Learning state">
        <p className={page.note}>Finished trades build the learning record. A new version takes over only after every check passes.</p>
        <details className={styles.accountDetails}><summary>How learning works <span>Details +</span></summary><p className={page.note}>
          It learns from finished trades in batches, never from the last loss. Each week it may test up to {PREREG.search.maxPerWeek} new
          versions from a fixed list, side by side with the current one on the same ideas — at most {PREREG.lifecycle.maxShadowing} at a time, each for up
          to {PREREG.lifecycle.shadowWeeks} weeks, because fresh results come slowly. A new version takes over only after every check below passes;
          the old one is kept so it can be put back.
        </p></details>
      </section>

      {failed && !data ? (
        <p className={page.warning}>
          Learning history could not load.{" "}
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : !data ? (
        <p className={page.loading}>{exp.loading || exp.data ? "Loading learning history…" : "The learner is not set up yet."}</p>
      ) : (
        <>
          <section className={`${page.card} ${styles.card}`} aria-label="Active model">
            <h3 className={page.cardTitle}>
              <Term k="modelVersion">Active model</Term> · {versionName(active?.id)}
            </h3>
            <p className={styles.reason}>
              {specWords(active?.spec)} In charge since {exp.data?.model?.since ? dateShortIn(sec(exp.data.model.since), zone) : "—"}.
            </p>
            {checked && closed < fairReview ? (
              <details className={styles.accountDetails}>
                <summary>How the first review is counted <span>Details +</span></summary>
                <Meter label="Finished trades toward a fair first review (rough guide)" n={closed} of={fairReview} />
                <p className={page.note}>
                  Training can start at {g.minTrainRows}, but a review splits the record into {g.folds + 1} blocks by date and each of its {g.folds} test periods
                  needs {g.minTrainRows} earlier trades to learn from — roughly {fairReview}, more after the 5-day gap. Periods that are too thin are shown
                  and skipped, never counted.
                </p>
              </details>
            ) : null}
            <p className={page.note}>{checked ? `${closed} usable examples at the last notebook check.` : "The next notebook check will count usable examples."} Ideas too risky for one contract are not counted.</p>
          </section>

          <section className={page.stack} aria-label="Candidates">
            <div className={page.sectionHead}>
              <h3>
                <Term k="challenger">Candidates</Term> shadowing now ({shadowing.length})
              </h3>
            </div>
            {shadowing.length === 0 ? (
              <p className={page.empty}>No candidate is being tested right now. {closed < g.minTrainRows ? "Training waits for enough finished trades." : "New ones are registered at the weekly review."}</p>
            ) : (
              shadowing.map((v) => {
                const e = lastEval(v.id);
                const fresh = (e?.metrics?.fresh ?? {}) as { sessions?: number; decisions?: number };
                const blockers = (e?.metrics?.adoptionBlockers ?? []) as string[];
                return (
                  <article key={v.id} className={`${page.card} ${styles.card}`}>
                    <h4 className={page.cardTitle}>{versionName(v.id)}</h4>
                    <p className={styles.reason}>{specWords(v.spec)}</p>
                    <Meter label="Out-of-sample results" n={e?.n_oos ?? 0} of={g.minOos} />
                    <Meter label="Fresh ideas since registered" n={fresh.decisions ?? 0} of={g.freshDecisions} />
                    <Meter label="Fresh trading days" n={fresh.sessions ?? 0} of={g.freshSessions} />
                    <Meter label="Passing weekly reviews" n={passes(v.id)} of={2} />
                    <p className={page.note}>
                      {e ? `${VERDICT_WORDS[e.verdict]?.label ?? e.verdict} on ${dateShortIn(sec(e.created_at), zone)}.` : "Not reviewed yet."}{" "}
                      {blockers.length ? `Not adopted: ${blockers.map((b) => BLOCKER_WORDS[b] ?? b).join("; ")}.` : ""}
                    </p>
                  </article>
                );
              })
            )}
          </section>

          <section className={page.stack} aria-label="Reviews">
            <div className={page.sectionHead}>
              <h3>Latest reviews</h3>
            </div>
            {data.evaluations.filter((e) => e.kind === "walk_forward").length === 0 ? (
              <p className={page.empty}>No review has run yet. The first one happens once candidates have been shadowing for a week.</p>
            ) : (
              data.evaluations
                .filter((e) => e.kind === "walk_forward")
                .slice(0, 6)
                .map((e) => {
                  const v = VERDICT_WORDS[e.verdict];
                  const checks = (e.metrics?.checks ?? {}) as Record<string, boolean>;
                  const m = e.metrics as Record<string, unknown> & { delta?: { est: number; lo: number; hi: number }; expectancy?: { est: number; lo: number; hi: number } };
                  return (
                    <article key={e.id} className={`${page.card} ${styles.card}`}>
                      <div className={styles.head}>
                        <h4 className={page.cardTitle}>{versionName(e.model_version_id)}</h4>
                        <span className={`${page.chip} ${v?.tone === "good" ? page.chip_green : v?.tone === "bad" ? page.chip_red : page.chip_amber}`}>{v?.label ?? e.verdict}</span>
                      </div>
                      <p className={page.note}>
                        Compared with {versionName(e.incumbent_version_id)} on {e.n_oos} ideas it never trained on, over {e.n_sessions} trading days (n={e.n_oos}).
                        {e.verdict === "inconclusive" ? " Not enough evidence to tell — no change applied." : e.verdict === "fail" ? " Measured worse — kept the current model." : ""}
                      </p>
                      {Object.keys(checks).length > 0 && (
                        <ul className={styles.checks}>
                          {Object.entries(checks).map(([k, ok]) => (
                            <li key={k} className={ok ? styles.ok : ""}>
                              {CHECK_WORDS[k] ?? k}
                            </li>
                          ))}
                        </ul>
                      )}
                      <ShowNumbers label="Show the numbers">
                        <dl className={styles.facts}>
                          <dt>Gain per idea vs current</dt>
                          <dd>{m.delta ? `$${num(m.delta.est)} (likely $${num(m.delta.lo)} to $${num(m.delta.hi)})` : "—"}</dd>
                          <dt>Net per idea</dt>
                          <dd>{m.expectancy ? `$${num(m.expectancy.est)} (likely $${num(m.expectancy.lo)} to $${num(m.expectancy.hi)})` : "—"}</dd>
                          <dt>Beat random picks</dt>
                          <dd>{num(m.randomPct, 0)}th percentile</dd>
                          <dt>Worst likely fall</dt>
                          <dd>${num(m.stressP95, 0)}</dd>
                          <dt>Costs doubled</dt>
                          <dd>${num(m.costStressNet, 0)}</dd>
                          <dt>Calibration (lower is better)</dt>
                          <dd>
                            {num(m.brierC, 3)} vs {num(m.brierInc, 3)}
                          </dd>
                          <dt>Took</dt>
                          <dd>{typeof m.takeRate === "number" ? `${Math.round(m.takeRate * 100)}% of ideas` : "—"}</dd>
                          <dt>Window</dt>
                          <dd>
                            {e.window_from ? dateShortIn(sec(e.window_from), zone) : "—"} – {e.window_to ? dateShortIn(sec(e.window_to), zone) : "—"}
                          </dd>
                          {Array.isArray(m.foldDetail) && (
                            <>
                              <dt>Test periods with enough data</dt>
                              <dd>
                                {(m.foldDetail as { valid: boolean }[]).filter((f) => f.valid).length} of {(m.foldDetail as unknown[]).length} ·{" "}
                                {(m.foldDetail as { fold: number; trainRows: number; purgedRows: number; testRows: number; valid: boolean }[])
                                  .map((f) => `${f.fold}: trained ${f.trainRows}, gap ${f.purgedRows}, tested ${f.testRows}${f.valid ? "" : " (too thin)"}`)
                                  .join(" · ")}
                              </dd>
                            </>
                          )}
                        </dl>
                      </ShowNumbers>
                    </article>
                  );
                })
            )}
          </section>

          <section className={`${page.card} ${styles.card}`} aria-label="Change history">
            <h3 className={page.cardTitle}>Change history · all trials kept</h3>
            {changes.length === 0 ? (
              <p className={page.empty}>Nothing recorded yet.</p>
            ) : (
              <ol className={styles.timeline}>
                {(allChanges ? changes : changes.slice(0, 12)).map((c) => (
                  <li key={c.id} className={styles[TONE_CLASS[CHANGE_TONE[c.kind] ?? "dim"]] ?? ""}>
                    <b>
                      {changeWords(c.kind)}
                      {c.to_version || c.from_version ? ` · ${versionName(c.to_version ?? c.from_version)}` : ""}
                    </b>
                    <small>
                      {dateShortIn(sec(c.created_at), zone)} · {c.actor === "owner" ? "by the owner" : "automatic"} · {c.reason.slice(0, 160)}
                    </small>
                  </li>
                ))}
              </ol>
            )}
            {changes.length > 12 && (
              <button type="button" className={`${page.linkButton} ${styles.more}`} onClick={() => setAllChanges(!allChanges)}>
                {allChanges ? "Show fewer" : `Show all ${changes.length}`}
              </button>
            )}
            <p className={page.note}>
              Versions tried: {data.versions.filter((v) => v.kind === "logit").length} ·{" "}
              {Object.entries(
                data.versions.filter((v) => v.kind === "logit").reduce<Record<string, number>>((a, v) => ((a[v.status] = (a[v.status] ?? 0) + 1), a), {}),
              )
                .map(([s, n]) => `${VERSION_STATUS_WORDS[s] ?? s} ${n}`)
                .join(" · ") || "none yet"}
            </p>
          </section>
        </>
      )}
    </section>
  );
}
