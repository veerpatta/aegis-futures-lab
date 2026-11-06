"use client";

/* One bot decision as a single tappable row: the market, what the bot did in
   plain words, the method and the time, then the result. The full story (the
   price ladder, the timeline, the costs, the AI's second opinion) is one tap
   away on /trades/[id]. */

import Link from "next/link";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { AiOpinion } from "@/components/ai/AiViews";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { cancelWords, exitWords, skipWords } from "@/lib/plain/experiment";
import { marketName } from "@/lib/plain/idea";
import { methodName } from "@/lib/plain/strategies";
import { COMMISSION_RT, pointValue } from "@/lib/experiment/policy";
import { money } from "@/lib/format";
import { stampIn } from "@/lib/time/zones";
import s from "./row.module.css";

/** What happened to a decision, in a few words. */
export function outcomeLine(r: Pick<ExpTradeRow, "action" | "reason" | "position_status" | "cancel_reason" | "exit_reason"> & { idea?: ExpTradeRow["idea"] }): string {
  if (r.action !== "take") return skipWords(r.reason, r.idea?.decisionEvidence?.limits);
  if (r.position_status === "pending_fill") return "Order waiting for the next price";
  if (r.position_status === "open") return "Open now";
  if (r.position_status === "cancelled") return cancelWords(r.cancel_reason);
  return exitWords(r.exit_reason);
}

/** "Buy" or "Sell": the words a non-trader expects, the side shown as a direction. */
export const sideWord = (side: "LONG" | "SHORT") => (side === "LONG" ? "Buy" : "Sell");

/** The decision's money result: final when closed, an estimate while open, none otherwise. */
export function tradeResult(r: Pick<ExpTradeRow, "position_status" | "net" | "mark" | "fill_price" | "side" | "symbol" | "qty">): { value: number | null; estimate: boolean } {
  if (r.position_status === "closed") return { value: r.net, estimate: false };
  if (r.position_status === "open" && r.mark !== null && r.fill_price !== null)
    return { value: (r.mark - r.fill_price) * (r.side === "LONG" ? 1 : -1) * pointValue(r.symbol) * r.qty - COMMISSION_RT * r.qty, estimate: true };
  return { value: null, estimate: false };
}

export function TradeRow({ row }: { row: ExpTradeRow }) {
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const taken = row.action === "take";
  const { value, estimate } = tradeResult(row);
  const stale = estimate && !!row.stale;
  const tone = value === null || stale ? s.dim : value > 0 ? s.good : value < 0 ? s.bad : s.dim;
  const status = !taken ? "Skipped" : row.position_status === "cancelled" ? "Not filled" : row.position_status === "pending_fill" ? "Waiting" : row.position_status === "open" ? (stale ? "Open · stale price" : "Open") : exitWords(row.exit_reason);
  // Unbooked results keep their own words: never a made-up number, never a bare dash.
  const empty = !taken ? "Not taken" : row.position_status === "cancelled" ? "No fill" : row.position_status === "pending_fill" ? "Pending" : "—";
  return (
    <Link href={`/trades/${row.id}`} className={`${s.row} pressSm`}>
      <span className={`${s.icon} ${row.symbol === "MNQ" ? s.nasdaq : ""}`} aria-hidden>{row.symbol === "MES" ? "S&P" : "NQ"}</span>
      <span className={s.main}>
        <b>
          {marketName(row.symbol)} · {sideWord(row.side)}
          {taken && row.qty > 1 ? ` · ${row.qty}` : ""}
        </b>
        <small>
          {methodName(row.idea?.strategy)} · {stampIn(Date.parse(row.decided_at) / 1000, zone)}
        </small>
      </span>
      <span className={s.side}>
        <b className={`num ${tone}`}>{value === null ? empty : `${estimate ? "~" : ""}${mask(money(value))}`}</b>
        <small>
          {status} <AiOpinion decisionKey={row.decision_key} botAction={row.action} compact />
        </small>
      </span>
    </Link>
  );
}
