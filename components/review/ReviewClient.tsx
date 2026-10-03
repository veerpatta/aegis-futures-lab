"use client";

/* Post-trade review — the "how am I doing, and when" surface.

   Everything here is a SLICE, and every slice starts below n=30 and stays
   there for months. That is not a caveat bolted on afterwards: it is why each
   card carries its own sample note, and why the calendar shows money (which
   is real at any n) while the tables lead with expectancy and mark the rates
   previewed. A page of thin slices without that gate is a machine for reading
   noise. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getNeon, type SignalRow } from "@/lib/neon/client";
import {
  bySession,
  bySymbol,
  byRegime,
  byWeekday,
  closedRows,
  dailyPnl,
  monthCalendar,
  monthsWithData,
  yearHeatmap,
  type SliceStat,
} from "@/lib/review/aggregate";
import { expectancy, fmtPf, profitFactor, rateFromPnls } from "@/lib/stats";
import { money } from "@/lib/format";
import { nyMeta } from "@/lib/time/ny";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { Panel, Rate, SampleNote } from "@/components/ui";
import ShowNumbers from "@/components/ui/ShowNumbers";
import { Term } from "@/components/ui/Glossary";
import { liveOnly } from "@/lib/signals/live";
import styles from "./review.module.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: SignalRow[] };

const MONTH_LABEL = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export default function ReviewClient() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [month, setMonth] = useState<string | null>(null);
  const { mask } = usePrivacy();
  /* A phone shows the last 13 weeks so the squares stay tappable-sized; wider
     screens show the half year. */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 480px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data, error } = await getNeon()
        .from("signals")
        .select("*")
        .order("signal_ts", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      /* liveOnly at the read boundary: the calendar and the year heatmap are
         performance surfaces, and the engine's first pass mirrored a trailing
         seven days — so without this they paint winning squares on 2026-07-13
         to 07-18, sessions that were over before the bot existed. */
      setState({ status: "ready", rows: liveOnly((data ?? []) as SignalRow[]) });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = state.status === "ready" ? state.rows : [];
  const closed = useMemo(() => closedRows(rows), [rows]);
  const days = useMemo(() => dailyPnl(rows), [rows]);
  const months = useMemo(() => monthsWithData(days), [days]);
  const shownMonth = month ?? months[0] ?? nyMeta(Math.floor(Date.now() / 1000)).dateKey.slice(0, 7);
  const calendar = useMemo(() => monthCalendar(days, shownMonth), [days, shownMonth]);
  const heat = useMemo(
    () => yearHeatmap(days, nyMeta(Math.floor(Date.now() / 1000)).dateKey, narrow ? 13 : 27),
    [days, narrow]
  );

  const pnls = closed.map((r) => r.pnl_usd ?? 0);
  const headline = {
    net: pnls.reduce((a, v) => a + v, 0),
    pf: profitFactor(pnls),
    expectancy: expectancy(pnls),
    rate: rateFromPnls(pnls),
  };

  /* Scale for the heatmap and calendar. Using the largest ABSOLUTE day means
     a single outlier flattens everything else, so it is capped at the 90th
     percentile — the shape of a normal week stays readable. */
  const scale = useMemo(() => {
    const mags = days.map((d) => Math.abs(d.net)).sort((a, b) => a - b);
    if (!mags.length) return 1;
    return Math.max(1, mags[Math.floor(mags.length * 0.9)] ?? mags[mags.length - 1]);
  }, [days]);

  const tone = (net: number | null): string => {
    if (net === null) return styles.cellEmpty;
    if (net === 0) return styles.cellFlat;
    const intensity = Math.min(1, Math.abs(net) / scale);
    const step = intensity > 0.66 ? 3 : intensity > 0.33 ? 2 : 1;
    return net > 0 ? styles[`up${step}`] : styles[`down${step}`];
  };

  if (state.status === "loading")
    return (
      <>
        <h1 className="pageTitle">Review</h1>
        <p className="pageSub">Loading the signal log…</p>
      </>
    );

  if (state.status === "error")
    return (
      <>
        <h1 className="pageTitle">Review</h1>
        <p className="pageSub">Could not load the signal log: {state.message}</p>
      </>
    );

  return (
    <>
      <h1 className="pageTitle">Review</h1>
      <p className="pageSub">
        How the trade ideas have done, day by day. These are simulated ideas from methods that have not beaten
        chance — not practice-account trades.
      </p>
      <p className={styles.plainHeadline}>
        {closed.length === 0
          ? "No idea has closed yet."
          : `Trade ideas ${headline.net >= 0 ? "made" : "lost"} ${mask(money(Math.abs(headline.net), false))} over ${closed.length} closed idea${closed.length === 1 ? "" : "s"}, after costs. ${headline.rate.valueLabel} of them were winners (n=${closed.length}).`}
      </p>

      <Panel title="Closed trades" hint="suppressed and stale-data rows excluded, as everywhere">
        <div className={styles.headline}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Net</span>
            <b className={`${styles.big} num ${headline.net >= 0 ? styles.good : styles.bad}`}>
              {mask(money(headline.net))}
            </b>
            <SampleNote n={closed.length} />
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Expectancy / trade</span>
            <b
              className={`${styles.big} num ${
                headline.expectancy === null
                  ? ""
                  : headline.expectancy >= 0
                    ? styles.good
                    : styles.bad
              }`}
            >
              {headline.expectancy === null ? "—" : mask(money(headline.expectancy))}
            </b>
            <SampleNote n={closed.length} />
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Win rate</span>
            <Rate readout={headline.rate} valueClassName={`${styles.big} num`} />
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Profit factor</span>
            <b className={`${styles.big} num`}>{fmtPf(headline.pf)}</b>
            <SampleNote n={closed.length} />
          </div>
        </div>
      </Panel>

      <Panel
        title="Calendar"
        hint="one square per trading day"
        actions={
          months.length > 1 ? (
            <select
              className={styles.monthPick}
              value={shownMonth}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Month"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {MONTH_LABEL(m)}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        {days.length === 0 ? (
          <p className={styles.empty}>No closed trades yet — the calendar fills in as they land.</p>
        ) : (
          <>
            <div className={styles.weekHead} aria-hidden>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className={styles.calendar} role="grid" aria-label={`P&L for ${MONTH_LABEL(shownMonth)}`}>
              {calendar.map((c, i) => (
                <div
                  key={c.dateKey ?? `pad-${i}`}
                  className={`${styles.calCell} ${c.dateKey ? tone(c.net) : styles.cellPad}`}
                  title={
                    c.dateKey
                      ? c.net === null
                        ? `${c.dateKey} — no trades`
                        : `${c.dateKey} — ${money(c.net)} over ${c.trades} trade${c.trades === 1 ? "" : "s"}`
                      : undefined
                  }
                >
                  {c.dateKey && <span className={styles.calDay}>{Number(c.dateKey.slice(-2))}</span>}
                  {c.dateKey && c.net !== null && (
                    <span className={styles.calNet}>{mask(money(c.net, false))}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel title={narrow ? "The last 13 weeks" : "The last six months"} hint="one square per weekday">
        {days.length === 0 ? (
          <p className={styles.empty}>Nothing to plot yet.</p>
        ) : (
          <div className={styles.heatWrap}>
            <div
              className={styles.heat}
              style={{ gridTemplateColumns: `repeat(${Math.max(...heat.map((c) => c.weekIndex)) + 1}, 1fr)` }}
              role="img"
              aria-label={`Daily result over the last ${narrow ? "13 weeks" : "six months"}`}
            >
              {heat.map((c) => (
                <i
                  key={c.dateKey}
                  className={`${styles.heatCell} ${tone(c.net)}`}
                  style={{ gridColumn: c.weekIndex + 1, gridRow: c.weekday + 1 }}
                  title={
                    c.net === null
                      ? `${c.dateKey} — no trades`
                      : `${c.dateKey} — ${money(c.net)} over ${c.trades} trade${c.trades === 1 ? "" : "s"}`
                  }
                />
              ))}
            </div>
            <p className={styles.legend}>
              <span className={`${styles.heatCell} ${styles.down3}`} /> worse
              <span className={`${styles.heatCell} ${styles.cellEmpty}`} /> no trades
              <span className={`${styles.heatCell} ${styles.up3}`} /> better
            </p>
          </div>
        )}
      </Panel>

      <ShowNumbers label="Show results by session, weekday and market">
        <p className={styles.sliceNote}>
          Each slice holds fewer ideas than the total, so read the <Term k="sampleSize">n</Term> before the number.
        </p>
        <SliceTable title="By session" hint="when the idea was taken, New York time" rows={bySession(rows)} mask={mask} />
        <SliceTable title="By weekday" hint="does one day carry the week?" rows={byWeekday(rows)} mask={mask} />
        <SliceTable title="By market" hint="S&P micro against Nasdaq micro" rows={bySymbol(rows)} mask={mask} />
        <SliceTable title="By market mood" hint="conditions at entry" rows={byRegime(rows)} mask={mask} />
      </ShowNumbers>
    </>
  );
}

function SliceTable({
  title,
  hint,
  rows,
  mask,
}: {
  title: string;
  hint: string;
  rows: SliceStat[];
  mask: (s: string) => string;
}) {
  if (!rows.length)
    return (
      <Panel title={title} hint={hint}>
        <p className={styles.empty}>Nothing in this slice yet.</p>
      </Panel>
    );
  return (
    <Panel title={title} hint={hint}>
      <div className={styles.sliceList}>
        {rows.map((s) => (
          <div key={s.key} className={styles.slice}>
            <div className={styles.sliceHead}>
              <span className={styles.sliceLabel}>{s.label}</span>
              <span className={`num ${s.net >= 0 ? styles.good : styles.bad}`}>
                {mask(money(s.net))}
              </span>
            </div>
            <div className={styles.sliceMeta}>
              {/* Expectancy first — it is the figure that survives a slice
                  having a different trade count from every other slice. */}
              expectancy{" "}
              <b className="num">{s.expectancy === null ? "—" : mask(money(s.expectancy))}</b> · PF{" "}
              <b className="num">{fmtPf(s.pf)}</b> · win rate{" "}
              <b className="num">{s.rate.valueLabel}</b>
            </div>
            <SampleNote n={s.rate.n} ci={s.rate.ciLabel} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
