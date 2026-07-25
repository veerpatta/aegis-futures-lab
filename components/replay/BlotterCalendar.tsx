"use client";

import { useMemo } from "react";
import { nyMeta, nyTimeToUnix } from "@/lib/time/ny";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { money } from "@/lib/format";
import styles from "./replay.module.css";

/* 60-day blotter heatmap and day-picker: Mon–Fri columns, one row per week.
   Cell tint = engine P&L, amber underline = you journaled trades that day.

   The native pass made the cells square and cut them down to the day number
   and a compact P&L — pattern first, numbers second. The full reading (trade
   count, exact P&L, how many of yours) stays in the cell's tooltip, and the
   day panel below shows it in full once a day is picked. */

export interface BlotterDay {
  date: string; // NY dateKey
  engineTrades: number;
  enginePnl: number;
  userTrades: number;
}

const WEEKDAY_COL: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

/* A day cell is ~44px wide, so "+$1,284.00" has to become "+1.3k". Rounded to
   whole dollars below 1000 — the exact figure lives in the tooltip. */
function compact(v: number): string {
  const sign = v < 0 ? "−" : "+";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export default function BlotterCalendar({
  days,
  selected,
  onSelect,
}: {
  days: BlotterDay[];
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const { mask } = usePrivacy();
  const weeks = useMemo(() => {
    const byWeek = new Map<number, (BlotterDay & { col: number })[]>();
    for (const d of days) {
      const noon = nyTimeToUnix(d.date, 12 * 60);
      const meta = nyMeta(noon);
      const col = WEEKDAY_COL[meta.weekday];
      if (!col) continue; // weekend bars should not exist, but be safe
      // Monday-aligned week index (unix day 0 = Thu, so day 4 was a Monday).
      const week = Math.floor((Math.floor(noon / 86400) - 4) / 7);
      let list = byWeek.get(week);
      if (!list) byWeek.set(week, (list = []));
      list.push({ ...d, col });
    }
    return [...byWeek.entries()].sort(([a], [b]) => a - b).map(([, list]) => list);
  }, [days]);

  const maxAbsPnl = useMemo(
    () => Math.max(1, ...days.map((d) => Math.abs(d.enginePnl))),
    [days]
  );

  return (
    <div>
      <div className={styles.calHead}>
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
          <span key={d} title={d}>
            {d.charAt(0)}
          </span>
        ))}
      </div>
      {weeks.map((week, i) => {
        const byCol = new Map(week.map((d) => [d.col, d]));
        return (
          <div key={i} className={styles.calGrid} style={{ marginBottom: 4 }}>
            {[1, 2, 3, 4, 5].map((col) => {
              const d = byCol.get(col);
              if (!d) return <div key={col} className={styles.calEmpty} />;
              const alpha = d.engineTrades ? 0.08 + 0.3 * (Math.abs(d.enginePnl) / maxAbsPnl) : 0;
              const tint =
                d.enginePnl > 0
                  ? `rgba(45, 212, 160, ${alpha})`
                  : d.enginePnl < 0
                    ? `rgba(255, 107, 122, ${alpha})`
                    : undefined;
              return (
                <button
                  key={col}
                  type="button"
                  className={d.date === selected ? styles.calCellSelected : styles.calCell}
                  style={tint ? { background: tint } : undefined}
                  onClick={() => onSelect(d.date)}
                  title={`${d.date} · ${d.engineTrades} engine trade${d.engineTrades === 1 ? "" : "s"}${
                    d.engineTrades ? ` · ${money(d.enginePnl)}` : ""
                  }${d.userTrades ? ` · ${d.userTrades} of yours` : ""}`}
                >
                  <span className={styles.calDay}>{Number(d.date.slice(8))}</span>
                  <span className={styles.calTrades}>
                    {d.engineTrades ? mask(compact(d.enginePnl)) : "—"}
                  </span>
                  {d.userTrades > 0 && <span className={styles.calUserAccent} />}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
