"use client";

/* Learn → Historical practice (#history).

   The historical study, in five parts from the plan's mobile table: what older
   data was replayed (source, dates, bars checked, gaps, raw and eligible
   ideas, exclusions, finished chunks); learning progress (valid test periods,
   results it never trained on, fresh days and ideas since a candidate was
   registered, the next gate); the candidate (training cut-off, artifact,
   comparison with the current model and controls, costs, worst fall, how
   wrong its odds were, uncertainty, verdict); history and safety (failed
   trials, the original legacy losses, capital continuity, pause reasons, data
   quality); and an evidence checklist in place of any maturity score.

   One read of the public `history_overview` totals view, refreshed only while
   the page is visible. Historical results are never added to the virtual
   account, and never count as fresh trading days. */

import { useCallback, useEffect, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { useLiveRefresh } from "@/lib/hooks/useLiveRefresh";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { Term } from "@/components/ui/Glossary";
import ShowNumbers from "@/components/ui/ShowNumbers";
import type { HistFold, HistOverview, HistPeriodMetrics } from "@/lib/history/view";
import {
  EXCLUSION_WORDS, FINAL_VERDICT_WORDS, HIST_LEDE, HIST_NAME, STUDY_STATUS_WORDS, TRIAL_STATUS_WORDS,
  dayWords, finalExplainer, historyChecklist, historyHeadline, monthWords, nextGate, specLine,
} from "@/lib/plain/history";
import { CHECK_WORDS, VERSION_STATUS_WORDS, skipWords } from "@/lib/plain/experiment";
import { PREREG } from "@/lib/experiment/prereg";
import page from "@/components/ui/page.module.css";
import exp from "@/components/experiment/experiment.module.css";
import styles from "./history.module.css";

const int = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : "—");
const num = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const MARK: Record<string, string> = { done: "✓", collecting: "…", open: "!", waiting: "·" };

function Folds({ folds }: { folds: HistFold[] | null }) {
  if (!folds?.length) return <p className={page.note}>No test periods could be formed.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.folds}>
        <caption className={page.note}>
          Each test period trains only on earlier days, minus a 5-day gap so no answer leaks in. It needs at least {PREREG.gates.minTrainRows} training ideas.
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Trained on</th>
            <th scope="col">Left out (gap)</th>
            <th scope="col">Tested on</th>
            <th scope="col">Days</th>
          </tr>
        </thead>
        <tbody>
          {folds.map((f) => (
            <tr key={f.fold} className={f.valid ? "" : styles.thin}>
              <td>
                {f.fold}
                {f.valid ? "" : " (too thin)"}
              </td>
              <td>{int(f.trainRows)}</td>
              <td>{int(f.purgedRows)}</td>
              <td>{int(f.testRows)}</td>
              <td>{int(f.testSessions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeriodFacts({ m, money }: { m: HistPeriodMetrics | null; money: (v: number) => string }) {
  if (!m) return <p className={page.note}>Not measured.</p>;
  return (
    <dl className={exp.facts}>
      <dt>Ideas it never trained on</dt>
      <dd>
        {int(m.nOos)} over {int(m.nSessions)} trading days
      </dd>
      <dt>Gain per idea vs the current model</dt>
      <dd>
        {money(m.delta.est)} (likely {money(m.delta.lo)} to {money(m.delta.hi)})
      </dd>
      <dt>Net per idea vs not trading ($0)</dt>
      <dd>
        {money(m.expectancy.est)} (likely {money(m.expectancy.lo)} to {money(m.expectancy.hi)})
      </dd>
      <dt>Beat random picks</dt>
      <dd>{num(m.randomPct, 0)}th percentile</dd>
      <dt>Took</dt>
      <dd>
        {typeof m.selected === "number" ? `${int(m.selected)} of ${int(m.nOos)} ideas` : `${Math.round(m.takeRate * 100)}% of ${int(m.nOos)} ideas`}
      </dd>
      <dt>Costs paid</dt>
      <dd>{typeof m.costs === "number" ? money(m.costs) : "—"}</dd>
      <dt>Worst fall (one contract)</dt>
      <dd>{money(m.maxDrawdown)}</dd>
      <dt>Worst likely fall (95%)</dt>
      <dd>{money(m.stressP95)}</dd>
      <dt>Costs doubled</dt>
      <dd>{money(m.costStressNet)}</dd>
      {m.portfolio && (
        <>
          <dt>Virtual account, same limits</dt>
          <dd>
            {money(m.portfolio.candidate.net)} on {int(m.portfolio.candidate.trades)} trades vs {money(m.portfolio.incumbent.net)} on{" "}
            {int(m.portfolio.incumbent.trades)} for the current model
          </dd>
        </>
      )}
      <dt>How wrong its odds were (lower is better)</dt>
      <dd>
        {num(m.brierC, 3)} vs {num(m.brierInc, 3)} current{typeof m.brierBase === "number" ? `, ${num(m.brierBase, 3)} average-rate guess` : ""} (n={int(m.nOos)})
      </dd>
      {typeof m.logLossC === "number" && (
        <>
          <dt>Log loss (lower is better)</dt>
          <dd>
            {num(m.logLossC, 3)} vs {num(m.logLossBase, 3)} average-rate guess
          </dd>
        </>
      )}
      {m.reliability && m.reliability.length > 0 && (
        <>
          <dt>Said vs happened (10 groups)</dt>
          <dd>{m.reliability.map((b) => `${Math.round(b.meanPredicted * 100)}→${Math.round(b.actual * 100)}% (n=${b.n})`).join(" · ")}</dd>
        </>
      )}
    </dl>
  );
}

export default function HistorySection() {
  const { mask } = usePrivacy();
  const learner = useExperiment();
  const [data, setData] = useState<HistOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getNeon().from("history_overview").select("*").order("registered_at", { ascending: false }).limit(1);
      if (res.error) throw new Error(res.error.message);
      setData((res.data?.[0] ?? null) as HistOverview | null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load(), 10 * 60_000);

  const money = (v: number) =>
    Number.isFinite(v) ? mask(v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })) : "—";
  const head = historyHeadline(data);
  const checklist = historyChecklist(data);
  const h = data;
  const ds = h?.dataset ?? null;
  const ch = h?.chunks ?? null;
  const ex = h?.examples ?? null;
  const fin = h?.final ?? null;
  const selected = h?.trials.find((t) => t.ordinal === fin?.trial_ordinal) ?? h?.trials.find((t) => t.status === "selected") ?? null;
  const failedTrials = h?.trials.filter((t) => t.status === "failed_coverage" || t.status === "invalid") ?? [];
  const exclusions = Object.entries(ds?.exclusions ?? {}).filter(([, n]) => n > 0);
  const skipped = Object.entries(ex?.by_reason ?? {}).filter(([r]) => r !== "taken").sort((a, b) => b[1] - a[1]);

  return (
    <section className={page.stack} aria-label={HIST_NAME} id="history">
      <div className={page.sectionHead}>
        <h2>
          <Term k="historicalPractice">{HIST_NAME}</Term>
        </h2>
      </div>
      <p className={page.paperLine}>VIRTUAL ONLY · Older market data · Never counts as fresh trading days</p>

      <section className={`${page.card} ${exp.card}`} aria-label="Where it stands">
        <p className={styles.headline}>{head.first}</p>
        {head.second && <p className={styles.headline}>{head.second}</p>}
        <p className={page.note}>{HIST_LEDE}</p>
      </section>

      {failed && !data ? (
        <p className={page.warning}>
          Historical practice could not load.{" "}
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : !loaded ? (
        <p className={page.loading}>Loading historical practice…</p>
      ) : (
        <>
          <section className={`${page.card} ${exp.card}`} aria-label="Evidence checklist">
            <h3 className={page.cardTitle}>Evidence checklist</h3>
            <ol className={styles.checklist}>
              {checklist.map((c) => (
                <li key={c.key}>
                  <span className={`${styles.mark} ${c.tone === "dim" ? "" : styles[`mark_${c.tone}`]}`} aria-hidden>
                    {MARK[c.state]}
                  </span>
                  <b>{c.label}</b>
                  <small>{c.reason}</small>
                </li>
              ))}
            </ol>
            <p className={page.note}>There is no maturity score. Each line is a separate fact, and the last one never means proven for real money.</p>
          </section>

          {!h ? (
            <p className={page.empty}>The study has not been registered yet. When it is, its rules are frozen before any older result is read.</p>
          ) : (
            <>
              <section className={`${page.card} ${exp.card}`} aria-label="Older data replayed">
                <h3 className={page.cardTitle}>Older data replayed</h3>
                <dl className={exp.facts}>
                  <dt>Source</dt>
                  <dd>
                    {h.scope?.source === "databento" ? "The bot's own Databento archive" : h.scope?.source ?? "—"} · {(h.scope?.symbols ?? []).join(" and ")}
                  </dd>
                  <dt>Dates</dt>
                  <dd>
                    {dayWords(h.scope?.from)} to {dayWords(h.scope?.to)}
                  </dd>
                  <dt>Market-months replayed</dt>
                  <dd>
                    {int(ch?.done)} of {int(h.planned_chunks)}
                    {ch?.failed ? ` · ${int(ch.failed)} to retry` : ""}
                  </dd>
                  <dt>Price bars checked</dt>
                  <dd>{int(ch?.bars)} reads</dd>
                  <dt>Gaps flagged (bars missing)</dt>
                  <dd>
                    {int(ch?.gaps)} ({int(ch?.missing_bars)} bars) — marked, never filled in
                  </dd>
                  <dt>Contract-roll jumps and bad bars</dt>
                  <dd>
                    {int(ch?.discontinuities)} jumps · {int(ch?.ohlc_bad)} bad bars · {int(ch?.duplicates)} duplicates
                  </dd>
                  <dt>How these are counted</dt>
                  <dd>Each month is read with the 60 days before it and 2 days after, so the same bar, gap or jump is usually counted in about three windows.</dd>
                  <dt>Ideas the methods produced</dt>
                  <dd>{int(ch?.ideas)}</dd>
                  <dt>Ideas with a finished result</dt>
                  <dd>{int(ex?.closed)}</dd>
                  <dt>Unique ideas it could learn from</dt>
                  <dd>
                    {ds ? `${int(ds.rows)} over ${int(ds.sessions)} trading days` : "Counted when the test runs"}
                  </dd>
                  <dt>Delay modelled</dt>
                  <dd>
                    About {Math.round((h.observation_lag_sec ?? 0) / 60)} minutes after each setup, then the next 15-minute check (modelled, not recorded)
                  </dd>
                </dl>
                {(exclusions.length > 0 || skipped.length > 0) && (
                  <ShowNumbers label="Why ideas were left out">
                    {skipped.length > 0 && (
                      <ul className={exp.checks}>
                        {skipped.map(([r, n]) => (
                          <li key={r}>
                            {skipWords(r)} — {int(n)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {exclusions.length > 0 && (
                      <dl className={exp.facts}>
                        {exclusions.map(([k, n]) => (
                          <div key={k} style={{ display: "contents" }}>
                            <dt>{EXCLUSION_WORDS[k] ?? k}</dt>
                            <dd>{int(n)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {ds?.familyAudit && (
                      <p className={page.note}>
                        Older live records in these dates: {int(ds.familyAudit.legacySignalsInScope)} trade ideas, {int(ds.familyAudit.legacySignalsMatched)} of them the
                        same ideas the replay found (the rest differ because the live engine priced them on a different feed). Also{" "}
                        {int(ds.familyAudit.shadowRowsInScope)} shadow rows from other research methods that the learner does not trade, so{" "}
                        {int(ds.familyAudit.shadowRowsMatched)} map onto these ideas. Each idea is counted once, and none of these older results is used as an answer to
                        learn from.
                      </p>
                    )}
                  </ShowNumbers>
                )}
              </section>

              <section className={`${page.card} ${exp.card}`} aria-label="Learning progress">
                <h3 className={page.cardTitle}>Learning progress</h3>
                <dl className={exp.facts}>
                  <dt>Test periods with enough data</dt>
                  <dd>
                    {selected?.folds ? `${selected.folds.filter((f) => f.valid).length} of ${selected.folds.length}` : "—"}
                  </dd>
                  <dt>Final-period results it never trained on</dt>
                  <dd>{fin ? int(fin.metrics.nOos) : "—"}</dd>
                  <dt>Fresh trading days since registered</dt>
                  <dd>{h.shadow ? `${int(h.shadow.fresh_sessions)} of ${PREREG.gates.freshSessions}` : "—"}</dd>
                  <dt>Fresh finished ideas since registered</dt>
                  <dd>{h.shadow ? `${int(h.shadow.fresh_closed)} of ${PREREG.gates.freshDecisions}` : "—"}</dd>
                  <dt>Passing weekly reviews</dt>
                  <dd>{h.shadow ? `${int(h.shadow.reviews_passed)} of 2` : "—"}</dd>
                  <dt>Next step</dt>
                  <dd>{nextGate(h)}</dd>
                </dl>
                <p className={page.note}>
                  Status: {STUDY_STATUS_WORDS[h.status]}
                  {h.status_reason ? ` — ${h.status_reason}` : ""}.
                </p>
              </section>

              {fin && (
                <section className={`${page.card} ${exp.card}`} aria-label="Candidate">
                  <div className={exp.head}>
                    <h3 className={page.cardTitle}>
                      <Term k="challenger">Candidate</Term> from older data
                    </h3>
                    <span className={`${page.chip} ${FINAL_VERDICT_WORDS[fin.verdict]?.tone === "bad" ? page.chip_red : page.chip_amber}`}>
                      {FINAL_VERDICT_WORDS[fin.verdict]?.label ?? fin.verdict}
                    </span>
                  </div>
                  <p className={exp.reason}>{specLine(fin.spec)}</p>
                  {finalExplainer(fin) && <p className={exp.reason}>{finalExplainer(fin)}</p>}
                  <p className={page.note}>
                    Trained on {int(fin.train_rows)} ideas up to {dayWords(fin.train_cutoff)}, then frozen and tested once on {dayWords(h.split?.final.from)} to{" "}
                    {dayWords(h.split?.final.to)}.{" "}
                    {fin.development_exposed && (
                      <>
                        That period is <Term k="developmentExposed">already seen</Term>: earlier research looked at it, so this is a practice result, not proof.
                      </>
                    )}
                  </p>
                  {Object.keys(fin.checks ?? {}).length > 0 && (
                    <ul className={exp.checks}>
                      {Object.entries(fin.checks).map(([k, ok]) => (
                        <li key={k} className={ok ? exp.ok : ""}>
                          {CHECK_WORDS[k] ?? k}
                        </li>
                      ))}
                    </ul>
                  )}
                  {h.shadow && (
                    <p className={page.note}>
                      Watching fresh ideas since {dayWords(h.shadow.registered_at)} · {VERSION_STATUS_WORDS[h.shadow.status] ?? h.shadow.status} · scored {int(h.shadow.scored)} ideas beside the
                      current model without changing a single decision.
                    </p>
                  )}
                  <ShowNumbers label="Show the numbers">
                    <PeriodFacts m={fin.metrics} money={money} />
                    <dl className={exp.facts}>
                      <dt>Frozen version</dt>
                      <dd className={styles.hash}>{fin.artifact_id}</dd>
                      <dt>Fingerprint</dt>
                      <dd className={styles.hash}>{fin.artifact_hash.slice(0, 16)}</dd>
                    </dl>
                  </ShowNumbers>
                </section>
              )}

              {h.trials.length > 0 && (
                <section className={page.stack} aria-label="Registered versions">
                  <div className={page.sectionHead}>
                    <h3>The {h.trials.length} registered versions · all kept</h3>
                  </div>
                  {h.trials.map((t) => {
                    const w = TRIAL_STATUS_WORDS[t.status];
                    return (
                      <article key={t.ordinal} className={`${page.card} ${exp.card}`}>
                        <div className={exp.head}>
                          <h4 className={page.cardTitle}>Version {t.ordinal}</h4>
                          <span className={`${page.chip} ${w?.tone === "bad" ? page.chip_red : w?.tone === "warn" ? page.chip_amber : page.chip_dim}`}>{w?.label ?? t.status}</span>
                        </div>
                        <p className={exp.reason}>{specLine(t.spec)}</p>
                        {t.reason && <p className={page.note}>{t.reason}</p>}
                        <ShowNumbers label="Test periods and numbers">
                          <Folds folds={t.folds} />
                          {t.development && (
                            <>
                              <p className={exp.subTitle}>Training years, tested period by period</p>
                              <PeriodFacts m={t.development} money={money} />
                            </>
                          )}
                          {t.validation && (
                            <>
                              <p className={exp.subTitle}>Check period ({dayWords(h.split?.validation.from)} to {dayWords(h.split?.validation.to)})</p>
                              <PeriodFacts m={t.validation} money={money} />
                            </>
                          )}
                        </ShowNumbers>
                      </article>
                    );
                  })}
                </section>
              )}

              <section className={`${page.card} ${exp.card}`} aria-label="History and safety">
                <h3 className={page.cardTitle}>History and safety</h3>
                <dl className={exp.facts}>
                  <dt>Virtual account</dt>
                  <dd>
                    Unchanged by this study: no refill, no reset, no older profit added.
                    {learner.data?.account ? ` It holds ${money(Number(learner.data.account.equity))} of virtual money today.` : ""}
                  </dd>
                  <dt>Versions that failed</dt>
                  <dd>{failedTrials.length ? failedTrials.map((t) => `Version ${t.ordinal}: ${TRIAL_STATUS_WORDS[t.status]?.label.toLowerCase()}`).join("; ") : "None so far"}</dd>
                  <dt>Take-every-idea on older data</dt>
                  <dd>
                    {money(ex?.take_all_net_observation ?? NaN)} with the delay · {money(ex?.take_all_net_strategy ?? NaN)} at the setup time (one contract each, after costs)
                  </dd>
                  <dt>Original live ideas (kept as they were)</dt>
                  <dd>
                    {int(h.legacy_signals?.signals)} ideas, {int(h.legacy_signals?.signals_closed)} finished, {money(h.legacy_signals?.signals_net ?? NaN)}
                  </dd>
                  <dt>Original shadow results</dt>
                  <dd>
                    {int(h.legacy_shadows?.shadows)} rows, {int(h.legacy_shadows?.shadows_closed)} finished, {money(h.legacy_shadows?.shadows_net ?? NaN)}
                  </dd>
                  <dt>Data quality</dt>
                  <dd>
                    {int(ch?.gaps)} gaps and {int(ch?.discontinuities)} contract-roll jumps found; ideas near them are left out
                  </dd>
                  <dt>Last run</dt>
                  <dd>
                    {h.last_run ? `${h.last_run.stage}, ${h.last_run.status}${h.last_run.message ? ` — ${h.last_run.message}` : ""}` : "None yet"}
                  </dd>
                  <dt>Running cost</dt>
                  <dd>
                    $0 · {Math.round(((h.budget?.replayActiveMs ?? 0) / 60_000) * 10) / 10} of {h.budget_caps?.initialBatchActiveMinutes ?? 30} replay minutes used
                  </dd>
                </dl>
                {(h.permissions ?? []).some((p) => p.openQuestion) && (
                  <p className={page.note}>
                    Open question for the owner: {(h.permissions ?? []).find((p) => p.openQuestion)!.openQuestion}
                  </p>
                )}
                <ShowNumbers label="Who looked at which dates before">
                  <dl className={exp.facts}>
                    {(h.prior_use ?? []).map((p) => (
                      <div key={p.from} style={{ display: "contents" }}>
                        <dt>
                          {dayWords(p.from)} – {dayWords(p.to)}
                        </dt>
                        <dd>{p.use}</dd>
                      </div>
                    ))}
                    {h.beginnings &&
                      Object.entries(h.beginnings).map(([k, b]) => (
                        <div key={k} style={{ display: "contents" }}>
                          <dt>{k === "codeHistory" ? "Code history begins" : k === "marketArchive" ? "Market archive begins" : "Experimental learner begins"}</dt>
                          <dd>{dayWords(b.date)}</dd>
                        </div>
                      ))}
                    <dt>Replayed months</dt>
                    <dd>
                      {monthWords(ch?.first_month)} to {monthWords(ch?.last_month)}
                    </dd>
                  </dl>
                </ShowNumbers>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
