"use client";

/* Learn (/brain) — what the experimental learner has tried, kept or
   rejected (LearnSection), then the bot's health and how close a method is
   to trading practice money.

   The path a method has to walk is drawn as three steps — Watch, Test,
   Practice — so "Researching" stops being jargon: the bot is stuck at Test
   because no method has passed every check. Below that: plain health, the
   practice money, each method's verdict and progress, and the activity log.
   Every detail opens in a sheet. Limits come from PAPER_RISK, never typed. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePaper } from "@/components/providers/PaperProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { getNeon } from "@/lib/neon/client";
import { botState, candidateName, freshTraining, type Candidate, type Position } from "@/lib/paper/overview";
import { PAPER_RISK } from "@/lib/paper/policy";
import { COMPONENT_LABELS } from "@/lib/engine/markers";
import { DAILY_FUNNEL_STAT_KEY, parseDailyFunnel, summarizeDailyFunnel, type DailyFunnelPayload } from "@/lib/signals/daily-funnel";
import { healthLook } from "@/lib/plain/bot";
import { sentenceCase } from "@/lib/plain/text";
import { FORWARD_DAYS, FORWARD_TRADES, forwardProgress, historicalOf, methodVerdict } from "@/lib/plain/methods";
import { fmtStamp } from "@/lib/time/session";
import { nyMeta, tradingDayKey } from "@/lib/time/ny";
import StatusHero from "@/components/ui/StatusHero";
import ShowNumbers from "@/components/ui/ShowNumbers";
import { Term } from "@/components/ui/Glossary";
import { Button } from "@/components/ui";
import BottomSheet, { SheetClose } from "@/components/ui/BottomSheet";
import page from "@/components/ui/page.module.css";
import styles from "./bot.module.css";
import LearnSection from "./LearnSection";

type Sheet = "how" | "risk" | "learned" | Candidate | Position | null;

export default function BotClient() {
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
  const state = botState(paper.data, failed);
  const account = paper.data?.account ?? null;
  const positions = paper.data?.positions ?? [];
  const open = positions.filter((p) => !p.closed_at);
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

  const title =
    sheet === "how"
      ? "How the bot works"
      : sheet === "risk"
        ? "Practice account limits"
        : sheet === "learned"
          ? "What the bot learned"
          : sheet && "candidate_key" in sheet
            ? candidateName(sheet.candidate_key)
            : sheet
              ? `${sheet.symbol} · ${sheet.side === "LONG" ? "Buy" : "Sell"}`
              : "Details";

  return (
    <div className={page.page}>
      <header className={page.head}>
        <div className={page.titleRow}>
          <h1 className="pageTitle">Learn</h1>
          <Button variant="ghost" onClick={() => setSheet("how")}>
            How it works
          </Button>
        </div>
        <p className={page.paperLine}>Virtual and practice only · Delayed prices · No real orders</p>
      </header>

      {paper.errors.length > 0 && (
        <p role="alert" className={page.warning}>
          {paper.errors.join(", ")} could not refresh. Figures may be old.{" "}
          <button type="button" onClick={paper.refresh}>
            Retry
          </button>
        </p>
      )}

      <StatusHero />

      <LearnSection />

      <div className={page.sectionHead}>
        <h2>The bot and practice money</h2>
      </div>

      <section className={page.card} aria-label="Where the bot is">
        <ol className={styles.steps}>
          {[
            { n: 1, name: "Watch", text: "Checks prices every 15 minutes" },
            { n: 2, name: "Test", text: "Each method must beat chance" },
            { n: 3, name: "Practice", text: "Trades practice money" },
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
            ? "A method passed every check and is trading practice money."
            : `Stuck at Test: ${passed} of ${paper.candidates.length} method${paper.candidates.length === 1 ? "" : "s"} passed its history test, and none has passed every check. Practice starts only after one does.`}
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

      <section className={page.card} aria-label="Practice money" id="practice">
        <div className={styles.cardHead}>
          <h2 className={page.cardTitle}>
            <Term k="practiceMoney">Practice money</Term>
          </h2>
          <button type="button" className={page.linkButton} onClick={() => setSheet("risk")}>
            Limits ↗
          </button>
        </div>
        <div className={page.tiles}>
          <div className={page.tile}>
            <span>
              <Term k="equity">Balance</Term>
            </span>
            <b>{cash(account?.equity)}</b>
          </div>
          <div className={page.tile}>
            <span>Today</span>
            <b>{account?.day_key === todayKey ? cash(account?.daily_pnl) : "—"}</b>
          </div>
          <div className={page.tile}>
            <span>
              <Term k="openRisk">At risk</Term>
            </span>
            <b>{cash(account?.open_risk)}</b>
          </div>
        </div>
        {!account || failed ? (
          <p className={page.note}>{paper.loading ? "Checking positions…" : "Positions not verified"}</p>
        ) : open.length ? (
          <div className={page.list}>
            {open.map((p) => (
              <button key={p.id} type="button" className={page.row} onClick={() => setSheet(p)}>
                <span className={page.rowMain}>
                  <b>
                    {p.symbol} · {p.side === "LONG" ? "Buy" : "Sell"}
                  </b>
                  <span>
                    {p.qty} contract{p.qty === 1 ? "" : "s"} · open
                  </span>
                </span>
                <span className={page.rowSide}>
                  <b className="num">{cash(p.risk)}</b>
                  <small className={page.dim}>planned risk ↗</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className={page.note}>
            {!release && positions.length === 0
              ? "No practice trade has ever been placed — no method has qualified yet."
              : "No practice trade is open."}{" "}
            Balance and today include any open trade.
          </p>
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
          {sheet === "how" && <HowItWorks />}
          {sheet === "risk" && <RiskLimits cash={cash} />}
          {sheet === "learned" && <WhatItLearned model={paper.data?.model ?? null} learning={paper.data?.learning ?? null} stamp={stamp} />}
          {sheet && typeof sheet === "object" && "candidate_key" in sheet && <MethodDetails c={sheet} cash={cash} />}
          {sheet && typeof sheet === "object" && "symbol" in sheet && (
            <>
              <p>
                {sheet.closed_at ? "Closed practice trade" : "Open practice trade"} · {sheet.qty} contract{sheet.qty === 1 ? "" : "s"}
              </p>
              <dl className={styles.facts}>
                {Object.entries({
                  Entry: sheet.entry,
                  Stop: sheet.stop,
                  Target: sheet.target,
                  "Planned risk": cash(sheet.risk),
                  "Result after costs": sheet.closed_at ? cash(sheet.pnl) : "Still open",
                }).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="num">{v}</dd>
                  </div>
                ))}
              </dl>
              <h3>Why this trade</h3>
              <p>{sheet.reason}</p>
              <p>
                Opened {stamp(sheet.opened_at)}
                {sheet.closed_at ? ` · Closed ${stamp(sheet.closed_at)}` : ""}
              </p>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

function toneChip(tone: "good" | "warn" | "bad" | "dim"): "green" | "amber" | "red" | "dim" {
  return tone === "good" ? "green" : tone === "warn" ? "amber" : tone === "bad" ? "red" : "dim";
}

function HowItWorks() {
  return (
    <>
      <p>Nothing here sends an order to a broker. Prices are delayed 10–15 minutes.</p>
      <ol className={styles.howList}>
        <li>
          <b>Watch.</b> Every 15 minutes the bot reads the S&amp;P and Nasdaq micro futures and posts any trade idea its
          methods spot. You see those on Ideas.
        </li>
        <li>
          <b>Test.</b> Each method is tested on years of past prices against <Term k="randomTest">random entries</Term>,
          then confirmed on a separate period, then has to earn 60 <Term k="forwardEvidence">new trades</Term> over 20
          trading days and pass two weekly reviews.
        </li>
        <li>
          <b>Practice.</b> Only then does it trade the $10,000 <Term k="practiceMoney">practice account</Term>, starting
          at reduced risk.
        </li>
      </ol>
      <p>So far no method has passed, so the bot keeps watching and testing. That is the safety rule working.</p>
      <Link href="/guide">Read the full Guide →</Link>
    </>
  );
}

function RiskLimits({ cash }: { cash: (v: unknown) => string }) {
  return (
    <>
      <p>Starting balance {cash(PAPER_RISK.capital)}. It is a simulation balance.</p>
      <ul>
        <li>
          <Term k="probation">Probation</Term> risk: {cash(PAPER_RISK.probationRisk)} a trade.
        </li>
        <li>Full risk: {cash(PAPER_RISK.riskPerTrade)} a trade, after another weekly review passes.</li>
        <li>All open trades together: at most {cash(PAPER_RISK.totalOpenRisk)} at risk.</li>
        <li>Daily loss limit: {cash(PAPER_RISK.dailyLoss)}, counting open trades.</li>
        <li>
          <Term k="drawdown">Drawdown</Term> lock: {cash(PAPER_RISK.maxDrawdown)} below the account&apos;s highest balance.
        </li>
      </ul>
      <p>
        Trade size includes <Term k="costs">costs</Term>. A trade is skipped if one contract would risk more than the
        budget. Fast markets can lose more than the planned stop. There is no compounding.
      </p>
    </>
  );
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
      <p>A failed or missing check blocks practice trading. More data never turns a failed result into a pass by itself.</p>
    </>
  );
}
