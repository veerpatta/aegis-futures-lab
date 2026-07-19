"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BacktestResult } from "@/lib/backtest/engine";
import type { RunRequest } from "@/lib/backtest/run";
import { RELAXATIONS, runWhatIf, type WhatIfRow } from "@/lib/backtest/whatif";
import { nyDateKey } from "@/lib/time/ny";
import { money, ratio } from "@/lib/format";
import { Badge, Button, DataTable, Panel } from "@/components/ui";
import { DIAGNOSTIC_REASONS, FUNNEL_LABELS } from "./funnel";
import styles from "./lab.module.css";

/* The Trade Frequency Doctor: (a) a per-NY-day funnel showing what blocked
   setups each day, (b) a what-if table re-running the same window with one
   gate relaxed at a time. Both exist to answer "why so few trades" with
   numbers instead of guesses. */

interface DayRow {
  date: string;
  trades: number;
  pnl: number;
  qualified: number;
  noHtf: number;
  blocker: { reason: string; count: number } | null;
}

export default function FrequencyDoctor({
  result,
  runRequest,
}: {
  result: BacktestResult;
  runRequest: RunRequest;
}) {
  const dayRows = useMemo<DayRow[]>(() => {
    const tradesByDay = new Map<string, { n: number; pnl: number }>();
    for (const t of result.trades) {
      const d = nyDateKey(t.entryTime);
      const cur = tradesByDay.get(d) ?? { n: 0, pnl: 0 };
      cur.n++;
      cur.pnl += t.pnl;
      tradesByDay.set(d, cur);
    }
    const days = new Set([...Object.keys(result.skipReasonsByDay), ...tradesByDay.keys()]);
    return [...days]
      .sort()
      .reverse()
      .map((date) => {
        const reasons = result.skipReasonsByDay[date] ?? {};
        let blocker: DayRow["blocker"] = null;
        for (const [reason, count] of Object.entries(reasons)) {
          if (DIAGNOSTIC_REASONS.has(reason)) continue;
          if (!blocker || count > blocker.count) blocker = { reason, count };
        }
        const t = tradesByDay.get(date);
        return {
          date,
          trades: t?.n ?? 0,
          pnl: t?.pnl ?? 0,
          qualified: reasons.qualified ?? 0,
          noHtf: reasons.noHtf ?? 0,
          blocker,
        };
      });
  }, [result]);

  const applicable = useMemo(
    () => RELAXATIONS.filter((r) => r.applies(runRequest.params)),
    [runRequest.params]
  );
  const [whatIf, setWhatIf] = useState<WhatIfRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyzing = progress !== null && progress.done < progress.total;

  const analyze = async () => {
    setError(null);
    setWhatIf(null);
    try {
      const rows = await runWhatIf(runRequest, result, (done, total) =>
        setProgress({ done, total })
      );
      setWhatIf(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  const perSession = result.sessions ? result.metrics.trades / result.sessions : 0;

  return (
    <>
      <Panel title="Per-day funnel" hint="what blocked setups, day by day">
        <DataTable
          mobileCards={{ titleIndexes: [0, 1, 2] }}
          columns={["Day", "Trades", "P&L", "Qualified", "No zone in range", "Top blocker"]}
          rows={dayRows.map((d) => [
            <Link key="d" href={`/replay?d=${d.date}`} className={styles.dayLink}>
              {d.date}
            </Link>,
            d.trades ? <Badge key="n" tone="green">{d.trades}</Badge> : "0",
            <span key="pnl" style={{ color: d.pnl > 0 ? "var(--green)" : d.pnl < 0 ? "var(--red)" : undefined }}>
              {d.trades ? money(d.pnl) : "—"}
            </span>,
            d.qualified,
            d.noHtf.toLocaleString(),
            d.blocker ? (
              <span key="b">
                {FUNNEL_LABELS[d.blocker.reason] ?? d.blocker.reason}
                <span className={styles.blockerCount}> ×{d.blocker.count.toLocaleString()}</span>
              </span>
            ) : (
              "—"
            ),
          ])}
          empty="No sessions in this window."
        />
      </Panel>

      <Panel
        title="What if I relax one gate?"
        hint="one re-run per gate, same window"
        actions={
          <Button small onClick={analyze} disabled={analyzing || !applicable.length}>
            {analyzing ? `Running ${progress!.done}/${progress!.total}…` : "Analyze"}
          </Button>
        }
      >
        {!applicable.length ? (
          <span className={styles.note}>
            No relaxable gates for this strategy&apos;s current parameters.
          </span>
        ) : whatIf ? (
          <>
            <DataTable
              mobileCards={{ titleIndexes: [0, 1] }}
              columns={["Gate", "Trades", "Per session", "Net", "PF", "Max DD"]}
              rows={whatIf.map((r) => [
                <span key="l" title={r.explain}>
                  {r.label}
                  {r.addedTrades > 0 && r.profitFactor >= 1.5 && (
                    <>
                      {" "}
                      <Badge tone="green">worth a look</Badge>
                    </>
                  )}
                </span>,
                <span key="t">
                  {r.trades}
                  {r.addedTrades !== 0 && (
                    <span className={r.addedTrades > 0 ? styles.deltaUp : styles.deltaDown}>
                      {" "}
                      {r.addedTrades > 0 ? `+${r.addedTrades}` : r.addedTrades}
                    </span>
                  )}
                </span>,
                r.tradesPerSession.toFixed(2),
                <span key="net" style={{ color: r.net > 0 ? "var(--green)" : r.net < 0 ? "var(--red)" : undefined }}>
                  {money(r.net)}
                </span>,
                r.trades ? ratio(r.profitFactor) : "—",
                money(-r.maxDrawdown, false),
              ])}
            />
            <p className={styles.note}>
              Baseline: {result.metrics.trades} trade{result.metrics.trades === 1 ? "" : "s"} in{" "}
              {result.sessions} sessions ({perSession.toFixed(2)} per session). Each row relaxes
              exactly one gate. Be honest with yourself here: on delayed 5-minute data the zone
              rules structurally produce ~0.1–0.3 trades per session — no single gate reaches 2–3
              trades a day, and rows that add trades while profit factor collapses are showing you
              the cost of forcing frequency, not an upgrade.
            </p>
          </>
        ) : (
          <span className={styles.note}>
            Press Analyze to re-run this exact window once per relaxable gate (
            {applicable.length} run{applicable.length === 1 ? "" : "s"}) and see how many trades
            each single gate is holding back — and at what cost to profit factor.
          </span>
        )}
        {error && <div className={styles.error}>{error}</div>}
      </Panel>
    </>
  );
}
