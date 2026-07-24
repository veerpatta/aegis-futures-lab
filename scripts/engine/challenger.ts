/* Ring 2 — the bot proposes its own upgrades as PRs. Weekly, it re-runs the
   honest tune search (train / held-out month / Monte-Carlo gate, via
   tune-core.ts) and the shadow promotion checklist, and records the result in
   challenger_history. When the SAME challenger survives two consecutive weeks
   — or a shadow stream passes the checklist two weeks running — it opens a PR
   editing the bot-editable blocks in tiers.ts (CHALLENGER_OVERRIDES /
   PROMOTED_SHADOWS), with the full evidence in the body.

   It never merges, never pushes to main, never re-proposes the same set within
   4 weeks, and never opens more than one bot PR per stream. A human merge is
   the only thing that changes live paper params. Paper only, delayed data.

   Run: npx tsx scripts/engine/challenger.ts   (needs GH_TOKEN to open PRs) */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { FeedSymbol } from "@/lib/market/contracts";
import type { Bar } from "@/lib/types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { nyMeta } from "@/lib/time/ny";
import { promotionReport, type ShadowLike } from "./promotion";
import { tierStreams } from "./tiers";
import { challengerFor, loadSeries, streamTuneKey, type ChallengerVerdict } from "./tune-core";
import { fetchAllRows } from "./paginate";

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

const REPO = process.env.GITHUB_REPOSITORY || "veerpatta/aegis-futures-lab";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const COOLDOWN_WEEKS = 4;

/* NY ISO week label 'YYYY-Www', and the label N weeks earlier. */
function isoWeek(sec: number): string {
  const dk = nyMeta(sec).dateKey;
  const [y, m, d] = dk.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt.getTime() - firstThu.getTime()) / 86400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const weeksAgo = (sec: number, n: number) => isoWeek(sec - n * 7 * 86400);

const canonical = (p: unknown): string =>
  JSON.stringify(p, Object.keys((p as object) ?? {}).sort());
const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const money = (v: number | null) => (v === null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0)}`);
const pf = (v: number | null) => (v === null ? "—" : v.toFixed(2));

interface HistoryRow {
  week_key: string;
  stream: string;
  params: unknown;
  oos_pf: number | null;
  oos_net: number | null;
  mc_p95_dd: number | null;
  verdict: string;
}

async function recordHistory(row: HistoryRow) {
  const { error } = await supabase.from("challenger_history").upsert(row, { onConflict: "week_key,stream,verdict" });
  if (error) throw new Error(`challenger_history upsert: ${error.message}`);
}

async function priorRows(stream: string, weekKeys: string[]): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from("challenger_history")
    .select("week_key, stream, params, oos_pf, oos_net, mc_p95_dd, verdict")
    .eq("stream", stream)
    .in("week_key", weekKeys);
  if (error) throw new Error(`challenger_history read: ${error.message}`);
  return (data ?? []) as HistoryRow[];
}

/* ── GitHub / git helpers (best effort; only in CI with a token) ── */
function gh(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf8", env: { ...process.env, GH_TOKEN } }).trim();
}
function openBotPrExists(streamSlug: string): boolean {
  try {
    const out = gh(`pr list --repo ${REPO} --state open --json headRefName --limit 100`);
    const heads = (JSON.parse(out) as { headRefName: string }[]).map((p) => p.headRefName);
    return heads.some((h) => h.startsWith(`bot/challenger-${streamSlug}-`) || h.startsWith(`bot/promote-${streamSlug}-`));
  } catch (e) {
    console.error(`gh pr list failed (assuming a PR exists, to be safe): ${e instanceof Error ? e.message : e}`);
    return true; // fail closed — do not open a duplicate
  }
}

/* GitHub suppresses `pull_request` workflow triggers for PRs created with
   GITHUB_TOKEN, so ci.yml never fires on a bot PR. We therefore run the guard
   HERE, inside the proposing workflow, against the challenger branch: full
   tsc + test suite, a machine-set commit status, a PR comment, and the PR is
   left as a DRAFT if anything is red — so a human never sees a bot PR without a
   visible pass/fail. */
function runBotCi(branch: string): boolean {
  const sha = execSync(`git rev-parse HEAD`, { encoding: "utf8" }).trim();
  let pass = true;
  try {
    execSync(`npx tsc --noEmit`, { stdio: "pipe" });
    execSync(`npm test`, { stdio: "pipe" });
  } catch {
    pass = false;
  }
  try {
    gh(
      `api repos/${REPO}/statuses/${sha} -f state=${pass ? "success" : "failure"} ` +
        `-f context=bot-ci -f description=${JSON.stringify(pass ? "parity + full test suite green" : "tests failed — PR left as draft")}`
    );
    gh(
      `pr comment ${branch} --repo ${REPO} --body ${JSON.stringify(
        `CI ran inside the proposing workflow: **${pass ? "PASS" : "FAIL"}** (tsc + full test suite) on \`${sha.slice(0, 7)}\`. See the commit status.${pass ? "" : " Converted to draft until green."}`
      )}`
    );
    if (!pass) gh(`pr ready ${branch} --repo ${REPO} --undo`); // convert to draft
  } catch (e) {
    console.error(`bot CI status/comment failed: ${e instanceof Error ? e.message : e}`);
  }
  return pass;
}

function openPr(args: { branch: string; edit: () => void; title: string; body: string; commitMsg: string }): boolean {
  try {
    execSync(`git checkout -b ${args.branch}`, { stdio: "pipe" });
    args.edit();
    execSync(`git add scripts/engine/tiers.ts`, { stdio: "pipe" });
    execSync(`git -c user.name="aegis-bot" -c user.email="bot@aegis" commit -m ${JSON.stringify(args.commitMsg)}`, { stdio: "pipe" });
    execSync(`git push -u origin ${args.branch}`, { stdio: "pipe" });
    const bodyFile = join(tmpdir(), `pr-body-${args.branch.replace(/\//g, "_")}.md`);
    writeFileSync(bodyFile, args.body);
    gh(`pr create --repo ${REPO} --base main --head ${args.branch} --title ${JSON.stringify(args.title)} --body-file ${JSON.stringify(bodyFile)}`);
    const ciPass = runBotCi(args.branch);
    console.log(`opened PR on ${args.branch} (bot CI ${ciPass ? "green" : "RED — draft"})`);
    return true;
  } catch (e) {
    console.error(`PR open failed for ${args.branch}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

const TIERS_PATH = "scripts/engine/tiers.ts";

/* Edit tiers.ts's bot-editable blocks. Only the empty-default form is edited
   automatically; a non-empty block means a prior proposal is unmerged, so we
   bail and let the human handle it. */
function editOverrides(key: string, params: Record<string, unknown>): void {
  const src = readFileSync(TIERS_PATH, "utf8");
  const marker = "export const CHALLENGER_OVERRIDES: Record<string, Partial<ParamValues>> = {};";
  if (!src.includes(marker)) throw new Error("CHALLENGER_OVERRIDES not in default empty state — manual edit needed");
  writeFileSync(
    TIERS_PATH,
    src.replace(marker, `export const CHALLENGER_OVERRIDES: Record<string, Partial<ParamValues>> = ${JSON.stringify({ [key]: params })};`)
  );
}
function editPromotion(label: string, strategyId: string, symbols: string[]): void {
  const src = readFileSync(TIERS_PATH, "utf8");
  const marker = 'export const PROMOTED_SHADOWS: { label: string; strategyId: string; symbols: ("MES" | "MNQ")[] }[] = [];';
  if (!src.includes(marker)) throw new Error("PROMOTED_SHADOWS not in default empty state — manual edit needed");
  const entry = `[{ label: ${JSON.stringify(label)}, strategyId: ${JSON.stringify(strategyId)}, symbols: ${JSON.stringify(symbols)} }]`;
  writeFileSync(TIERS_PATH, src.replace(marker, marker.replace("[];", `${entry};`)));
}

const REVIEW_LINE = (kind: string) =>
  `Merging this changes live paper params. Close to reject; the bot will not re-propose this exact ${kind} for ${COOLDOWN_WEEKS} weeks.\n\n_CI (tsc + full parity/test suite) ran inside the proposing workflow — see the \`bot-ci\` commit status on this branch. A red run leaves this PR as a draft._`;

async function main() {
  const nowSec = Math.floor(Date.now() / 1000);
  const weekKey = isoWeek(nowSec);
  const lastWeek = weeksAgo(nowSec, 1);
  const canPr = Boolean(GH_TOKEN && process.env.GITHUB_ACTIONS);
  console.log(`challenger week ${weekKey} (prior ${lastWeek}) · ${canPr ? "PR-capable" : "analysis only (no token)"}`);

  const streams = tierStreams();
  const symbols = [...new Set(streams.flatMap((s) => s.symbols))] as FeedSymbol[];
  const bySymbol: Record<string, Bar[]> = {};
  for (const s of symbols) bySymbol[s] = await loadSeries(supabase, s);

  let proposals = 0;

  // ── Param challengers ──
  for (const stream of streams) {
    const key = streamTuneKey(stream);
    let v: ChallengerVerdict;
    try {
      v = challengerFor(stream, bySymbol);
    } catch (e) {
      console.error(`challengerFor ${key} failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    await recordHistory({
      week_key: weekKey,
      stream: key,
      params: v.params,
      oos_pf: v.oosPf,
      oos_net: v.oosNet,
      mc_p95_dd: v.mcP95Dd,
      verdict: v.verdict,
    });
    console.log(`  ${key}: ${v.verdict}${v.label ? ` (${v.label})` : ""} — ${v.reason}`);
    if (v.verdict !== "challenger" || !v.params) continue;

    // Confirmed only if last week proposed the SAME param set.
    const prev = (await priorRows(key, [lastWeek])).find((r) => r.verdict === "challenger");
    if (!prev || canonical(prev.params) !== canonical(v.params)) {
      console.log(`    not confirmed yet — needs the same set two weeks running.`);
      continue;
    }
    // Cooldown: not proposed in the last COOLDOWN_WEEKS weeks.
    const cooldownWeeks = Array.from({ length: COOLDOWN_WEEKS }, (_, i) => weeksAgo(nowSec, i + 1));
    const proposedRecently = (await priorRows(key, cooldownWeeks)).some(
      (r) => r.verdict === "proposed" && canonical(r.params) === canonical(v.params)
    );
    if (proposedRecently) {
      console.log(`    in cooldown — proposed within ${COOLDOWN_WEEKS} weeks.`);
      continue;
    }

    const streamSlug = slug(key);
    if (canPr && openBotPrExists(streamSlug)) {
      console.log(`    a bot PR for ${key} is already open — skipping.`);
      continue;
    }

    const p = v.params as Record<string, unknown>;
    const ovKey = stream.tier === "A" ? "A" : `B:${stream.symbols.join("+")}`;
    const body = [
      `**The bot is proposing a parameter change to ${key}.** Paper only, delayed data.`,
      ``,
      `Survived the held-out month + Monte-Carlo gate **two weeks running** (${lastWeek}, ${weekKey}).`,
      ``,
      `| Metric | Incumbent (OOS) | Challenger \`${v.label}\` (OOS) |`,
      `|---|---:|---:|`,
      `| Profit factor | ${pf(v.incumbentOosPf)} | ${pf(v.oosPf)} |`,
      `| Net | ${money(v.incumbentOosNet)} | ${money(v.oosNet)} |`,
      `| Monte-Carlo p95 drawdown | — | ${money(v.mcP95Dd)} |`,
      ``,
      `Proposed override: \`CHALLENGER_OVERRIDES["${ovKey}"] = ${JSON.stringify({ oversold: p.oversold, overbought: p.overbought, targetR: p.targetR })}\``,
      ``,
      REVIEW_LINE("set"),
    ].join("\n");

    if (canPr) {
      const ok = openPr({
        branch: `bot/challenger-${streamSlug}-${weekKey}`,
        edit: () => editOverrides(ovKey, { oversold: p.oversold, overbought: p.overbought, targetR: p.targetR }),
        title: `Bot challenger: ${key} → ${v.label}`,
        body,
        commitMsg: `Bot challenger for ${key}: adopt ${v.label}\n\nSurvived OOS + Monte Carlo two weeks running (${lastWeek}, ${weekKey}).`,
      });
      if (ok) {
        await recordHistory({ week_key: weekKey, stream: key, params: v.params, oos_pf: v.oosPf, oos_net: v.oosNet, mc_p95_dd: v.mcP95Dd, verdict: "proposed" });
        proposals++;
      }
      execSync(`git checkout main`, { stdio: "pipe" }); // back to main for the next stream
    } else {
      console.log(`    WOULD open a PR (no token in this environment).`);
    }
  }

  // ── Shadow promotions ──
  try {
    // Full history — the promotion checklist needs every closed shadow signal.
    const rows = await fetchAllRows<ShadowLike & { strategy: string; symbol: string }>(
      supabase,
      "shadow_signals",
      "strategy, symbol, status, pnl_usd, regime, fill_confidence"
    );
    const keys = [...new Set(rows.map((r) => `${r.strategy}|${r.symbol}`))].sort();
    for (const k of keys) {
      const [strategy, symbol] = k.split("|");
      const report = promotionReport(rows.filter((r) => r.strategy === strategy && r.symbol === symbol));
      const stream = `shadow:${strategy}:${symbol}`;
      const verdict = report.promotable ? "challenger" : "none";
      await recordHistory({
        week_key: weekKey,
        stream,
        params: { strategyId: strategy, symbols: [symbol] },
        oos_pf: report.pf,
        oos_net: Math.round(report.net),
        mc_p95_dd: null,
        verdict,
      });
      if (!report.promotable) continue;
      const prev = (await priorRows(stream, [lastWeek])).find((r) => r.verdict === "challenger");
      if (!prev) {
        console.log(`  ${stream}: promotable — needs two weeks running.`);
        continue;
      }
      const cooldownWeeks = Array.from({ length: COOLDOWN_WEEKS }, (_, i) => weeksAgo(nowSec, i + 1));
      if ((await priorRows(stream, cooldownWeeks)).some((r) => r.verdict === "proposed")) {
        console.log(`  ${stream}: in cooldown.`);
        continue;
      }
      const streamSlug = slug(stream);
      if (canPr && openBotPrExists(streamSlug)) {
        console.log(`  ${stream}: a bot PR is already open — skipping.`);
        continue;
      }
      const body = [
        `**The bot is proposing to promote a shadow strategy to a live tier-B2 stream: ${strategy} / ${symbol}.** Paper only.`,
        ``,
        `Passed the promotion checklist **two weeks running** (${lastWeek}, ${weekKey}): ≥60 closed, PF ≥ 1.2 (costs in), positive in ≥2 regimes.`,
        ``,
        `| Closed | PF | Net | Regimes positive |`,
        `|---:|---:|---:|---:|`,
        `| ${report.closed} | ${pf(report.pf)} | ${money(Math.round(report.net))} | ${report.regimesPositive}/${report.regimesWithData} |`,
        ``,
        `Adds \`PROMOTED_SHADOWS\` entry \`{ label: "${strategy}", strategyId: "${strategy}", symbols: ["${symbol}"] }\` with the standard tier-B locks.`,
        ``,
        REVIEW_LINE("promotion"),
      ].join("\n");
      if (canPr) {
        const ok = openPr({
          branch: `bot/promote-${streamSlug}-${weekKey}`,
          edit: () => editPromotion(strategy, strategy, [symbol]),
          title: `Bot promotion: ${strategy} / ${symbol} → tier B2`,
          body,
          commitMsg: `Bot promotion: ${strategy}/${symbol} to tier B2\n\nChecklist passed two weeks running (${lastWeek}, ${weekKey}).`,
        });
        if (ok) {
          await recordHistory({ week_key: weekKey, stream, params: { strategyId: strategy, symbols: [symbol] }, oos_pf: report.pf, oos_net: Math.round(report.net), mc_p95_dd: null, verdict: "proposed" });
          proposals++;
        }
        execSync(`git checkout main`, { stdio: "pipe" });
      } else console.log(`  ${stream}: WOULD open a promotion PR (no token).`);
    }
  } catch (e) {
    console.error(`shadow promotion scan failed: ${e instanceof Error ? e.message : e}`);
  }

  console.log(proposals ? `opened ${proposals} PR(s).` : `no challenger survives yet — nothing to propose.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
