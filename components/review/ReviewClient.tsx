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
import { expectancy, fmtPf, profitFactor, rateFromPnls, rateReadout } from "@/lib/stats";
import { money } from "@/lib/format";
import { nyMeta } from "@/lib/time/ny";
import { dayKeyLabel } from "@/lib/time/zones";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { Panel, Rate, SampleNote } from "@/components/ui";
import ShowNumbers from "@/components/ui/ShowNumbers";
import { Term } from "@/components/ui/Glossary";
import BottomSheet, { SheetClose } from "@/components/ui/BottomSheet";
import page from "@/components/ui/page.module.css";
import { liveOnly } from "@/lib/signals/live";
import styles from "./review.module.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: SignalRow[] };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  /* The market is shut at weekends, so Saturday and Sunday columns are dropped
     unless one of them actually holds a result. Five columns instead of seven
     is what lets each day be a 44px tap target on a 360px phone. */
  const showWeekend = calendar.some((c, i) => i % 7 >= 5 && c.net !== null);
  const calCells = useMemo(() => {
    const out: typeof calendar = [];
    for (let i = 0; i < calendar.length; i += 7) {
      const week = showWeekend ? calendar.slice(i, i + 7) : calendar.slice(i, i + 5);
      if (week.some((c) => c.dateKey !== null)) out.push(...week);
    }
    return out;
  }, [calendar, showWeekend]);
  /* Tap a day for its numbers. Losses come from the same daily grouping run
     over the losing rows only, so a day here can never disagree with the
     calendar square it was opened from. */
  const [openDay, setOpenDay] = useState<string | null>(null);
  const dayByKey = useMemo(() => new Map(days.map((d) => [d.dateKey, d])), [days]);
  const lossesByKey = useMemo(
    () => new Map(dailyPnl(rows.filter((r) => (r.pnl_usd ?? 0) < 0)).map((d) => [d.dateKey, d.trades])),
    [rows]
  );
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

  const closeDay = () => setOpenDay(null);
  const sheetDay = openDay ? (dayByKey.get(openDay) ?? null) : null;
  const sheetLosses = openDay ? (lossesByKey.get(openDay) ?? 0) : 0;
  const sheetFlat = sheetDay ? Math.max(0, sheetDay.trades - sheetDay.wins - sheetLosses) : 0;

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
            <div className={`${styles.weekHead} ${showWeekend ? "" : styles.weekdaysOnly}`} aria-hidden>
              {(showWeekend ? WEEKDAYS : WEEKDAYS.slice(0, 5)).map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div
              className={`${styles.calendar} ${showWeekend ? "" : styles.weekdaysOnly}`}
              role="group"
              aria-label={`Result by day for ${MONTH_LABEL(shownMonth)}. Tap a day for its numbers.`}
            >
              {calCells.map((c, i) =>
                c.dateKey ? (
                  <button
                    key={c.dateKey}
                    type="button"
                    className={`${styles.calCell} ${tone(c.net)}`}
                    onClick={() => setOpenDay(c.dateKey)}
                    aria-label={
                      c.net === null
                        ? `${dayKeyLabel(c.dateKey)}: no closed ideas`
                        : `${dayKeyLabel(c.dateKey)}: ${c.net >= 0 ? "made" : "lost"} ${mask(money(Math.abs(c.net), false))} over ${c.trades} idea${c.trades === 1 ? "" : "s"}`
                    }
                  >
                    <span className={styles.calDay}>{Number(c.dateKey.slice(-2))}</span>
                    {c.net !== null && <span className={styles.calNet}>{mask(money(c.net, false))}</span>}
                  </button>
                ) : (
                  <div key={`pad-${i}`} className={`${styles.calCell} ${styles.cellPad}`} aria-hidden />
                )
              )}
            </div>
            <p className={styles.calHint}>Tap a day to see its result, how many ideas closed, and how many won.</p>
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

      <BottomSheet
        open={openDay !== null}
        onClose={closeDay}
        title={openDay ? `Trade ideas on ${dayKeyLabel(openDay)}` : "One day"}
      >
        <div className={styles.sheetHead}>
          <b className={styles.sheetTitle}>{openDay ? dayKeyLabel(openDay) : ""}</b>
          <SheetClose onClose={closeDay} />
        </div>
        {sheetDay ? (
          <>
            <p className={styles.sheetLede}>Trade ideas that closed on this New York trading day, after costs.</p>
            <div className={page.tiles}>
              <div className={page.tile}>
                <span>Result</span>
                <b className={sheetDay.net > 0 ? page.good : sheetDay.net < 0 ? page.bad : undefined}>
                  {mask(money(sheetDay.net))}
                </b>
              </div>
              <div className={page.tile}>
                <span>Ideas closed</span>
                <b>{sheetDay.trades}</b>
              </div>
              <div className={page.tile}>
                <span>Won · lost</span>
                <b>
                  {sheetDay.wins} · {sheetLosses}
                </b>
                {sheetFlat > 0 && <small>{sheetFlat} broke even</small>}
              </div>
            </div>
            <div className={styles.sheetRate}>
              <span className={styles.statLabel}>Win rate</span>
              <Rate readout={rateReadout(sheetDay.wins, sheetDay.trades)} valueClassName="num" />
            </div>
          </>
        ) : (
          <p className={styles.empty}>No trade idea closed on this day.</p>
        )}
        <p className={styles.sheetNote}>
          Simulated trade ideas, not practice-account trades. Nothing here touches real money.
        </p>
      </BottomSheet>
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
