"use client";

/* The cards of the Today screen (TodayClient.tsx), each answering one question
   a non-trader asks, in this order:

     StatusCard    Is the bot working?          (activity, timer, next check)
     BalanceCard   How is my virtual money?     (balance, today, since start)
     StoryCard     What happened, in words?     (AI note for the owner, else the app's own words)
     LatestTrades  What did it do?              (last three decisions)
     LearningCard  Is it getting smarter?       (who is in charge, next check, AI scoreboard)
     MarketsCard   What is the market doing?    (two delayed quotes)

   Research numbers live on the other tabs and in folded sections. */

import { useState } from "react";
import Link from "next/link";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { useQuotes } from "@/components/providers/QuoteProvider";
import { useAi } from "@/components/ai/AiProvider";
import { AiByline } from "@/components/ai/AiViews";
import { TradeRow } from "@/components/trades/TradeRow";
import { useTrades } from "@/components/trades/useTrades";
import { EquityChart, Sparkline } from "@/components/widgets/TradingWidgets";
import BottomSheet from "@/components/ui/BottomSheet";
import { Term } from "@/components/ui/Glossary";
import { botActivity, nextLearningCheck } from "@/lib/plain/companion";
import { quietReasons, timerStatus } from "@/lib/plain/timer";
import { todayRecap } from "@/lib/plain/recap";
import { aiSummaryLine } from "@/lib/plain/ai";
import { EXP_BADGE_LONG, EXP_WHY, LEARNING_WORDS, expLimits, versionName } from "@/lib/plain/experiment";
import { MARKET_NAMES } from "@/lib/plain/idea";
import { learningState, nextTickSec } from "@/lib/experiment/view";
import { marketPhase } from "@/lib/time/session";
import { tradingDayKey } from "@/lib/time/ny";
import { clockIn, dateShortIn, stampIn, ZONE_ABBR } from "@/lib/time/zones";
import { money } from "@/lib/format";
import page from "@/components/ui/page.module.css";
import s from "./home.module.css";

const TONE_CLASS = { good: s.good, warn: s.warn, bad: s.bad, info: s.info } as const;

/** Is the bot working? One line of state, the timer, and three quick numbers. */
export function StatusCard({ now }: { now: number | null }) {
  const exp = useExperiment();
  const health = useBotHealth();
  const { zone } = useZone();
  const activity = botActivity(exp.data, now, exp.online, exp.failed);
  const timer = now !== null && !health.loading && exp.online
    ? timerStatus({ lastRunAt: health.lastRun?.ran_at ?? null, clock: health.clock, nowSec: now, asleep: health.asleep })
    : null;
  const attention = ["attention", "offline"].includes(activity.mood);
  const tone = activity.mood === "attention" ? "bad" : activity.mood === "offline" ? "warn" : timer?.tone ?? "info";
  const next = now ? nextTickSec(now) : null;
  const open = exp.data ? exp.data.open_positions.filter((p) => p.status === "open").length : null;
  return (
    <section className={`${page.card} ${s.status}`} aria-label="Today at a glance">
      <div className={s.statusTop}>
        <span className={`${s.dot} ${TONE_CLASS[tone]}`} aria-hidden />
        <h2>{activity.title}</h2>
        {timer && <span className={`${s.pill} ${TONE_CLASS[timer.tone]}`} role="status">Timer · {timer.title}</span>}
      </div>
      <p className={s.statusDetail}>{attention || !timer ? activity.detail : timer.detail}</p>
      {timer?.fix && <Link href="/guide#timer" className={s.fix}>How to fix it →</Link>}
      <div className={s.quick}>
        <Link href="/trades?view=open"><b className="num">{open ?? "—"}</b><span>Open trades</span></Link>
        <Link href="/trades"><b className="num">{exp.data?.today?.closed ?? "—"}</b><span>Closed today</span></Link>
        <Link href="/brain"><b className="num">{next ? clockIn(next, zone) : "—"}</b><span>Next check</span></Link>
      </div>
    </section>
  );
}

/** How is my virtual money? The balance, today, since the campaign began. */
export function BalanceCard() {
  const exp = useExperiment();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const [rules, setRules] = useState(false);
  const o = exp.data, a = o?.account ?? null;
  const since = o ? (a ? a.equity - o.experiment.capital : null) : null;
  const tone = (v: number | null | undefined) => (v == null || v === 0 ? page.dim : v > 0 ? page.good : page.bad);
  return (
    <section className={`${page.card} ${s.balance}`} aria-label="Virtual account" id="learner">
      <div className={s.balanceHead}>
        <span><Term k="virtualEquity">Virtual balance</Term></span>
        <button type="button" className={page.linkButton} onClick={() => setRules(true)}>Rules</button>
      </div>
      {exp.failed && !o ? (
        <p className={page.warning}>The virtual account couldn&apos;t be checked just now. Pull down to try again.</p>
      ) : !o ? (
        <p className={page.loading}>{exp.loading ? "Loading the virtual account…" : "The virtual account starts with its first scheduled check."}</p>
      ) : (
        <>
          <b className={`${s.balanceValue} num`}>{a ? mask(money(a.equity, false)) : "—"}</b>
          <div className={s.balanceChips}>
            <span>Today <b className={`num ${tone(o.today?.closed ? o.today.net : null)}`}>{o.today?.closed ? mask(money(o.today.net)) : "no closed trades"}</b></span>
            <span>Since {dateShortIn(Date.parse(o.experiment.started_at) / 1000, zone)} <b className={`num ${tone(since)}`}>{since === null ? "—" : mask(money(since))}</b></span>
          </div>
          <EquityChart data={o} compact />
          {a && a.unpriced_positions > 0 && <p className={page.warning}>{a.unpriced_positions} open trade(s) have no fresh price. Their result is an estimate.</p>}
          <p className={page.note}>
            Pretend money: campaign {o.experiment.campaign} started with {mask(money(o.experiment.capital, false))}.
            {o.lifetime && o.lifetime.campaigns > 1 ? ` All ${o.lifetime.campaigns} campaigns so far: ${mask(money(o.lifetime.net))}.` : ""}
          </p>
        </>
      )}
      <BottomSheet open={rules} onClose={() => setRules(false)} title="Virtual account rules">
        <div className={s.sheet}>
          <p>{EXP_WHY}</p>
          <ul>{expLimits(o?.risk).map((l) => <li key={l}>{l}</li>)}</ul>
          <p className={page.note}>{EXP_BADGE_LONG}.</p>
        </div>
      </BottomSheet>
    </section>
  );
}

/** What happened today, in plain words. */
export function StoryCard({ now }: { now: number | null }) {
  const exp = useExperiment();
  const health = useBotHealth();
  const ai = useAi();
  const { mask } = usePrivacy();
  if (now === null || !exp.data) return null;
  const note = ai.ownerStatus === "ready" ? ai.noteFor("day", tradingDayKey(now)) : null;
  const recap = todayRecap(exp.data, now, (n) => mask(money(n)));
  const openNow = exp.data.open_positions.filter((p) => p.status === "open").length;
  const quiet = !openNow && !exp.data.today?.closed ? quietReasons(exp.data, health.policy, now) : [];
  return (
    <section className={page.card} aria-label="Today in plain words">
      <h2 className={page.cardTitle}>Today in plain words</h2>
      {note ? (
        <>
          <p className={s.story}>{note.text}</p>
          <AiByline model={note.model} />
        </>
      ) : (
        <p className={s.story}>{recap.join(" ")}</p>
      )}
      {quiet.length > 0 && (
        <div className={s.quiet}>
          <b>Why it has been quiet</b>
          <ul>{quiet.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

/** What did the bot do? The last three decisions, taken or skipped. */
export function LatestTrades() {
  const trades = useTrades("all", 3);
  return (
    <section className={page.stack} aria-label="Latest trades">
      <div className={page.sectionHead}>
        <h2>Latest trades</h2>
        <Link href="/trades">All trades →</Link>
      </div>
      {trades.failed && !trades.rows.length ? (
        <p className={page.warning}>Trades could not load. <button type="button" onClick={() => void trades.load(0)}>Try again</button></p>
      ) : trades.loading && !trades.rows.length ? (
        <p className={page.loading}>Loading trades…</p>
      ) : !trades.rows.length ? (
        <p className={page.empty}>No trades yet in this campaign. Quiet days are normal: the methods wait for their setups.</p>
      ) : (
        <div className={page.list}>{trades.rows.map((r) => <TradeRow key={r.id} row={r} />)}</div>
      )}
    </section>
  );
}

/** Is it getting smarter? Who is in charge, the next learning check, the AI study. */
export function LearningCard({ now }: { now: number | null }) {
  const exp = useExperiment();
  const ai = useAi();
  const { zone } = useZone();
  const o = exp.data;
  const state = learningState(o);
  return (
    <Link href="/brain" className={`${page.card} ${s.learn} pressSm`} aria-label="Learning">
      <div className={s.learnHead}>
        <h2 className={page.cardTitle}>Is it learning?</h2>
        <span className={page.chev} aria-hidden>›</span>
      </div>
      <p><span className={s.label}>In charge</span> {versionName(o?.model?.version_id)}{o?.model?.since ? ` · since ${dateShortIn(Date.parse(o.model.since) / 1000, zone)}` : ""}</p>
      <p><span className={s.label}>Now</span> {LEARNING_WORDS[state.state]}{now ? ` · next learning check ${stampIn(nextLearningCheck(now, "learn"), zone)}` : ""}</p>
      <p className={s.aiLine}><span aria-hidden>✦</span> {aiSummaryLine(ai.primary)}</p>
    </Link>
  );
}

/** What is the market doing? Two delayed quotes, each opening its chart. */
export function MarketsCard({ now }: { now: number | null }) {
  const quotes = useQuotes();
  const phase = now === null ? null : marketPhase(now);
  return (
    <section className={page.stack} aria-label="Markets">
      <div className={page.sectionHead}>
        <h2>Markets</h2>
        <Link href="/markets">Chart →</Link>
      </div>
      <div className={s.quotes}>
        {(["MES", "MNQ"] as const).map((symbol) => {
          const q = quotes[symbol];
          const pct = q && q.previousClose ? (q.change / q.previousClose) * 100 : null;
          return (
            <Link key={symbol} href={`/markets?symbol=${symbol}`} className={`${page.card} ${s.quote} pressSm`} aria-label={`${MARKET_NAMES[symbol]} chart`}>
              <span className={s.quoteName}><Term k={symbol === "MES" ? "mes" : "mnq"}>{MARKET_NAMES[symbol]}</Term></span>
              <b className="num">{q ? q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</b>
              <span className={pct === null ? page.dim : pct >= 0 ? page.good : page.bad}>
                {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`} <small className={page.note}>today</small>
              </span>
              <Sparkline points={(q?.bars ?? []).map((b) => ({ t: b.time, y: b.close }))} label={`${MARKET_NAMES[symbol]} delayed price history`} tone={pct === null ? "blue" : pct >= 0 ? "good" : "bad"} />
            </Link>
          );
        })}
      </div>
      <p className={page.note}>
        <span className={phase?.live ? s.openDot : s.closedDot} aria-hidden /> {phase ? `${phase.label} · ${phase.detail}` : "Checking the market…"} ·{" "}
        <Term k="delayed">delayed 10–15 minutes</Term>
      </p>
    </section>
  );
}
