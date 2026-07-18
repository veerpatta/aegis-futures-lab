"use client";

import { useMemo, useState } from "react";
import type { BacktestResult } from "@/lib/backtest/engine";
import type { Bar } from "@/lib/types";
import { tradesToCsv } from "@/lib/data/csv";
import { money, pct, ratio, ts, dateOnly } from "@/lib/format";
import { Badge, Button, DataTable, Kpi, Panel, SelectField } from "@/components/ui";
import EquityChart from "@/components/chart/EquityChart";
import CandleChart, { type TradeMarker } from "@/components/chart/CandleChart";
import styles from "./lab.module.css";

const FUNNEL_LABELS: Record<string, string> = {
  evaluated: "Setups evaluated",
  noHtf: "No HTF zone in range",
  nesting: "Nesting failed",
  notFresh: "Zone not fresh",
  blocked80: "Blocked by 80% rule",
  weakZone: "Weak-zone exclusion",
  nyCaution: "NY caution (diagnostic)",
  refined15: "Refined to 15M (diagnostic)",
  belowMinScore: "Below minimum score",
  intermarket: "Intermarket disagreement",
  riskUnfit: "Risk did not fit",
  news: "News lockout",
  lock: "Discipline lock",
  noSignal: "No trigger",
  qualified: "Qualified",
};

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultsPanel({
  result,
  series,
  rampColor,
  windowLabel,
}: {
  result: BacktestResult;
  series: Record<string, Bar[]>;
  rampColor: string;
  windowLabel: string;
}) {
  const m = result.metrics;
  const symbols = Object.keys(series);
  const defaultChartSymbol =
    result.trades.length > 0 ? result.trades[result.trades.length - 1].symbol : symbols[0];
  const [chartSymbol, setChartSymbol] = useState(defaultChartSymbol);

  const chartBars = useMemo(
    () =>
      (series[chartSymbol] ?? []).filter(
        (b) => b.time >= result.window.from && b.time <= result.window.to
      ),
    [series, chartSymbol, result.window]
  );

  const markers = useMemo<TradeMarker[]>(() => {
    const out: TradeMarker[] = [];
    for (const t of result.trades) {
      if (t.symbol !== chartSymbol) continue;
      out.push({
        time: t.entryTime,
        kind: t.side === "LONG" ? "entryLong" : "entryShort",
        text: `${t.side} ${t.qty}`,
      });
      out.push({ time: t.exitTime, kind: "exit", text: money(t.pnl) });
    }
    return out.sort((a, b) => a.time - b.time);
  }, [result.trades, chartSymbol]);

  const funnelRows = useMemo(() => {
    const entries = Object.entries(result.skipReasons).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return { entries, max };
  }, [result.skipReasons]);

  const zeroTrades = m.trades === 0;

  return (
    <>
      <Panel title="Results" hint={windowLabel}>
        {zeroTrades && (
          <p className={styles.note} style={{ marginTop: 0 }}>
            No qualified trades in this window — that is a result, not an error. The
            qualification funnel below shows exactly where every setup was rejected; loosen the
            parameters or switch mode to see more fills.
          </p>
        )}
        <div className={styles.kpiGrid}>
          <Kpi
            label="Net P&L"
            value={money(m.net)}
            tone={m.net > 0 ? "good" : m.net < 0 ? "bad" : "dim"}
            sub={`${m.trades} trade${m.trades === 1 ? "" : "s"} · ${result.sessions} sessions`}
          />
          <Kpi
            label="Win rate"
            value={m.trades ? pct(m.winRate) : "—"}
            sub={m.trades ? `${m.wins}W / ${m.losses}L` : "no trades"}
          />
          <Kpi label="Profit factor" value={m.trades ? ratio(m.profitFactor) : "—"} />
          <Kpi
            label="Avg R"
            value={m.trades ? m.avgR.toFixed(2) : "—"}
            tone={m.avgR > 0 ? "good" : m.trades ? "bad" : undefined}
          />
          <Kpi label="Max drawdown" value={money(-m.maxDrawdown, false)} tone={m.maxDrawdown > 0 ? "warn" : undefined} />
          <Kpi label="Expectancy" value={m.trades ? money(m.expectancy) : "—"} sub="per trade" />
        </div>
      </Panel>

      <Panel title="Equity curve" hint={`${dateOnly(result.window.from)} → ${dateOnly(result.window.to)}`}>
        <EquityChart
          series={[{ label: "Equity", color: rampColor, points: result.equityPoints }]}
          baseline={result.equityPoints[0]?.equity}
        />
      </Panel>

      {Object.keys(result.byInstrument).length > 0 && (
        <Panel title="Per instrument">
          <DataTable
            columns={["Instrument", "Trades", "Net", "Win rate", "PF", "Avg R"]}
            rows={Object.entries(result.byInstrument).map(([s, im]) => [
              s,
              im.trades,
              <span key="net" className={im.net >= 0 ? undefined : undefined}>
                {money(im.net)}
              </span>,
              im.trades ? pct(im.winRate) : "—",
              im.trades ? ratio(im.profitFactor) : "—",
              im.trades ? im.avgR.toFixed(2) : "—",
            ])}
          />
        </Panel>
      )}

      <Panel title="Qualification funnel" hint="why setups were skipped">
        <div className={styles.funnel}>
          {funnelRows.entries.length === 0 && (
            <span className={styles.note}>Nothing evaluated in this window.</span>
          )}
          {funnelRows.entries.map(([reason, count]) => (
            <div key={reason} className={styles.funnelRow}>
              <span>{FUNNEL_LABELS[reason] ?? reason}</span>
              <span className={styles.funnelBarTrack}>
                <span
                  className={styles.funnelBarFill}
                  style={{
                    width: `${(count / funnelRows.max) * 100}%`,
                    background: reason === "qualified" ? "var(--green)" : undefined,
                  }}
                />
              </span>
              <span className={styles.funnelCount}>{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Trades on chart"
        actions={
          symbols.length > 1 ? (
            <div style={{ width: 120 }}>
              <SelectField
                label=""
                value={chartSymbol}
                onChange={setChartSymbol}
                options={symbols.map((s) => ({ value: s, label: s }))}
              />
            </div>
          ) : undefined
        }
      >
        {chartBars.length ? (
          <CandleChart bars={chartBars} markers={markers} height={300} />
        ) : (
          <span className={styles.note}>No bars for this window.</span>
        )}
      </Panel>

      <Panel
        title="Trade ledger"
        actions={
          <Button
            small
            disabled={!result.trades.length}
            onClick={() => downloadCsv("aegis-trades.csv", tradesToCsv(result.trades))}
          >
            Export CSV
          </Button>
        }
      >
        <DataTable
          mobileCards={{ titleIndexes: [0, 3, 8] }}
          columns={[
            "Entry",
            "Exit",
            "Sym",
            "Side",
            "Qty",
            "In",
            "Out",
            "Pts",
            "P&L",
            "R",
            "Reason",
            "Score",
          ]}
          rows={result.trades.map((t) => [
            ts(t.entryTime),
            ts(t.exitTime),
            t.symbol,
            <Badge key="side" tone={t.side === "LONG" ? "green" : "red"}>
              {t.side}
            </Badge>,
            t.qty,
            t.entryPrice.toFixed(2),
            t.exitPrice.toFixed(2),
            t.points.toFixed(2),
            <span key="pnl" style={{ color: t.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
              {money(t.pnl)}
            </span>,
            t.rMultiple.toFixed(2),
            t.exitReason,
            t.score ?? "—",
          ])}
          empty="No trades in this window."
        />
      </Panel>
    </>
  );
}
