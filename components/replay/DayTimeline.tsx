"use client";

import { useMemo } from "react";
import type { SkipEvent } from "@/lib/backtest/engine";
import type { Trade } from "@/lib/types";
import type { MatchRow } from "@/lib/journal/match";
import { nyClock } from "@/lib/time/ny";
import { money } from "@/lib/format";
import { FUNNEL_LABELS } from "@/components/lab/funnel";
import { Badge } from "@/components/ui";
import styles from "./replay.module.css";

/* The day's decision log: consecutive identical skip reasons collapse into
   one span ("09:30–10:15 · Waiting for zone touch"), engine entries/exits
   and your journal entries interleave at their timestamps. All times ET. */

type Item =
  | { kind: "span"; start: number; end: number; reason: string; symbol?: string; count: number }
  | { kind: "engineEntry"; time: number; trade: Trade }
  | { kind: "engineExit"; time: number; trade: Trade }
  | { kind: "user"; time: number; row: Extract<MatchRow, { kind: "matched" | "engineSkipped" }> };

export default function DayTimeline({
  events,
  trades,
  rows,
  symbol,
}: {
  events: SkipEvent[];
  trades: Trade[];
  rows: MatchRow[];
  symbol: string | "all";
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    // Every-bar pipeline chatter would flood the list — hide it entirely.
    const hidden = new Set(["evaluated", "refined15", "nyCaution"]);
    const filtered = events
      .filter(
        (e) => !hidden.has(e.reason) && (symbol === "all" || !e.symbol || e.symbol === symbol)
      )
      .sort((a, b) => a.time - b.time || (a.symbol ?? "").localeCompare(b.symbol ?? ""));
    // Reasons interleave bar by bar (touch check, hours check, …), so collapse
    // per (reason, symbol) STREAM: a span continues while its next occurrence
    // is within MAX_GAP, regardless of other reasons in between.
    const MAX_GAP = 1800; // 30 min — 6 bars of tolerance
    const open = new Map<string, Extract<Item, { kind: "span" }>>();
    for (const e of filtered) {
      const key = `${e.reason}|${e.symbol ?? ""}`;
      const s = open.get(key);
      if (s && e.time - s.end <= MAX_GAP) {
        s.end = e.time;
        s.count++;
      } else {
        if (s) out.push(s);
        open.set(key, {
          kind: "span",
          start: e.time,
          end: e.time,
          reason: e.reason,
          symbol: e.symbol,
          count: 1,
        });
      }
    }
    for (const s of open.values()) out.push(s);
    for (const t of trades) {
      if (symbol !== "all" && t.symbol !== symbol) continue;
      out.push({ kind: "engineEntry", time: t.entryTime, trade: t });
      out.push({ kind: "engineExit", time: t.exitTime, trade: t });
    }
    for (const r of rows) {
      if (r.kind === "missedByYou") continue;
      if (symbol !== "all" && r.user.symbol !== symbol) continue;
      out.push({ kind: "user", time: r.user.entryTime, row: r });
    }
    return out.sort(
      (a, b) => (a.kind === "span" ? a.start : a.time) - (b.kind === "span" ? b.start : b.time)
    );
  }, [events, trades, rows, symbol]);

  if (!items.length)
    return <span className={styles.note}>No engine activity recorded for this day.</span>;

  return (
    <div className={styles.timeline}>
      {items.map((item, i) => {
        if (item.kind === "span") {
          const range =
            item.start === item.end
              ? nyClock(item.start)
              : `${nyClock(item.start)}–${nyClock(item.end)}`;
          return (
            <div key={i} className={styles.tlRowDim}>
              <span className={styles.tlTime}>{range} ET</span>
              <span className={styles.tlSym}>{item.symbol ?? ""}</span>
              <span>
                {FUNNEL_LABELS[item.reason] ?? item.reason}
                {item.count > 1 ? ` (×${item.count})` : ""}
              </span>
            </div>
          );
        }
        if (item.kind === "engineEntry" || item.kind === "engineExit") {
          const t = item.trade;
          return (
            <div key={i} className={styles.tlRowEngine}>
              <span className={styles.tlTime}>{nyClock(item.time)} ET</span>
              <span className={styles.tlSym}>{t.symbol}</span>
              <span>
                {item.kind === "engineEntry" ? (
                  <>
                    <Badge tone={t.side === "LONG" ? "green" : "red"}>{t.side}</Badge> Engine entry
                    ×{t.qty} @ {t.entryPrice.toFixed(2)} · stop {t.stop.toFixed(2)}
                    {t.target !== null && <> · target {t.target.toFixed(2)}</>}
                  </>
                ) : (
                  <>
                    Engine exit @ {t.exitPrice.toFixed(2)} ({t.exitReason}) ·{" "}
                    <span style={{ color: t.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                      {money(t.pnl)}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        }
        const r = item.row;
        return (
          <div key={i} className={styles.tlRowUser}>
            <span className={styles.tlTime}>{nyClock(item.time)} ET</span>
            <span className={styles.tlSym}>{r.user.symbol}</span>
            <span>
              <Badge tone="amber">YOURS</Badge> {r.user.side} ×{r.user.qty} @{" "}
              {r.user.entryPrice.toFixed(2)}{" "}
              {r.kind === "matched" ? (
                <Badge tone="green">engine took it too</Badge>
              ) : (
                <Badge tone="blue">
                  engine skipped
                  {r.nearestSkip
                    ? `: ${(FUNNEL_LABELS[r.nearestSkip.reason] ?? r.nearestSkip.reason).toLowerCase()}`
                    : ""}
                </Badge>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
