/* The time machine, in plain words. Every sentence is built from the numbers
   in lib/timemachine; nothing here is typed as a figure. */

import type { TmHistory, TmRefusal, TmResult, TmVerdict } from "@/lib/timemachine";
import { etTimeLabel, etWindowLabel } from "@/lib/time/zones";
import { TM_FIRST_MIN } from "@/lib/timemachine";
import { SESSION_FLAT_MINUTE } from "@/lib/signals/open-state";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** "15:25 ET (01:55 IST)" — the bot's normal flat-by time, both clocks. */
export const tmFlatLabel = () => etTimeLabel(hhmm(SESSION_FLAT_MINUTE));

/** "02:00–15:25 ET (…IST)" — the stretch the time machine replays, both clocks. */
export const tmWindowLabel = () => etWindowLabel(hhmm(TM_FIRST_MIN), hhmm(SESSION_FLAT_MINUTE));

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rWords = (r: number) => (Math.abs(r) < 0.005 ? "about zero" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)} times the risk`);

export const TM_TITLE = "Time machine";
export const TM_SUMMARY = "Time machine · the odds before this trade, from 10,000 replays of past days";

export function tmHeadline(v: TmVerdict): string {
  switch (v.lean) {
    case "no-target":
      return "No target, so no win rate to compare.";
    case "no-hits":
      return "No replay reached the stop or the target in time.";
    case "even":
      return v.rr !== null && Math.abs(v.rr - 1) < 0.05 ? "Close to a coin flip." : "Close to break-even.";
    case "leans-target":
      return "Leans toward the target.";
    case "leans-stop":
      return "Leans toward the stop.";
    case "strong-target":
      return "Strongly toward the target.";
    case "strong-stop":
      return "Strongly toward the stop.";
  }
}

/** Amber for close calls and missing pieces; green or red only for a clear lean either way. */
export function tmTone(v: TmVerdict): "good" | "warn" | "bad" {
  if (v.lean === "leans-target" || v.lean === "strong-target") return "good";
  if (v.lean === "leans-stop" || v.lean === "strong-stop") return "bad";
  return "warn";
}

export function tmExplain(r: TmResult): string[] {
  const v = r.verdict;
  const out: string[] = [];
  if (v.need !== null && v.got !== null && v.rr !== null)
    out.push(
      `The target was ${v.rr.toFixed(2)} times as far as the stop. To break even before costs, the target had to come first in ${pct(v.need)} of the replays that reached either side. It came first in ${pct(v.got)}.`,
    );
  if (v.manyNeither) out.push(`More than 4 in 10 replays were still open at ${tmFlatLabel()}, so where the price sat then decides most of them.`);
  if (v.avgAgainstLean) out.push(`The average result points the other way (${rWords(r.odds.avgR)}), because of the replays still open at the end.`);
  return out;
}

const times = (n: number) => `${n} time${n === 1 ? "" : "s"}`;

export function tmHistoryLine(h: TmHistory): string {
  return `On each of the ${h.sessions} past days, the same stop and target placed at the same time of day hit the target ${times(h.target)}, the stop ${times(h.stop)} and neither ${times(h.neither)} (average ${rWords(h.avgR)}).`;
}

/** Costs are not in the replays; this line puts them back for one contract. */
export function tmCostLine(costDollars: number, costR: number, avgR: number): string {
  return `One contract pays about $${costDollars.toFixed(2)} in commission and slippage, which is ${costR.toFixed(2)} times the risk on this trade. After costs, the average replay is ${rWords(avgR - costR)}.`;
}

export function tmRangeLine(r: TmResult): string {
  return `Middle result ${rWords(r.odds.medianR)}; 9 in 10 replays ended between ${rWords(r.odds.p5R)} and ${rWords(r.odds.p95R)}. Average ${rWords(r.odds.avgR)}.`;
}

export function tmCaveat(r: TmResult): string {
  return `Built only from the bot's own delayed 5-minute prices on the ${r.sessions} full trading days before this one (${r.firstSession} to ${r.lastSession}), from this trade's first bar to ${tmFlatLabel()}. Seed ${r.odds.seed}, so the numbers repeat exactly. It is a simulation, not a prediction: news, a Fed day or a halt can do things those days never did. Results are before costs.`;
}

export function tmRefusalWords(r: TmRefusal): string {
  switch (r.kind) {
    case "bad-plan":
      return r.why === "target-side" ? "The saved target is on the wrong side of the entry, so there is nothing fair to replay." : "The saved stop leaves no risk to measure, so there is nothing fair to replay.";
    case "outside-session":
      return `This trade starts outside the bot's entry window (${tmWindowLabel()}), which is all the time machine replays.`;
    case "early-close":
      return "This was a short trading day. Past full days are not a fair stand-in, so the time machine does not run.";
    case "few-sessions":
      return `Only ${r.have} full trading days of prices before this one; it needs at least ${r.need} for fair odds.`;
  }
}
