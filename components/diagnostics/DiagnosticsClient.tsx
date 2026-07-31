"use client";

import { Badge, DataTable, Kpi, Panel } from "@/components/ui";
import { describeEffectiveN } from "@/lib/diagnostics/correlation";
import { overallVerdict, type Phase1Report, type RandomEntryCell } from "@/lib/diagnostics/report";
import styles from "./diagnostics.module.css";

const money = (v: number) =>
  `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;

const num = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dp);

const pct = (v: number, dp = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : "—");

/** Signed dollars to 2dp, minus OUTSIDE the currency symbol ("−$4.09"). */
const dollars = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;

const toneOf = (v: number) => (v > 0 ? styles.toneGood : v < 0 ? styles.toneBad : styles.toneDim);

/* Verdict pill. Note the colour rule from docs/design-language.md: a cell that
   simply failed to clear the bar is AMBER, not red — "not proven" is not a
   loss. Red is reserved for a measured negative (actively anti-predictive). */
function VerdictPill({ verdict }: { verdict: RandomEntryCell["verdict"] }) {
  const look: Record<RandomEntryCell["verdict"], { cls: string; label: string }> = {
    "beats-random": { cls: styles.pillGood, label: "beats random" },
    "indistinguishable-from-random": { cls: styles.pillWarn, label: "no better" },
    "worse-than-random": { cls: styles.pillBad, label: "worse" },
    "insufficient-sample": { cls: styles.pill, label: "too few" },
  };
  const { cls, label } = look[verdict];
  return <span className={`${styles.pill} ${cls}`}>{label}</span>;
}

export default function DiagnosticsClient({ report }: { report: Phase1Report | null }) {
  if (!report) {
    return (
      <>
        <h1 className="pageTitle">Diagnostics</h1>
        <p className="pageSub">Does the entry signal contribute anything at all?</p>
        <div className={styles.empty}>
          No measurement has been run yet.
          <br />
          <code>BAR_SOURCE=databento npx tsx scripts/diag/random-entry.ts</code>
          <br />
          writes <code>docs/research/phase1-random-entry.json</code>, which this page reads.
        </div>
      </>
    );
  }

  const cells = report.randomEntry;
  const verdict = overallVerdict(cells);
  const beats = cells.filter((c) => c.verdict === "beats-random").length;
  const corr = report.correlation[0];
  const caveats = [...new Set(cells.map((c) => c.caveat).filter(Boolean))] as string[];

  /* Iteration counts differ by tier, so never print one number as if it
     covered every cell. */
  const iterCounts = [...new Set(cells.map((c) => c.iterations))].sort((a, b) => a - b);
  const iterationsVary = iterCounts.length > 1;
  const iterationLabel = iterationsVary
    ? `${iterCounts[0].toLocaleString()}–${iterCounts[iterCounts.length - 1].toLocaleString()}`
    : (iterCounts[0] ?? report.iterations).toLocaleString();

  return (
    <div className={styles.wrap}>
      <div>
        <h1 className="pageTitle">Diagnostics</h1>
        <p className="pageSub">
          Does the entry signal contribute anything at all? Measured on {report.barSource} bars,{" "}
          {report.windowFrom} → {report.windowTo}.
        </p>
      </div>

      {/* ── Hero: the random-entry percentile ───────────────────────────── */}
      <section className={styles.hero}>
        <span className={styles.heroKicker}>Random-entry benchmark</span>
        <div className={styles.heroFigures}>
          <div className={styles.heroFigure}>
            <span
              className={`${styles.heroBig} ${
                verdict.tone === "good"
                  ? styles.toneGood
                  : verdict.tone === "bad"
                    ? styles.toneBad
                    : styles.toneWarn
              }`}
            >
              {beats}/{cells.length}
            </span>
            <span className={styles.heroLabel}>symbol-years above the 95th percentile</span>
          </div>
          <div className={styles.heroFigure}>
            <span className={styles.heroBig}>{iterationLabel}</span>
            <span className={styles.heroLabel}>
              random books per cell
              {iterationsVary && " (tier A's whole-archive null costs ~200× a symbol-year)"}
            </span>
          </div>
          <div className={styles.heroFigure}>
            <span className={`${styles.heroBig} ${styles.toneDim}`}>{verdict.headline}</span>
            <span className={styles.heroLabel}>{verdict.detail}</span>
          </div>
        </div>

        <p className={styles.rule}>
          <strong>How to read this.</strong> Each random book holds the real stream&apos;s trade
          management, cost model, session filter, trade count, direction mix and time-of-day
          distribution fixed, and randomises only <em>when</em> you enter and <em>which way</em> you
          face. If the real strategy does not sit at or above the{" "}
          <strong>95th percentile</strong> of that distribution, the entry signal contributes
          nothing — and no amount of parameter tuning will help. A profitable-looking backtest is
          not evidence of entry edge; only beating matched random entries is.
        </p>
      </section>

      {/* ── Gross beside net, always ────────────────────────────────────── */}
      <Panel
        title="Gross and net"
        hint="two separate runs — gross is not net plus costs"
      >
        <div className={styles.duo}>
          {report.grossNet.map((r) => (
            <div key={r.stream} className={styles.duoCard}>
              <div className={styles.duoHead}>
                <span className={styles.duoTitle}>{r.stream}</span>
                <Badge tone={r.grossTotal > 0 ? "amber" : "red"}>
                  {r.grossTotal > 0 ? "gross break-even" : "loses gross"}
                </Badge>
              </div>
              <div className={styles.duoRow}>
                <span className={styles.duoRowLabel}>Gross</span>
                <span className={`${styles.duoVal} ${toneOf(r.grossTotal)}`}>
                  {money(r.grossTotal)}
                </span>
                <span className={`${styles.duoVal} ${toneOf(r.grossPerTrade ?? 0)}`}>
                  {dollars(r.grossPerTrade)}/t
                </span>
              </div>
              <div className={styles.duoRow}>
                <span className={styles.duoRowLabel}>Net</span>
                <span className={`${styles.duoVal} ${toneOf(r.netTotal)}`}>
                  {money(r.netTotal)}
                </span>
                <span className={`${styles.duoVal} ${toneOf(r.netPerTrade ?? 0)}`}>
                  {dollars(r.netPerTrade)}/t
                </span>
              </div>
              <div className={styles.duoRow}>
                <span className={styles.duoRowLabel}>Cost drag</span>
                <span className={`${styles.duoVal} ${styles.toneDim}`}>
                  {money(-r.measuredDrag)}
                </span>
                <span className={`${styles.duoVal} ${styles.toneWarn}`}>
                  {pct(r.costShareOfLoss)}
                </span>
              </div>
              <p className={styles.note}>
                {r.trades.toLocaleString()} trades at {r.minQty}–{r.maxQty} contracts (mean{" "}
                {num(r.meanQty)}), {dollars(r.frictionPerContract)} per contract round trip — so
                friction scales with position size while any edge does not.{" "}
                {r.sameSignals.toLocaleString()} of {r.trades.toLocaleString()} signals are common
                to both books, so the gap is cost and size, not a different strategy.
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── Excursion ───────────────────────────────────────────────────── */}
      <Panel
        title="Excursion"
        hint="where the trades die — entry problem or exit problem"
      >
        <DataTable
          columns={[
            "Stream",
            "n",
            "MAE (ATR)",
            "MFE (ATR)",
            "Edge ratio",
            "Winners",
            "Losers",
            "min → MAE",
            "min → MFE",
          ]}
          rows={report.excursion.map((r) => [
            r.stream,
            <span key="n" className="num">
              {r.n.toLocaleString()}
              {!r.reliable && (
                <>
                  {" "}
                  <span className={styles.toneWarn}>(thin)</span>
                </>
              )}
            </span>,
            num(r.avgMaeAtr, 3),
            num(r.avgMfeAtr, 3),
            <span key="e" className={`num ${(r.edgeRatio ?? 0) > 1 ? styles.toneGood : styles.toneWarn}`}>
              {num(r.edgeRatio, 3)}
            </span>,
            num(r.edgeRatioWinners, 2),
            num(r.edgeRatioLosers, 2),
            num(r.avgMinutesToMae, 0),
            num(r.avgMinutesToMfe, 0),
          ])}
          mobileCards={{ titleIndexes: [0] }}
        />
        <p className={styles.note}>
          Edge ratio is mean(MFE ÷ ATR) over mean(MAE ÷ ATR). Above 1 means the average trade showed
          more favourable travel than adverse before it resolved — a necessary, not sufficient,
          condition for the entry to carry information. At or below 1 the entries are picking
          moments with no directional tilt. ATR units rather than R, because R divides by the
          trade&apos;s own stop, which is itself volatility-scaled and makes the measure circular.
        </p>
      </Panel>

      {/* ── The per-cell null ───────────────────────────────────────────── */}
      <Panel title="Real result against matched random entries" hint={`mode: ${report.mode}`}>
        <DataTable
          columns={[
            "Cell",
            "Trades",
            "Real avg R",
            "Null median",
            "Null p95",
            "Percentile",
            "p",
            "Verdict",
          ]}
          rows={cells.map((c) => [
            <span key="c">
              {c.cell}
              {c.grossOnly && (
                <>
                  {" "}
                  <span className={`${styles.pill} ${styles.pillWarn}`}>gross</span>
                </>
              )}
            </span>,
            <span key="n" className="num">
              {c.realTrades.toLocaleString()}
            </span>,
            <span key="r" className={`num ${toneOf(c.realAvgR)}`}>
              {c.realAvgR.toFixed(3)}
            </span>,
            <span key="m" className="num">
              {c.medianNullAvgR.toFixed(3)}
            </span>,
            <span key="p95" className="num">
              {c.p95NullAvgR.toFixed(3)}
            </span>,
            <span
              key="p"
              className={`num ${c.percentileAvgR >= 95 ? styles.toneGood : styles.toneDim}`}
            >
              {c.percentileAvgR.toFixed(1)}
            </span>,
            <span key="pv" className="num">
              {c.pValueAvgR.toFixed(4)}
            </span>,
            <VerdictPill key="v" verdict={c.verdict} />,
          ])}
          mobileCards={{ titleIndexes: [0] }}
        />
        {caveats.map((c) => (
          <p key={c} className={styles.note} style={{ marginTop: 12 }}>
            <span className={styles.toneWarn}>Caveat — </span>
            {c}
          </p>
        ))}
      </Panel>

      {/* ── Effective sample size ───────────────────────────────────────── */}
      {corr && (
        <Panel title="How much evidence is this really?" hint="correlation-adjusted sample size">
          <div className={styles.duo}>
            <Kpi label="MES/MNQ correlation" value={num(corr.overall, 3)} sub="whole archive" />
            <Kpi label="Median rolling" value={num(corr.medianRolling, 3)} sub="5-session window" />
            <Kpi
              label="Windows above 0.8"
              value={pct(corr.shareAbove80)}
              sub="effectively one instrument"
            />
            <Kpi
              label="Effective trades"
              value={Math.round(corr.effectiveTrades).toLocaleString()}
              sub={`of ${corr.nominalTrades.toLocaleString()} nominal`}
              tone="warn"
              n={Math.round(corr.effectiveTrades)}
            />
          </div>
          <p className={styles.note} style={{ marginTop: 12 }}>
            {describeEffectiveN(corr.nominalTrades, corr.effectiveTrades, "tier-B trades")} MES and
            MNQ are both US equity index futures and move together intraday, so a result confirmed
            on both is closer to one observation than two. This cuts both ways: it weakens a
            positive finding as much as a negative one.
          </p>
        </Panel>
      )}

      <p className={styles.note}>
        Generated by <code>{report.generatedFrom}</code> on {report.measuredAt.slice(0, 10)} ·{" "}
        {report.iterations.toLocaleString()} iterations per cell · cost model{" "}
        <code>{report.costModel}</code> · paper trading only, no real money.
      </p>
    </div>
  );
}
