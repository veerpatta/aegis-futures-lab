"use client";

import { useMemo } from "react";
import { nyMeta, nyTimeToUnix } from "@/lib/time/ny";
import { money } from "@/lib/format";
import styles from "./replay.module.css";

/* 60-day blotter heatmap and day-picker: Mon–Fri columns, one row per week.
   Cell tint = engine P&L, amber underline = you journaled trades that day. */

export interface BlotterDay {
  date: string; // NY dateKey
  engineTrades: number;
  enginePnl: number;
  userTrades: number;
}

const WEEKDAY_COL: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

export default function BlotterCalendar({
  days,
  selected,
  onSelect,
}: {
  days: BlotterDay[];
  selected: string | null;
  onSelect: (date: string) => void;
}) {
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
          <span key={d}>{d}</span>
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
                  <span className={styles.calDay}>{d.date.slice(5)}</span>
                  <span className={styles.calTrades}>
                    {d.engineTrades ? `${d.engineTrades}× ${money(d.enginePnl)}` : "—"}
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
