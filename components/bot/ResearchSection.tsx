"use client";

/* Research qualification and source-engine health. The retired account's
   records remain available to the research provider, but no balance is shown. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePaper } from "@/components/providers/PaperProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { getNeon } from "@/lib/neon/client";
import { candidateName, freshTraining, type Candidate } from "@/lib/paper/overview";
import { COMPONENT_LABELS } from "@/lib/engine/markers";
import { DAILY_FUNNEL_STAT_KEY, parseDailyFunnel, summarizeDailyFunnel, type DailyFunnelPayload } from "@/lib/signals/daily-funnel";
import { healthLook } from "@/lib/plain/bot";
import { sentenceCase } from "@/lib/plain/text";
import { FORWARD_DAYS, FORWARD_TRADES, forwardProgress, historicalOf, methodVerdict } from "@/lib/plain/methods";
import { fmtStamp } from "@/lib/time/session";
import { nyMeta, tradingDayKey } from "@/lib/time/ny";
import ShowNumbers from "@/components/ui/ShowNumbers";
import { Term } from "@/components/ui/Glossary";
import { Button } from "@/components/ui";
import BottomSheet, { SheetClose } from "@/components/ui/BottomSheet";
import page from "@/components/ui/page.module.css";
import styles from "./bot.module.css";

type Sheet = "learned" | Candidate | null;

export default function ResearchSection() {
  const paper = usePaper();
  const health = useBotHealth();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [allActivity, setAllActivity] = useState(false);
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const close = useCallback(() => setSheet(null), []);

  useEffect(() => {
    const tick = () => setTodayKey(nyMeta(Date.now() / 1000).dateKey);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const failed = paper.errors.includes("Account");
  const release = paper.data?.release ?? null;
  const trainingFresh = freshTraining(paper.data?.learning ?? null);
  const look = healthLook(health);

  const cash = (v: unknown) =>
    v === null || v === undefined || !Number.isFinite(Number(v))
      ? "—"
      : mask(Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }));
  const stamp = (v?: string | null) => (v ? fmtStamp(v, zone) : "Not recorded");

  const passed = paper.candidates.filter((c) => historicalOf(c)?.gate?.promote).length;
  const step = release?.status === "active" || release?.status === "probation" ? 3 : 2;

  const title = sheet === "learned" ? "What the bot learned" : sheet ? candidateName(sheet.candidate_key) : "Details";

  return (
    <div className={page.page}>
      {paper.errors.length > 0 && (
        <p role="alert" className={page.warning}>
          {paper.errors.join(", ")} could not refresh. Figures may be old.{" "}
          <button type="button" onClick={paper.refresh}>
            Retry
          </button>
        </p>
      )}

      <div className={page.sectionHead}>
        <h2>Method qualification</h2>
      </div>

      <section className={page.card} aria-label="Where the bot is">
        <ol className={styles.steps}>
          {[
            { n: 1, name: "Watch", text: "Checks prices every 15 minutes" },
            { n: 2, name: "Test", text: "Each method must beat chance" },
            { n: 3, name: "Qualified", text: "Qualification passed" },
          ].map((s) => (
            <li
              key={s.n}
              className={`${styles.step} ${s.n < step ? styles.stepDone : s.n === step ? styles.stepNow : styles.stepLater}`}
              aria-current={s.n === step ? "step" : undefined}
            >
              <span className={styles.stepDot} aria-hidden>
                {s.n < step ? "✓" : s.n}
              </span>
              <b>{s.name}</b>
              <small>{s.text}</small>
            </li>
          ))}
        </ol>
        <p className={page.note}>
          {step === 3
            ? "A method passed every qualification check. The virtual account runs separately from qualification."
            : `Research status: ${passed} of ${paper.candidates.length} method${paper.candidates.length === 1 ? "" : "s"} passed its history test, and none has passed every check. The virtual account runs separately from qualification.`}
        </p>
      </section>

      <section className={page.list} aria-label="Health" id="health">
        <div className={page.setting}>
          <span className={page.rowMain}>
            <b>Price checks</b>
            <span>{look.detail}</span>
          </span>
          <span className={page.rowSide}>
            <span className={`${page.chip} ${page[`chip_${toneChip(look.tone)}`]}`}>{look.label}</span>
            <small className={page.dim}>{stamp(health.lastRun?.ran_at)}</small>
          </span>
        </div>
        <button type="button" className={page.row} onClick={() => setSheet("learned")}>
          <span className={page.rowMain}>
            <b>Learning</b>
            <span>Nightly study of finished trades · tap for what it found</span>
          </span>
          <span className={page.rowSide}>
            <span className={`${page.chip} ${page[`chip_${failed ? "amber" : !paper.data ? "dim" : trainingFresh ? "green" : "amber"}`]}`}>
              {failed ? "Not verified" : !paper.data ? "Checking…" : trainingFresh ? "Up to date" : "Needs attention"}
            </span>
            <small className={page.dim}>{stamp(paper.data?.learning?.finished_at)}</small>
          </span>
        </button>
        {health.failing.length > 0 && (
          <div className={page.setting}>
            <span className={page.rowMain}>
              <b>Needs attention</b>
              <span>
                {[...new Set(health.failing.map((c) => COMPONENT_LABELS[c]))].join(", ")} had a problem on the last check.
                Trade ideas are still being checked.
              </span>
            </span>
          </div>
        )}
      </section>

      <section className={page.stack} aria-label="Methods being tested">
        <div className={page.sectionHead}>
          <h2>Methods being tested</h2>
          <span className={page.dim} style={{ fontSize: 12 }}>
            after <Term k="costs">costs</Term>
          </span>
        </div>
        {paper.errors.includes("Research") && <p className={page.warning}>Test results may be incomplete.</p>}
        {!paper.candidates.length ? (
          <p className={page.empty}>{paper.loading ? "Loading test results…" : "No test results yet."}</p>
        ) : (
          <div className={page.list}>
            {paper.candidates.map((c) => {
              const v = methodVerdict(c);
              const h = historicalOf(c);
              return (
                <button key={c.candidate_key} type="button" className={page.row} onClick={() => setSheet(c)}>
                  <span className={page.rowMain}>
                    <b>{candidateName(c.candidate_key)}</b>
                    <span>{v.detail}</span>
                    <span className={styles.meter} aria-label={`New trades ${c.forward_closed} of ${FORWARD_TRADES}`}>
                      <i style={{ width: `${Math.round(forwardProgress(c) * 100)}%` }} />
                    </span>
                    <small className={page.dim}>
                      {c.forward_closed} of {FORWARD_TRADES} new trades · {c.forward_days} of{" "}
                      {FORWARD_DAYS} days
                    </small>
                  </span>
                  <span className={page.rowSide}>
                    <span className={`${page.chip} ${page[`chip_${v.tone}`]}`}>{v.label}</span>
                    {h && <b className={`num ${Number(h.net) >= 0 ? page.good : page.bad}`}>{cash(h.net)}</b>}
                    {h && <small className={page.dim}>n={h.n ?? 0} ↗</small>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className={page.stack} aria-label="Latest activity">
        <div className={page.sectionHead}>
          <h2>Latest activity</h2>
          {paper.activity.length > 3 && (
            <button type="button" className={page.linkButton} onClick={() => setAllActivity((v) => !v)}>
              {allActivity ? "Show less" : "Show all"}
            </button>
          )}
        </div>
        {paper.activity.length ? (
          <ol className={styles.activity}>
            {paper.activity.slice(0, allActivity ? paper.activity.length : 3).map((a) => (
              <li key={a.id}>
                <span className={styles.activityDot} aria-hidden />
                <div>
                  <b>
                    {a.kind}
                    {a.candidate_key ? ` · ${candidateName(a.candidate_key)}` : ""}
                  </b>
                  <p>{a.detail}</p>
                  <small>{stamp(a.at)}</small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={page.empty}>
            {paper.errors.includes("Activity") ? "Activity could not be loaded." : paper.loading ? "Loading activity…" : "No recorded activity yet."}
          </p>
        )}
      </section>

      <div className={styles.footer}>
        <span>Checked {stamp(paper.loadedAt)}</span>
        <button
          type="button"
          className={page.linkButton}
          onClick={() => {
            paper.refresh();
            health.refresh();
          }}
        >
          Refresh
        </button>
      </div>

      <details className={page.details}>
        <summary>For researchers</summary>
        <div className={page.list}>
          <Link href="/diagnostics" className={page.row}>
            <span className={page.rowMain}>
              <b>Diagnostics</b>
              <span>The beat-random test, cell by cell</span>
            </span>
            <span className={page.chev}>›</span>
          </Link>
          <Link href="/lab" className={page.row}>
            <span className={page.rowMain}>
              <b>Strategy Lab</b>
              <span>Test a method on past prices yourself</span>
            </span>
            <span className={page.chev}>›</span>
          </Link>
          <Link href="/replay" className={page.row}>
            <span className={page.rowMain}>
              <b>Journal</b>
              <span>Record your own decisions</span>
            </span>
            <span className={page.chev}>›</span>
          </Link>
        </div>
      </details>

      <BottomSheet open={sheet !== null} onClose={close} title={title}>
        <div className={styles.sheetHead}>
          <h2>{title}</h2>
          <SheetClose onClose={close} />
        </div>
        <div className={styles.sheet}>
          {sheet === "learned" && <WhatItLearned model={paper.data?.model ?? null} learning={paper.data?.learning ?? null} stamp={stamp} />}
          {sheet && typeof sheet === "object" && "candidate_key" in sheet && <MethodDetails c={sheet} cash={cash} />}
        </div>
      </BottomSheet>
    </div>
  );
}

function toneChip(tone: "good" | "warn" | "bad" | "dim"): "green" | "amber" | "red" | "dim" {
  return tone === "good" ? "green" : tone === "warn" ? "amber" : tone === "bad" ? "red" : "dim";
}

function WhatItLearned({
  model,
  learning,
  stamp,
}: {
  model: { status: string; train_n: number; oos_brier: number | null; baseline_brier: number | null } | null;
  learning: { status: string; finished_at: string | null } | null;
  stamp: (v?: string | null) => string;
}) {
  const [funnel, setFunnel] = useState<DailyFunnelPayload | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(
      getNeon()
        .from("learned_stats")
        .select("payload")
        .eq("stat_key", DAILY_FUNNEL_STAT_KEY)
        .order("date_key", { ascending: false })
        .limit(1)
    ).then(({ data, error }) => {
      if (!cancelled) setFunnel(error || !data?.length ? null : parseDailyFunnel(data[0].payload));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const summary = useMemo(
    () => (funnel === undefined ? null : summarizeDailyFunnel(funnel ?? null, tradingDayKey(Date.now() / 1000))),
    [funnel]
  );
  const beatsGuess =
    model && model.oos_brier !== null && model.baseline_brier !== null ? model.oos_brier < model.baseline_brier : null;

  return (
    <>
      <p>
        Every night the bot studies its finished trade ideas. Last run: {learning?.status === "ok" ? "finished" : learning?.status ?? "not recorded"}{" "}
        · {stamp(learning?.finished_at)}.
      </p>
      <h3>Can it tell good ideas from bad ones?</h3>
      <p>
        {model === null
          ? "No scoring model has been trained yet."
          : beatsGuess === null
            ? "The scoring model's accuracy has not been measured yet."
            : beatsGuess
              ? "Its scoring model predicts winners slightly better than a simple guess."
              : "Not yet. Its scoring model predicts winners worse than a simple guess, so it stays switched off and scores nothing."}
      </p>
      <h3>Why ideas were turned away</h3>
      <p>{summary ? sentenceCase(summary.sentence) : "Loading the latest check…"}</p>
      <ShowNumbers>
        {model && (
          <p>
            Model {model.status} · trained on n={model.train_n} closed ideas · prediction error{" "}
            {model.oos_brier?.toFixed(4) ?? "not measured"} vs simple guess {model.baseline_brier?.toFixed(4) ?? "not measured"}{" "}
            (lower is better).
          </p>
        )}
        {summary && summary.blockers.length > 0 && (
          <ul>
            {summary.blockers.slice(0, 6).map((b) => (
              <li key={b.reason}>
                {b.label}: {b.count.toLocaleString("en-US")}
              </li>
            ))}
          </ul>
        )}
      </ShowNumbers>
      <p>Learning studies finished results. It can&apos;t turn a method that doesn&apos;t beat chance into one that does.</p>
    </>
  );
}

function MethodDetails({ c, cash }: { c: Candidate; cash: (v: unknown) => string }) {
  const h = c.historical as {
    n?: number;
    net?: number;
    gate?: { checks?: { key: string; label: string; status: string; detail: string }[] };
  } | null;
  const conf = c.confirmation as {
    n?: number;
    gate?: { promote?: boolean };
    dataQuality?: { ready: boolean; missingBars: number };
  } | null;
  const v = methodVerdict(c);
  return (
    <>
      <p className={styles[`verdict_${v.tone}`]}>
        <b>{v.label}.</b> {v.detail}
      </p>
      <ol className={styles.howList}>
        <li>
          <b>History test</b>
          <br />
          {h ? `${cash(h.net)} after costs over n=${h.n ?? 0} test trades` : "Not measured yet"}
        </li>
        <li>
          <b>Separate confirmation</b>
          <br />
          {conf
            ? `${conf.dataQuality?.ready === false ? "Missing price data blocks this check" : conf.gate?.promote ? "Passed" : "Did not pass"} · n=${conf.n ?? 0}`
            : "Waiting for a separate test"}
          {conf?.dataQuality?.ready === false && ` (${conf.dataQuality.missingBars} missing bars — provisional)`}
        </li>
        <li>
          <b>New trades</b>
          <br />
          {c.forward_closed} of {FORWARD_TRADES} closed trades over {c.forward_days} of {FORWARD_DAYS} trading days · net{" "}
          {cash(c.forward_net)}
        </li>
        <li>
          <b>Weekly reviews</b>
          <br />
          {c.weekly_passes} passed. Two passing reviews at least six days apart, with ten new trades between them, are
          needed.
        </li>
      </ol>
      <ShowNumbers label="Show every check">
        {h?.gate?.checks?.length ? (
          h.gate.checks.map((x) => (
            <p key={x.key}>
              <b>
                {x.label}: {x.status === "not-measured" ? "Not measured" : x.status === "pass" ? "Passed" : "Failed"}
              </b>
              <br />
              {x.detail}
            </p>
          ))
        ) : (
          <p>No checks recorded.</p>
        )}
      </ShowNumbers>
      <p>A failed or missing check blocks qualification. More data never turns a failed result into a pass by itself.</p>
    </>
  );
}
