"use client";

import { Badge, DataTable, Kpi, Panel } from "@/components/ui";
import { evaluatePromotion, GATE, REFUTED_STREAM_EVIDENCE } from "@/lib/validation/promotionGate";
import type { Phase4Report } from "@/lib/diagnostics/report";
import styles from "./diagnostics.module.css";

const num = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dp);

const pct = (v: number | null | undefined, dp = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`;

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;

/** Signed dollars to 2dp, with the minus OUTSIDE the currency symbol. */
const signedDollars = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "pass"
      ? styles.pillGood
      : status === "fail"
        ? styles.pillBad
        : styles.pillWarn;
  const label = status === "not-measured" ? "no evidence" : status;
  return <span className={`${styles.pill} ${cls}`}>{label}</span>;
}

/* The gate, shown refusing the three live streams.
   Deliberately the FIRST thing on this section rather than the last: a gate is
   only meaningful if you can see it saying no to something real. Showing it
   only against candidates you hope to promote is how a gate becomes a
   formality. */
function GateAgainstIncumbents() {
  const rows = Object.entries(REFUTED_STREAM_EVIDENCE).map(([key, ev]) => {
    const v = evaluatePromotion(ev);
    return [
      key,
      <span key="p" className="num">
        {num(ev.randomEntryPercentile, 1)}
      </span>,
      <span key="e" className={`num ${styles.toneBad}`}>
        {signedDollars(ev.oosNetExpectancy)}
      </span>,
      <span key="t" className="num">
        {ev.trades?.toLocaleString()}
      </span>,
      <span key="v" className={`${styles.pill} ${styles.pillBad}`}>
        refused
      </span>,
      <span key="w" className={styles.note}>
        {v.failed.join(", ")}
      </span>,
    ];
  });

  return (
    <Panel
      title="The promotion gate, applied to the live streams and the gold candidate"
      hint="nothing reaches paper without clearing every check"
    >
      <DataTable
        columns={["Stream", "Random-entry pct", "Net expectancy", "Trades", "Verdict", "Failed checks"]}
        rows={rows}
        mobileCards={{ titleIndexes: [0] }}
      />
      <p className={styles.note} style={{ marginTop: 12 }}>
        Thresholds: random-entry percentile ≥ {GATE.randomEntryPercentile}, deflated Sharpe &gt;{" "}
        {GATE.dsr}, t &gt; {GATE.tStat}, PBO &lt; {GATE.pbo}, net out-of-sample expectancy &gt;{" "}
        ${GATE.oosNetExpectancy}, {pct(GATE.cvFoldSurvival)} of purged folds positive, and at least{" "}
        {GATE.minTrades} closed trades. A check with no measurement behind it counts as missing
        evidence, never as a pass — that distinction is what keeps a gate from becoming decoration.
      </p>
    </Panel>
  );
}

export default function HypothesisBoard({ report }: { report: Phase4Report | null }) {
  if (!report) {
    return (
      <>
        <GateAgainstIncumbents />
        <div className={styles.empty}>
          No Phase 4 hypotheses have been measured yet.
          <br />
          <code>BAR_SOURCE=databento npx tsx scripts/diag/phase4.ts</code>
        </div>
      </>
    );
  }

  const promoted = report.trials.filter((t) => t.gate.promote).length;

  return (
    <>
      <GateAgainstIncumbents />

      {/* The arena, before any strategy. */}
      <Panel
        title="Where the drift actually is"
        hint="overnight vs intraday — a claim about the instrument, not about a signal"
      >
        <div className={styles.duo}>
          {report.overnight.map((o) => (
            <div key={o.symbol} className={styles.duoCard}>
              <div className={styles.duoHead}>
                <span className={styles.duoTitle}>{o.symbol}</span>
                <Badge tone={o.intradayTotalPct < 0 && o.overnightTotalPct > 0 ? "red" : "default"}>
                  {o.intradayTotalPct < 0 && o.overnightTotalPct > 0 ? "intraday headwind" : "mixed"}
                </Badge>
              </div>
              <div className={styles.duoRow}>
                <span className={styles.duoRowLabel}>Overnight</span>
                <span
                  className={`${styles.duoVal} ${o.overnightTotalPct >= 0 ? styles.toneGood : styles.toneBad}`}
                >
                  {o.overnightTotalPct >= 0 ? "+" : ""}
                  {num(o.overnightTotalPct, 1)}%
                </span>
                <span className={`${styles.duoVal} ${styles.toneDim}`}>
                  {num(o.overnightBps.mean)} bps
                </span>
              </div>
              <div className={styles.duoRow}>
                <span className={styles.duoRowLabel}>Intraday</span>
                <span
                  className={`${styles.duoVal} ${o.intradayTotalPct >= 0 ? styles.toneGood : styles.toneBad}`}
                >
                  {o.intradayTotalPct >= 0 ? "+" : ""}
                  {num(o.intradayTotalPct, 1)}%
                </span>
                <span className={`${styles.duoVal} ${styles.toneDim}`}>
                  {num(o.intradayBps.mean)} bps
                </span>
              </div>
              <p className={styles.note}>
                {o.sessions.toLocaleString()} sessions, {o.excludedSeams} contract-roll gaps
                excluded. Overnight positive on {pct(o.overnightWinRate)} of sessions, intraday on{" "}
                {pct(o.intradayWinRate)}.
              </p>
            </div>
          ))}
        </div>
        <p className={styles.note} style={{ marginTop: 12 }}>
          This tests the arena rather than any signal. This engine is flat every night by 15:25, so
          whatever accrues between the close and the next open is unreachable by construction. If
          the drift lives there, &ldquo;no entry edge&rdquo; was the wrong diagnosis — the system
          was never competing for it.
        </p>
      </Panel>

      {/* The candidates. */}
      <Panel
        title="Phase 4 hypotheses"
        hint={`${promoted} of ${report.trials.length} candidate runs clear the gate`}
      >
        <DataTable
          columns={["Trial", "Symbol", "Trades", "Gross", "Net", "Net/trade", "Avg R", "Random-entry pct", "Gate"]}
          rows={report.trials.map((t) => [
            t.trial,
            t.symbol,
            <span key="n" className="num">
              {t.trades.toLocaleString()}
            </span>,
            <span key="g" className={`num ${t.grossTotal >= 0 ? styles.toneGood : styles.toneBad}`}>
              {money(t.grossTotal)}
            </span>,
            <span key="net" className={`num ${t.netTotal >= 0 ? styles.toneGood : styles.toneBad}`}>
              {money(t.netTotal)}
            </span>,
            <span key="npt" className="num">
              {num(t.netPerTrade)}
            </span>,
            <span key="r" className={`num ${t.avgR >= 0 ? styles.toneGood : styles.toneBad}`}>
              {num(t.avgR, 3)}
            </span>,
            <span
              key="p"
              className={`num ${(t.randomEntryPercentile ?? 0) >= 95 ? styles.toneGood : styles.toneDim}`}
            >
              {t.randomEntryPercentile === null ? "—" : t.randomEntryPercentile.toFixed(1)}
            </span>,
            <span key="v" className={`${styles.pill} ${t.gate.promote ? styles.pillGood : styles.pillWarn}`}>
              {t.gate.promote ? "clears" : "blocked"}
            </span>,
          ])}
          mobileCards={{ titleIndexes: [0, 1] }}
        />
        <p className={styles.note} style={{ marginTop: 12 }}>
          Every row is a separate <strong>trial</strong>, and every trial raises the bar for all the
          others: the deflated-Sharpe hurdle is built from{" "}
          {report.totalTrials.toLocaleString()} logged trials ({report.priorTrials} prior +{" "}
          {report.candidateTrials} candidate configurations here), read from the registry rather
          than chosen. Each configuration is reported for both symbols, so the table has{" "}
          {report.trials.length} measured runs. Three relative-volume thresholds is three trials,
          not one.
        </p>
      </Panel>

      {/* Anti-overfitting readouts. */}
      <Panel title="Anti-overfitting gates" hint="trial-count corrected">
        <div className={styles.duo}>
          <Kpi
            label="Deflated Sharpe"
            value={report.deflatedSharpe ? pct(report.deflatedSharpe.dsr, 1) : "—"}
            sub={
              report.deflatedSharpe
                ? `vs a ${num(report.deflatedSharpe.expectedMaxSharpe, 3)} selection hurdle`
                : "not computed"
            }
            tone={report.deflatedSharpe?.significant ? "good" : "warn"}
          />
          <Kpi
            label="t-statistic"
            value={report.deflatedSharpe ? num(report.deflatedSharpe.tStat) : "—"}
            sub={`Harvey/Liu/Zhu hurdle: ${GATE.tStat}`}
            tone={(report.deflatedSharpe?.tStat ?? 0) > GATE.tStat ? "good" : "warn"}
          />
          <Kpi
            label="Backtest overfitting"
            value={report.pbo ? pct(report.pbo.pbo, 1) : "—"}
            sub={report.pbo ? `${report.pbo.combinations.toLocaleString()} balanced splits` : "not computed"}
            tone={(report.pbo?.pbo ?? 1) < GATE.pbo ? "good" : "warn"}
          />
          <Kpi
            label="Discarded to stop leakage"
            value={pct(report.cvSummary.discardedShare, 1)}
            sub={`${report.cvSummary.folds} purged, embargoed folds`}
            tone="dim"
          />
        </div>
        <p className={styles.note} style={{ marginTop: 12 }}>
          Purged cross-validation drops any training trade whose holding period overlaps the test
          window, plus a one-month embargo after it. Ordinary k-fold does neither, which is why it
          reports an out-of-sample score that is partly in-sample.
        </p>
      </Panel>

      {/* What was not tested. */}
      <Panel title="Candidates not tested, and why" hint="a board showing two is not a survey of five">
        <DataTable
          columns={["Candidate", "Why not"]}
          rows={report.notTested.map((n) => [n.candidate, <span key="r" className={styles.note}>{n.reason}</span>])}
          mobileCards={{ titleIndexes: [0] }}
        />
      </Panel>
    </>
  );
}
