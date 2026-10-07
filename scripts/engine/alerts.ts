/* Pure alert logic for the Telegram notifier: diff the signal rows a run is
   about to upsert against the statuses already in the table, and format one
   combined message. No network, no clock — unit-testable end to end.

   Every message keeps the paper framing: these are simulated ideas from
   delayed data, never orders. */

import { clockIn } from "@/lib/time/zones";

/* The fields the alerts need — run-live's SignalRow satisfies this shape. */
export interface AlertSignal {
  dedupe_key: string;
  tier: "A" | "B";
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  target_price: number | null;
  rr: number | null;
  status: string;
  pnl_usd: number | null;
  signal_ts: string;
}

export interface SignalAlerts {
  opened: AlertSignal[];
  closed: AlertSignal[];
}

import { CLOSED_STATUSES } from "@/lib/signals/status";

/* Newly triggered: the dedupe key was absent before, or its status just
   became "triggered". Newly closed: it just moved from "triggered" to a
   terminal status. Rows whose status did not change produce nothing — the
   idempotent recompute rewrites unchanged rows every run. */
export function diffSignalAlerts(
  oldStatus: Map<string, string>,
  rows: AlertSignal[]
): SignalAlerts {
  const opened: AlertSignal[] = [];
  const closed: AlertSignal[] = [];
  for (const row of rows) {
    const prev = oldStatus.get(row.dedupe_key);
    if (prev === undefined) {
      opened.push(row);
    } else if (prev !== "triggered" && row.status === "triggered") {
      opened.push(row);
    } else if (prev === "triggered" && CLOSED_STATUSES.has(row.status)) {
      closed.push(row);
    }
  }
  return { opened, closed };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const money = (v: number) => `${v < 0 ? "−" : "+"}$${Math.abs(v).toFixed(0)}`;

function ideaLine(s: AlertSignal): string {
  const sec = Math.floor(new Date(s.signal_ts).getTime() / 1000);
  const side = s.direction === "long" ? "LONG" : "SHORT";
  const parts = [
    `🟢 NEW IDEA — Tier ${s.tier} ${escapeHtml(s.symbol)} ${side} @ ${s.entry_price.toFixed(2)}`,
    `stop ${s.stop_price.toFixed(2)}`,
    `target ${s.target_price === null ? "—" : s.target_price.toFixed(2)}`,
    `R:R ${s.rr === null ? "—" : s.rr.toFixed(1)}`,
    `${clockIn(sec, "ET")} ET / ${clockIn(sec, "IST")} IST`,
  ];
  let line = `${parts.join(" · ")} (paper idea — not an order)`;
  // A brand-new key can arrive already resolved (opened and closed between
  // two runs) — say so instead of announcing a live idea.
  if (CLOSED_STATUSES.has(s.status) && s.pnl_usd !== null)
    line += ` — already closed: ${money(s.pnl_usd)}`;
  return line;
}

function closedLine(s: AlertSignal): string {
  const side = s.direction === "long" ? "LONG" : "SHORT";
  const head =
    s.status === "hit_target"
      ? "🎯 TARGET HIT"
      : s.status === "hit_stop"
        ? "🛑 STOPPED"
        : "⌛ EXPIRED flat";
  const pnl = s.pnl_usd === null ? "" : ` · ${money(s.pnl_usd)}`;
  return `${head} — Tier ${s.tier} ${escapeHtml(s.symbol)} ${side} @ ${s.entry_price.toFixed(2)}${pnl}`;
}

/* One combined message per run, or null when nothing changed. Telegram caps
   messages at 4096 chars — stay under maxLen and say how many were cut. */
export function formatAlertMessage(alerts: SignalAlerts, maxLen = 3500): string | null {
  const lines = [...alerts.opened.map(ideaLine), ...alerts.closed.map(closedLine)];
  if (!lines.length) return null;
  const header = "<b>Aegis paper signals</b> — delayed data, simulation only";
  let kept = lines.length;
  const render = () => {
    const cut = lines.length - kept;
    return [header, ...lines.slice(0, kept), ...(cut > 0 ? [`…and ${cut} more`] : [])].join("\n");
  };
  let out = render();
  while (out.length > maxLen && kept > 1) {
    kept--;
    out = render();
  }
  return out;
}

/* Trial account lines, sent after the trial broker's pass. Practice money that
   copies every idea, so every line carries "not proven". Positions are what
   lib/trial/engine.ts returns. */
export interface TrialAlertPosition {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entry: number;
  risk: number;
  pnl: number | null;
}

export function formatTrialMessage(run: { opened: TrialAlertPosition[]; closed: TrialAlertPosition[]; equity: number; locked: boolean }, maxLen = 3500): string | null {
  const lines = [
    ...run.opened.map((p) => `🧪 Trial took ${p.qty} ${escapeHtml(p.symbol)} ${p.side} @ ${p.entry.toFixed(2)} · risk $${p.risk.toFixed(0)}`),
    ...run.closed.map((p) => `🧪 Trial closed ${p.qty} ${escapeHtml(p.symbol)} ${p.side}${p.pnl === null ? "" : ` · ${money(p.pnl)}`}`),
    ...(run.locked ? ["⛔ Trial stopped: down $2,000 from its best balance. A new round needs the trial-reset workflow."] : []),
  ];
  if (!lines.length) return null;
  const out = ["<b>Aegis trial account</b> — practice money, not proven", ...lines, `Balance $${run.equity.toFixed(2)}`].join("\n");
  return out.length > maxLen ? out.slice(0, maxLen - 1) + "…" : out;
}
