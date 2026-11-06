/* Dev-only live check of the free AI helper's prompts: no database, no writes.

     NODE_USE_ENV_PROXY=1 NVIDIA_API_KEY=proxy-injected npx tsx scripts/ai/probe-live.ts [model ...]

   In the cloud sandbox the HTTPS proxy swaps the placeholder for the owner's
   saved NVIDIA key (Node's fetch needs NODE_USE_ENV_PROXY=1 to use the proxy).
   Builds the real second-opinion prompt and the two coach prompts from fixture
   facts (the 2026-11-06 S&P micro short), asks each model, and reports latency,
   whether the answer parses or validates, and the text. */

import { chat, FreeAiError, GEMMA_4, KIMI_K31_PRO, NEMOTRON_ULTRA } from "@/lib/ai-free/nvidia";
import { marketContext, sessionClock, type JudgeBar } from "@/lib/ai-judge/features";
import { JUDGE_SYSTEM, judgeUserMessage, parseJudgeVerdict, type JudgeIdea } from "@/lib/ai-judge/prompt";
import { DAY_SYSTEM, TRADE_SYSTEM } from "@/lib/ai-coach/runner";
import { dayFacts, tradeFacts } from "@/lib/ai-coach/facts";
import { validateNote } from "@/lib/ai-coach/validate";

const T = (iso: string) => Date.parse(iso) / 1000;
const cutoff = T("2026-11-06T15:10:00Z");

// A morning that rallied about 0.7%: rising 5-minute bars into the cutoff.
const bars: JudgeBar[] = [];
for (let t = T("2026-11-05T12:00:00Z"), p = 7380; t + 300 <= cutoff; t += 300, p += 0.22)
  bars.push({ time: t, open: p, high: p + 1.5, low: p - 1.2, close: p + 0.22 });

const idea: JudgeIdea = {
  symbol: "MES", side: "SHORT", strategy: "rsi-reversion", paused: true, entry: 7437.75, stop: 7460.398386884567, target: 7403.77741967315,
  rewardRisk: 1.5, riskUsdOneContract: 111.89193442283559, ...(({ newYork, minutesUntilFlat }) => ({ newYorkTime: newYork, minutesUntilFlat }))(sessionClock(cutoff)),
  features: { regime: "range-high-vol", vixBucket: "high", atrPct: 0.1796, vwapAtr: 4.6078 },
};
const trade = tradeFacts({
  decisionKey: "probe", symbol: "MES", side: "SHORT", action: "take", reason: "taken", decidedAt: cutoff,
  idea: { strategy: "rsi-reversion", entry: 7437.75, stop: 7460.398386884567, target: 7403.77741967315 }, estRisk: 111.89,
  position: { status: "closed", qty: 1, fill: 7438.75, fillTs: cutoff, exit: 7460.65, exitTs: cutoff + 600, exitReason: "stop", net: -111.89, cancelReason: null },
  outcome: { status: "closed", simStatus: "closed", net: -111.89, exitReason: "stop", exit: 7460.65, exitTs: cutoff + 600, fill: 7438.75, fillTs: cutoff },
})!;
const day = dayFacts({ dayKey: "2026-11-06", decided: 1, taken: 1, skipped: 0, closed: 1, wins: 0, losses: 1, resultUsd: -111.89, open: 0, balanceUsd: 9888.11, sp500ChangePct: 0.72, nasdaqChangePct: 1.51 });

async function ask(model: string, label: string, system: string, user: string, check: (text: string) => string) {
  const t0 = Date.now();
  try {
    const r = await chat({ system, user, models: [model], maxTokens: label === "judge" ? 1500 : 1200, temperature: label === "judge" ? 0.2 : 0.3 });
    console.log(`${model} ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s ${check(r.text)}\n   ${r.text.replace(/\s+/g, " ").slice(0, 400)}`);
  } catch (err) {
    const e = err instanceof FreeAiError ? `${e2(err)}` : "error";
    console.log(`${model} ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s FAILED ${e}`);
  }
}
const e2 = (e: FreeAiError) => `${e.code}${e.status ? ` ${e.status}` : ""}`;

async function main() {
 const models = process.argv.slice(2).length ? process.argv.slice(2) : [NEMOTRON_ULTRA, GEMMA_4, KIMI_K31_PRO];
 const judgeUser = judgeUserMessage(idea, marketContext({ bars, cutoffSec: cutoff, entry: idea.entry, stop: idea.stop }));
 for (const model of models) {
  await ask(model, "judge", JUDGE_SYSTEM, judgeUser, (t) => { const v = parseJudgeVerdict(t); return v ? `PARSED ${v.decision} ${v.confidence}` : "UNPARSEABLE"; });
  await ask(model, "trade-note", TRADE_SYSTEM, JSON.stringify(trade), (t) => { const v = validateNote(t.replace(/\s+/g, " ").trim(), trade, "trade"); return v.ok ? "ACCEPTED" : `REJECTED ${v.reason}`; });
  await ask(model, "day-recap", DAY_SYSTEM, JSON.stringify(day), (t) => { const v = validateNote(t.replace(/\s+/g, " ").trim(), day, "day"); return v.ok ? "ACCEPTED" : `REJECTED ${v.reason}`; });
}
}
void main();
