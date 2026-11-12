"use client";

/* The time machine card on a bot trade (lib/timemachine). Lives inside a
   Fold, so the ~60 days of bars are fetched only when someone opens it. Only
   prices from before the trade's day are used. */

import { useEffect, useState } from "react";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { timeMachine, TM_LOOKBACK_DAYS, type TmBar, type TmResult, type TmRefusal } from "@/lib/timemachine";
import { pct, tmCaveat, tmCostLine, tmExplain, tmHeadline, tmHistoryLine, tmRangeLine, tmRefusalWords, tmTone } from "@/lib/plain/timemachine";
import { COMMISSION_RT, pointValue, slipPoints } from "@/lib/experiment/policy";
import page from "@/components/ui/page.module.css";
import styles from "./timemachine.module.css";

type State = { kind: "loading" } | { kind: "failed" } | { kind: "none"; why: string } | { kind: "refused"; refusal: TmRefusal } | { kind: "ok"; result: TmResult; startSec: number };

const cache = new Map<string, Promise<TmBar[]>>();

function loadBars(symbol: string, from: number, to: number): Promise<TmBar[]> {
  const key = `${symbol}:${from}:${to}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(`/api/archive?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&session=ny`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { bars?: TmBar[] }) => j.bars ?? []);
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/** The plan the bot actually held: its fill when it filled, else the price when it decided. */
export function tradePlan(row: ExpTradeRow) {
  const idea = row.idea;
  if (!idea) return null;
  const entry = row.fill_price ?? row.ref_price ?? idea.entry;
  const start = row.fill_ts ?? row.decided_at;
  if (entry == null || !start) return null;
  return { side: row.side, entry: Number(entry), stop: Number(idea.stop), target: idea.target == null ? null : Number(idea.target), startSec: Math.floor(Date.parse(start) / 1000) };
}

export default function TimeMachine({ row }: { row: ExpTradeRow }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    const plan = tradePlan(row);
    if (!plan || !Number.isFinite(plan.startSec)) {
      setState({ kind: "none", why: "This trade has no saved entry, stop and time to replay." });
      return;
    }
    setState({ kind: "loading" });
    // Whole hours, so reopening the same trade reuses one request; the day's own bars are dropped by the engine.
    const to = Math.floor(plan.startSec / 3600) * 3600;
    const from = to - TM_LOOKBACK_DAYS * 86_400;
    loadBars(row.symbol, from, to)
      .then((bars) => {
        if (!live) return;
        // Let the "Replaying…" line paint before 10,000 replays run.
        setTimeout(() => {
          if (!live) return;
          const r = timeMachine(bars, plan);
          setState(r.ok ? { kind: "ok", result: r, startSec: plan.startSec } : { kind: "refused", refusal: r });
        }, 0);
      })
      .catch(() => live && setState({ kind: "failed" }));
    return () => {
      live = false;
    };
  }, [row, retry]);

  if (state.kind === "loading") return <p className={page.loading}>Replaying past days…</p>;
  if (state.kind === "failed")
    return (
      <p className={page.warning}>
        The past prices could not load. <button type="button" onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </p>
    );
  if (state.kind === "none") return <p className={page.warning}>{state.why}</p>;
  if (state.kind === "refused") return <p className={page.warning}>{tmRefusalWords(state.refusal)}</p>;

  const r = state.result;
  const n = r.odds.replays.toLocaleString("en-US");
  // The bot's own cost model for one contract: round-trip commission plus slippage on both sides.
  const pv = pointValue(row.symbol);
  const costDollars = COMMISSION_RT + 2 * slipPoints(row.symbol, state.startSec) * pv;
  const costR = costDollars / (r.risk * pv);
  const tone = tmTone(r.verdict);
  const parts = [
    { key: "target", label: "Target first", share: r.odds.targetFirst, cls: styles.target },
    { key: "stop", label: "Stop first", share: r.odds.stopFirst, cls: styles.stop },
    { key: "neither", label: "Still open", share: r.odds.neither, cls: styles.neither },
  ];
  return (
    <div className={styles.wrap}>
      <p className={`${styles.verdict} ${styles[tone]}`}>
        <b>{tmHeadline(r.verdict)}</b>
      </p>
      <div className={page.tiles}>
        {parts.map((p) => (
          <div key={p.key} className={page.tile}>
            <span>{p.label}</span>
            <b className="num">{pct(p.share)}</b>
            <small>of {n} replays</small>
          </div>
        ))}
      </div>
      <div className={styles.bar} role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.share)}`).join(", ")}>
        {parts.map((p) => (p.share > 0 ? <span key={p.key} className={p.cls} style={{ width: `${p.share * 100}%` }} /> : null))}
      </div>
      {tmExplain(r).map((line) => (
        <p key={line} className={styles.line}>
          {line}
        </p>
      ))}
      <p className={styles.line}>{tmRangeLine(r)}</p>
      <p className={styles.line}>{tmCostLine(costDollars, costR, r.odds.avgR)}</p>
      <p className={styles.line}>{tmHistoryLine(r.history)}</p>
      <p className={page.note}>{tmCaveat(r)}</p>
    </div>
  );
}
