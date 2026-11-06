/* Dev-only live check of the AI research ideas' proposal prompt: no database.

     NODE_USE_ENV_PROXY=1 NVIDIA_API_KEY=proxy-injected npx tsx scripts/ai/probe-ideas.ts [model ...]

   Builds a facts table from fixture decisions shaped like the learner's (two
   methods, both sides, a spread of stretch and risk), asks each model for a
   proposal with 3 free slots, and reports latency, how many rules parsed or
   were refused (and why), whether the summary passed the number check, and
   the rules in the rule language. */

import { chat, FreeAiError, GEMMA_4, NEMOTRON_ULTRA } from "@/lib/ai-free/nvidia";
import { describeWhen } from "@/lib/ai-ideas/dsl";
import { factsTable, type FinishedDecision } from "@/lib/ai-ideas/facts";
import { parseProposal, proposalSystem, proposalUser } from "@/lib/ai-ideas/propose";

// 36 fixture decisions over 9 sessions: stretched shorts and paused methods lose more.
const rows: FinishedDecision[] = Array.from({ length: 36 }, (_, i) => {
  const side = i % 3 === 0 ? "LONG" : "SHORT";
  const vwap = ((i * 7) % 11) - 3;
  const paused = i % 4 === 0;
  const net = (side === "SHORT" && vwap > 3 ? -110 : 0) + (paused ? -40 : 0) + ((i * 37) % 5) * 30 - 40;
  return {
    key: `k${i}`, session: `2026-10-${String(5 + Math.floor(i / 4)).padStart(2, "0")}`, net,
    fields: { side, symbol: i % 2 ? "MES" : "MNQ", strategy: i % 5 ? "rsi-reversion" : "zone-v5", tier: i % 5 ? "B" : "A", paused,
      regime: ["trend-low-vol", "range-low-vol", "range-high-vol", "trend-high-vol"][i % 4], vix_bucket: i % 3 ? "low" : "high",
      rr: i % 6 ? 1.5 : 2, vwap_atr: vwap, risk_usd: 60 + ((i * 13) % 90), hour_ny: 3 + (i % 12), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri"][i % 5] },
  };
});

async function main() {
  const facts = factsTable(rows);
  const models = process.argv.slice(2).length ? process.argv.slice(2) : [NEMOTRON_ULTRA, GEMMA_4];
  for (const model of models) {
    const t0 = Date.now();
    try {
      const r = await chat({ system: proposalSystem(3), user: proposalUser(facts, [], 3), models: [model], maxTokens: 2500, temperature: 0.4, timeoutMs: 90_000 });
      const p = parseProposal(r.text, facts, 3, new Set());
      console.log(`${model}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${p.rules.length} rule(s) kept, refused: ${JSON.stringify(p.rejected.map((x) => x.reason))}, summary ${p.summaryReject ? `REJECTED (${p.summaryReject})` : "ACCEPTED"}`);
      console.log(`   summary: ${p.summary ?? "(none)"}`);
      for (const rule of p.rules) console.log(`   rule: ${rule.name} | skip when ${describeWhen(rule.when)} | ${rule.why}`);
    } catch (err) {
      const attempts = (err as { attempts?: unknown }).attempts;
      console.log(`${model}: ${((Date.now() - t0) / 1000).toFixed(1)}s FAILED ${err instanceof FreeAiError ? err.code : "error"} ${JSON.stringify(attempts ?? [])}`);
    }
  }
}
void main();
