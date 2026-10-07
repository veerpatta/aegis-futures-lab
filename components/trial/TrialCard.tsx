"use client";

/* The trial account card — practice money that copies every trade idea.

   Today shows the compact card (balance, today, a small balance line, open
   trades with their running result). Bot shows the full card: the balance
   chart, recent closed trades, earlier rounds and the limits. Both carry the
   amber "Not proven" label, and both keep it apart from the strict practice
   account, which still only trades a method that passed every test. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTrial } from "@/components/providers/TrialProvider";
import { useQuotes } from "@/components/providers/QuoteProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { Term } from "@/components/ui/Glossary";
import BottomSheet from "@/components/ui/BottomSheet";
import EquityChart from "@/components/chart/EquityChart";
import { balanceSeries, openResult, roundRecord, type TrialPositionRow } from "@/lib/trial/overview";
import { TRIAL_BADGE, TRIAL_BADGE_LONG, TRIAL_LIMITS, TRIAL_WHY, exitWords, trialSentence } from "@/lib/plain/trial";
import { marketName } from "@/lib/plain/idea";
import { money } from "@/lib/format";
import { tradingDayKey } from "@/lib/time/ny";
import { dateShortIn, stampIn } from "@/lib/time/zones";
import { useNowSec } from "@/components/signals/useSignalFeed";
import page from "@/components/ui/page.module.css";
import styles from "./trial.module.css";

const sec = (iso: string) => Date.parse(iso) / 1000;

function Spark({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return null;
  const lo = Math.min(...points),
    hi = Math.max(...points);
  const span = hi - lo || 1;
  const path = points.map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(2)},${(36 - ((v - lo) / span) * 32 - 2).toFixed(2)}`).join(" ");
  return (
    <svg className={styles.spark} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
      <polyline points={path} className={up ? styles.sparkUp : styles.sparkDown} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function TrialCard({ variant }: { variant: "today" | "bot" }) {
  const trial = useTrial();
  const quotes = useQuotes();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const nowSec = useNowSec();
  const [sheet, setSheet] = useState<null | "limits" | TrialPositionRow>(null);

  const data = trial.data;
  const account = data?.account ?? null;
  const open = useMemo(() => (data?.positions ?? []).filter((p) => p.closed_at === null), [data]);
  const closed = useMemo(() => (data?.positions ?? []).filter((p) => p.closed_at !== null), [data]);
  const record = data ? roundRecord(data) : null;
  const series = data ? balanceSeries(data) : [];
  const priceOf = (s: "MES" | "MNQ") => quotes[s]?.price ?? null;
  const running = (p: TrialPositionRow) => {
    const price = priceOf(p.symbol);
    return price === null ? null : openResult(p, price);
  };
  const live = account ? account.equity + open.reduce((a, p) => a + ((running(p) ?? 0) - openResult(p, p.mark)), 0) : null;
  const today = account && nowSec !== null && account.day_key === tradingDayKey(nowSec) ? account.daily_pnl : null;
  const cash = (v: number | null) =>
    v === null || !Number.isFinite(v) ? "—" : mask(v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }));
  const startedLabel = account ? dateShortIn(sec(account.started_at), zone) : "";
  const sentence = account
    ? trialSentence({ locked: account.locked, startedLabel, closed: record?.n ?? 0, wins: record?.wins ?? 0, losses: record?.losses ?? 0, open: open.length })
    : null;
  const up = (live ?? account?.equity ?? 0) >= (series[0]?.balance ?? 0);
  const rounds = (data?.rounds ?? []).filter((r) => r.ended_at !== null);

  return (
    <section className={`${page.card} ${styles.card}`} aria-label="Trial account" id="trial">
      <div className={styles.head}>
        <h2 className={page.cardTitle}>
          <Term k="trialAccount">Trial account</Term>
        </h2>
        <span className={`${page.chip} ${page.chip_amber}`} title={TRIAL_BADGE_LONG}>
          {TRIAL_BADGE}
        </span>
        {variant === "today" ? (
          <Link href="/brain#trial" className={`${page.linkButton} ${styles.headLink}`}>
            Details →
          </Link>
        ) : (
          <button type="button" className={`${page.linkButton} ${styles.headLink}`} onClick={() => setSheet("limits")}>
            Limits
          </button>
        )}
      </div>

      {trial.failed && !account ? (
        <p className={page.note}>The trial account couldn&apos;t be checked just now. It starts with the next engine check after it is set up.</p>
      ) : (
        <>
          <div className={styles.hero}>
            <div>
              <span className={styles.heroLabel}>Balance</span>
              <b className={`${styles.heroValue} num`}>{trial.loading && !account ? "—" : cash(live ?? account?.equity ?? null)}</b>
              <span className={`${styles.heroSub} num ${today === null ? "" : today >= 0 ? page.good : page.bad}`}>
                {today === null ? "No trades today" : `${mask(money(today))} today`}
              </span>
            </div>
            <Spark points={[...series.map((s) => s.balance), ...(live !== null ? [live] : [])]} up={up} />
          </div>

          {sentence && <p className={styles.sentence}>{sentence}</p>}

          {open.length > 0 && (
            <ul className={styles.list} aria-label="Open trial trades">
              {open.map((p) => {
                const r = running(p);
                return (
                  <li key={p.id}>
                    <button type="button" className={`${styles.row} pressSm`} onClick={() => setSheet(p)}>
                      <span className={p.side === "LONG" ? styles.buy : styles.sell}>{p.side === "LONG" ? "Buy" : "Sell"}</span>
                      <span className={styles.rowMain}>
                        <b>{marketName(p.symbol)}</b>
                        <small>
                          {p.qty} contract{p.qty === 1 ? "" : "s"} · from {p.entry.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </small>
                      </span>
                      <span className={`num ${r === null ? page.dim : r >= 0 ? page.good : page.bad}`}>
                        {r === null ? "Open" : `${r >= 0 ? "Up" : "Down"} ${mask(money(Math.abs(r), false))}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {variant === "bot" && series.length > 1 && (
            <div className={styles.chart} data-no-pull>
              <EquityChart
                series={[{ label: "Trial balance", color: "#3d8fe8", points: series.map((s) => ({ time: sec(`${s.day}T20:00:00Z`), equity: s.balance })) }]}
                baseline={series[0].balance}
              />
            </div>
          )}

          {variant === "bot" && (
            <>
              <h3 className={styles.subTitle}>Recent closed trades</h3>
              {closed.length ? (
                <ul className={styles.list} aria-label="Closed trial trades">
                  {closed.slice(0, 10).map((p) => (
                    <li key={p.id}>
                      <button type="button" className={`${styles.row} pressSm`} onClick={() => setSheet(p)}>
                        <span className={p.side === "LONG" ? styles.buy : styles.sell}>{p.side === "LONG" ? "Buy" : "Sell"}</span>
                        <span className={styles.rowMain}>
                          <b>{marketName(p.symbol)}</b>
                          <small>
                            {exitWords(p.exit_reason)} · {dateShortIn(sec(p.closed_at!), zone)}
                          </small>
                        </span>
                        <span className={`num ${(p.pnl ?? 0) >= 0 ? page.good : page.bad}`}>{p.pnl === null ? "—" : mask(money(p.pnl))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={page.empty}>No closed trial trades yet. The first one appears after the next idea ends.</p>
              )}
              {rounds.length > 0 && (
                <p className={page.note}>
                  {rounds
                    .map((r) => `Round ${r.round} ended ${dateShortIn(sec(r.ended_at!), zone)} at ${cash(r.end_equity)} — ${r.end_reason ?? "reset"}.`)
                    .join(" ")}
                </p>
              )}
            </>
          )}

          {variant === "today" && (
            <p className={page.note}>
              Copies every <Term k="tradeIdea">trade idea</Term> with trial money, under the same loss limits as the practice account.
            </p>
          )}
        </>
      )}

      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === "limits" ? "Trial account rules" : "Trial trade"}>
        {sheet === "limits" ? (
          <div className={styles.sheet}>
            <p>{TRIAL_WHY}</p>
            <ul>
              {TRIAL_LIMITS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ) : sheet ? (
          <div className={styles.sheet}>
            <p>
              <b>
                {sheet.side === "LONG" ? "Buy" : "Sell"} {sheet.qty} {marketName(sheet.symbol)} contract{sheet.qty === 1 ? "" : "s"}
              </b>{" "}
              at {sheet.entry.toLocaleString("en-US", { minimumFractionDigits: 2 })}, copied from a trade idea.
            </p>
            <ul>
              <li>Opened {stampIn(sec(sheet.opened_at), zone)}</li>
              <li>Stop {sheet.stop.toLocaleString("en-US", { minimumFractionDigits: 2 })} · target {sheet.target === null ? "none" : sheet.target.toLocaleString("en-US", { minimumFractionDigits: 2 })}</li>
              <li>At risk when it opened: {mask(money(sheet.risk, false))}, costs included</li>
              {sheet.closed_at ? (
                <li>
                  {exitWords(sheet.exit_reason)} {stampIn(sec(sheet.closed_at), zone)} at {sheet.exit_price?.toLocaleString("en-US", { minimumFractionDigits: 2 })} ·{" "}
                  {sheet.pnl === null ? "—" : mask(money(sheet.pnl))} after costs
                </li>
              ) : (
                <li>Open now{running(sheet) === null ? "" : ` · ${mask(money(running(sheet)!))} so far after costs, on delayed prices`}</li>
              )}
            </ul>
            <p className={page.note}>{TRIAL_BADGE_LONG}.</p>
          </div>
        ) : null}
      </BottomSheet>
    </section>
  );
}
