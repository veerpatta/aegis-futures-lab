/* Today's story in the app's own words.

   Today's "In plain words" card shows the AI's daily note to the signed-in
   owner when one passed its number check (lib/ai-coach). Everyone else, and
   the owner whenever no such note exists, reads these sentences, built only
   from the virtual account's own record. Nothing here guesses at a cause.
   Pure; pinned by tests/plain-recap.test.ts. */

import type { ExpOverview, ExpTradeRow } from "@/lib/experiment/view";
import { tradingDayKey } from "@/lib/time/ny";
import { cancelWords, exitWords, skipWords } from "./experiment";
import { marketName } from "./idea";
import { methodName, plainSummary } from "./strategies";

const price = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * One trade's story for someone who has never traded: what the bot did, with
 * which method, and how it ended. Only recorded facts; a loss is not called a
 * mistake. `cash` formats (and masks) a signed dollar figure.
 */
export function tradeStory(
  r: Pick<ExpTradeRow, "action" | "reason" | "symbol" | "side" | "qty" | "position_status" | "fill_price" | "exit_price" | "exit_reason" | "cancel_reason" | "net" | "fill_ts" | "exit_ts" | "idea">,
  cash: (n: number) => string,
): string {
  const market = marketName(r.symbol);
  const method = r.idea?.strategy ? `${methodName(r.idea.strategy)} (${plainSummary(r.idea.strategy, "one of the bot's methods").replace(/\.$/, "").toLowerCase()})` : "one of its methods";
  const bet = r.side === "LONG" ? "the price would rise" : "the price would fall";
  if (r.action !== "take")
    return `The ${method} method suggested betting that ${bet} on the ${market}. The bot skipped it: ${skipWords(r.reason, r.idea?.decisionEvidence?.limits).replace(/^Skipped: /, "").toLowerCase()}. Skipped ideas are still followed, so the bot learns from the ones it passed on too.`;
  const contracts = `${r.qty} ${r.qty === 1 ? "contract" : "contracts"}`;
  const verb = r.side === "LONG" ? "bought" : "sold";
  if (r.position_status === "cancelled") {
    const why = cancelWords(r.cancel_reason).replace(/^Not filled:?\s*/, "");
    return `The bot tried to act on the ${method} method's idea, betting that ${bet} on the ${market}, but the order was not filled${why ? ` (${why})` : ""}, so no money changed.`;
  }
  if (r.position_status === "pending_fill")
    return `The bot decided to bet that ${bet} on the ${market}, using the ${method} method. The order waits for the next delayed price.`;
  const opened = `The bot ${verb} ${contracts} of the ${market} at ${price(r.fill_price)}, betting that ${bet}, using the ${method} method.`;
  if (r.position_status === "open") return `${opened} The trade is still open; the stop and target close it automatically.`;
  const minutes = r.fill_ts && r.exit_ts ? Math.round((Date.parse(r.exit_ts) - Date.parse(r.fill_ts)) / 60000) : null;
  const held = minutes !== null && minutes >= 0 ? ` after ${minutes < 90 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.round(minutes / 60)} hours`}` : "";
  const result = r.net === null ? "" : ` The result was ${cash(r.net)} after costs.`;
  return `${opened} It closed${held} at ${price(r.exit_price)} (${exitWords(r.exit_reason).toLowerCase()}).${result}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Decisions the bot made on the current New York trading day. */
export function decisionsToday(o: Pick<ExpOverview, "recent_decisions"> | null, nowSec: number): ExpOverview["recent_decisions"] {
  if (!o) return [];
  const today = tradingDayKey(nowSec);
  return o.recent_decisions.filter((d) => {
    const t = Date.parse(d.decided_at);
    return Number.isFinite(t) && tradingDayKey(Math.floor(t / 1000)) === today;
  });
}

/**
 * Three or four short sentences about the day: what the bot decided, what
 * finished, what is still open and where the balance stands. `cash` formats
 * (and masks, when amounts are hidden) a signed dollar figure.
 */
export function todayRecap(o: ExpOverview | null, nowSec: number, cash: (n: number) => string): string[] {
  if (!o || !o.account) return [];
  const lines: string[] = [];
  const today = decisionsToday(o, nowSec);
  const taken = today.filter((d) => d.action === "take").length;
  const skipped = today.length - taken;

  if (today.length === 0) lines.push("No new ideas have reached the bot yet today.");
  else if (today.length === 1) lines.push(`Today the bot looked at 1 idea and ${taken ? "took it" : "skipped it"}.`);
  else lines.push(`Today the bot looked at ${today.length} ideas: it took ${taken} and skipped ${skipped}.`);

  const closed = o.today?.closed ?? 0;
  if (closed > 0) {
    const wins = o.today?.wins ?? 0;
    const net = cash(o.today?.net ?? 0);
    lines.push(
      closed === 1
        ? `One trade finished today and ${wins ? "won" : "lost"}: ${net} after costs.`
        : `${closed} trades finished today (${wins} won, ${closed - wins} lost): ${net} after costs.`,
    );
  }

  const open = o.open_positions.filter((p) => p.status === "open").length;
  const waiting = o.open_positions.filter((p) => p.status === "pending_fill").length;
  if (open > 0) lines.push(`${plural(open, "trade is", "trades are")} still open.`);
  if (waiting > 0) lines.push(`${plural(waiting, "order is", "orders are")} waiting for the next price.`);

  const change = o.account.equity - o.experiment.capital;
  const since = new Date(o.experiment.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  lines.push(
    Math.abs(change) < 0.005
      ? `The virtual balance is still at its starting amount since this campaign began on ${since}.`
      : `Since this campaign began on ${since}, the virtual balance is ${change > 0 ? "up" : "down"} ${cash(Math.abs(change)).replace(/^[+−-]/, "")}.`,
  );
  return lines;
}
