import type { Bar } from "@/lib/types";
import type { ExpTradeRow } from "@/lib/experiment/view";

export function loadedRange(bars: Bar[]) {
  const valid = bars.filter(b => [b.time, b.low, b.high, b.close].every(Number.isFinite) && b.high >= b.low && b.close >= b.low && b.close <= b.high);
  if (!valid.length) return null;
  let low = Infinity, high = -Infinity, first = valid[0], last = valid[0];
  for (const b of valid) { low = Math.min(low, b.low); high = Math.max(high, b.high); if (b.time < first.time) first = b; if (b.time > last.time) last = b; }
  return { low, high, last: last.close, from: first.time, to: last.time, n: valid.length, fraction: high === low ? .5 : Math.min(1, Math.max(0, (last.close - low) / (high - low))) };
}

export function decisionMix(rows: Pick<ExpTradeRow, "action" | "position_status">[]) {
  const mix = [
    { key: "closed", label: "Closed", count: 0 },
    { key: "open", label: "Open", count: 0 },
    { key: "pending", label: "Waiting", count: 0 },
    { key: "skipped", label: "Skipped", count: 0 },
    { key: "unfilled", label: "No fill", count: 0 },
    { key: "other", label: "Unconfirmed", count: 0 },
  ];
  for (const r of rows) {
    const key = r.action === "skip" ? "skipped" : r.position_status === "closed" ? "closed" : r.position_status === "open" ? "open" : r.position_status === "pending_fill" ? "pending" : r.position_status === "cancelled" ? "unfilled" : "other";
    mix.find(x => x.key === key)!.count++;
  }
  return mix.filter(x => x.key !== "other" || x.count > 0);
}
