/* The nightly report card, in plain trading language.
   ─────────────────────────────────────────────────────────────────────────
   Audit item 13 asks for an "AI-generated daily debrief". This composes the
   prose DETERMINISTICALLY instead, and the reason is worth stating rather
   than assuming: every sentence below carries a number, and a language model
   asked to narrate numbers will eventually round one, transpose one, or
   confidently describe a trend that is one trade long. The whole app exists
   to stop small samples reading as findings; generating its own summary with
   something that can hallucinate would undo that at the last step.

   What is lost is phrasing variety. What is kept is that every claim is
   reproducible from the row data and testable — which is what this file is.

   Split from debrief.ts so it is unit-testable; debrief.ts self-executes,
   the same split the repo uses for challenger / challenger-logic. */

import { expectancy, profitFactor, rateFromPnls, MIN_JUDGED_N } from "@/lib/stats";
import { money } from "@/lib/format";

export interface DebriefRow {
  symbol: string;
  tier: string | null;
  status: string;
  pnl_usd: number | null;
  signal_ts: string;
  suppressed?: boolean | null;
  stale_data?: boolean | null;
}

export interface DebriefInput {
  dateKey: string; // NY trading date this covers
  rows: DebriefRow[]; // every signal stamped with that trading day
  /** Skip-funnel counts for the day, if the engine recorded them. */
  funnel?: Record<string, number>;
  barsSeen?: number;
  engineHealthy: boolean;
}

/** Reasons a trader can act on, in the order worth reading them. */
const FUNNEL_COPY: { key: string; text: string }[] = [
  { key: "noTouch", text: "price never reached a zone" },
  { key: "nesting", text: "no daily or 4-hour zone in range" },
  { key: "hours", text: "outside the trading window" },
  { key: "intermarket", text: "the two markets disagreed" },
  { key: "weakZone", text: "the zone had not proved anything yet" },
  { key: "firstZone", text: "first market to the zone — skipped on purpose" },
  { key: "lock", text: "the daily discipline lock was on" },
  { key: "invalidFill", text: "the fill would not have been real" },
  { key: "riskUnfit", text: "the stop was too wide to size" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The counted rows: finished, not suppressed, not computed on stale bars. */
export function judgedRows(rows: DebriefRow[]): DebriefRow[] {
  return rows.filter((r) => r.pnl_usd !== null && !r.suppressed && !r.stale_data);
}

export function buildDebrief(input: DebriefInput): string {
  const { dateKey, rows, funnel = {}, barsSeen, engineHealthy } = input;
  const done = judgedRows(rows);
  const pnls = done.map((r) => r.pnl_usd ?? 0);
  const net = pnls.reduce((a, v) => a + v, 0);
  const rate = rateFromPnls(pnls);
  const exp = expectancy(pnls);
  const pf = profitFactor(pnls);

  const lines: string[] = [];
  lines.push(`<b>Report card — ${dateKey}</b>`);

  if (!engineHealthy) {
    /* Health leads when it is bad. A quiet day and a broken engine look
       identical on a results line, and only one of them is fine. */
    lines.push("");
    lines.push("⚠️ The engine did not run cleanly today, so treat everything below as incomplete.");
  }

  lines.push("");

  if (done.length === 0) {
    const open = rows.filter((r) => r.pnl_usd === null && !r.suppressed).length;
    lines.push(
      open > 0
        ? `No trades finished today. ${plural(open, "idea")} still open.`
        : "No trades today."
    );
    /* A no-trade day is the normal case for this strategy, so the funnel
       matters more than the (empty) result. */
    const why = topFunnelReasons(funnel);
    if (why.length) {
      lines.push("");
      lines.push("Why nothing qualified:");
      for (const w of why) lines.push(`• ${w}`);
    }
    if (barsSeen) {
      lines.push("");
      lines.push(
        `The bot checked ${plural(barsSeen, "five-minute candle")} and waited. That is the strategy working, not failing.`
      );
    }
    return lines.join("\n");
  }

  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const verb = net > 0 ? "made" : net < 0 ? "lost" : "finished flat at";
  lines.push(
    `The bot ${verb} ${money(Math.abs(net), false)} across ${plural(done.length, "trade")} — ` +
      `${wins} up, ${losses} down.`
  );

  lines.push("");
  lines.push(`Expectancy: <b>${exp === null ? "—" : money(exp)}</b> per trade`);
  lines.push(
    `Win rate: ${rate.valueLabel} (${rate.nLabel}${rate.ciLabel ? `, 95% CI ${rate.ciLabel}` : ""})`
  );
  if (pf !== null) lines.push(`Profit factor: ${pf.toFixed(2)}`);

  /* One day is never enough to judge, and the report card is exactly where a
     reader is most tempted to. Say so every single time, not just when the
     numbers are bad. */
  lines.push("");
  lines.push(
    done.length < MIN_JUDGED_N
      ? `<i>One day is ${plural(done.length, "trade")}. That is previewed, not judged — nothing here is evidence of anything on its own.</i>`
      : "<i>Judge this against the running record, not on its own.</i>"
  );

  const bySymbol = new Map<string, number>();
  for (const r of done) bySymbol.set(r.symbol, (bySymbol.get(r.symbol) ?? 0) + (r.pnl_usd ?? 0));
  if (bySymbol.size > 1) {
    lines.push("");
    lines.push(
      [...bySymbol.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, v]) => `${s} ${money(v)}`)
        .join(" · ")
    );
  }

  const suppressed = rows.filter((r) => r.suppressed).length;
  const stale = rows.filter((r) => r.stale_data).length;
  if (suppressed || stale) {
    lines.push("");
    const notes: string[] = [];
    if (suppressed) notes.push(`${plural(suppressed, "row")} from a benched stream`);
    if (stale) notes.push(`${plural(stale, "row")} computed on delayed bars`);
    lines.push(`<i>Excluded above: ${notes.join(", ")}.</i>`);
  }

  return lines.join("\n");
}

/** The three biggest actionable skip reasons, translated. */
export function topFunnelReasons(funnel: Record<string, number>, limit = 3): string[] {
  return FUNNEL_COPY.filter((f) => (funnel[f.key] ?? 0) > 0)
    .sort((a, b) => (funnel[b.key] ?? 0) - (funnel[a.key] ?? 0))
    .slice(0, limit)
    .map((f) => `${f.text} (${funnel[f.key]}×)`);
}
