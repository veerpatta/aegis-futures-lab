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
import { canonicalParams, confirmsTwoWeeks, replaceDeclaration } from "./challenger-logic";
import { sendTelegram } from "./notify";

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
  /* One row per (week_key, stream) — a rerun replaces the week's verdict in
     place, so the 2-week confirmation can't trust a retracted verdict (F10).

     With one exception, added because autopilot runs this script DAILY: a week
     already marked "proposed" is never downgraded. Without the guard, the day
     after a PR was opened the next run overwrote "proposed" back to
     "challenger", destroying the only record the 4-week cooldown and the
     shadow path read — and openBotPrExists stops braking as soon as autopilot
     squash-merges with --delete-branch. */
  if (row.verdict !== "proposed") {
    const existing = await priorRows(row.stream, [row.week_key]);
    if (existing.some((r) => r.verdict === "proposed")) {
      console.log(`    ${row.stream} ${row.week_key} already recorded as proposed — not downgrading`);
      return;
    }
  }
  const { error } = await supabase.from("challenger_history").upsert(row, { onConflict: "week_key,stream" });
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

/* Branches whose PR could not be opened. Non-empty ⇒ the run failed, however
   healthy the rest of it looked. */
const prFailures: string[] = [];

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
    /* Recorded, not just logged. A swallowed failure here used to be reported
       upstream as "no challenger survives yet — nothing to propose", which is
       the opposite of what happened: a challenger DID survive and we failed to
       ship it. main() now counts these, alerts, and exits non-zero. */
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`PR open FAILED for ${args.branch}: ${msg}`);
    prFailures.push(`${args.branch}: ${msg.slice(0, 200)}`);
    return false;
  } finally {
    /* Always get back to a clean main, whatever happened. `edit()` writes
       tiers.ts before the commit, so a failure between the two leaves the tree
       dirty and a plain `git checkout main` then throws — which used to abort
       the remaining streams outright at one call site and silently abandon the
       whole shadow-promotion scan at the other. */
    try {
      execSync(`git checkout -f main`, { stdio: "pipe" });
      execSync(`git clean -fd -- ${TIERS_PATH}`, { stdio: "pipe" });
    } catch (e) {
      console.error(`could not return to main: ${e instanceof Error ? e.message : e}`);
    }
  }
}

const TIERS_PATH = "scripts/engine/tiers.ts";

/* Edit tiers.ts's bot-editable blocks.

   These used to require the literal EMPTY declaration — `... = {};` and
   `... = [];` — and throw otherwise. That is a time bomb: the moment a bot PR
   merges, the block holds the adopted value, the marker no longer matches, and
   every future proposal throws. `openPr` swallowed the throw, so the run
   printed "no challenger survives yet — nothing to propose" and exited 0.
   Ring 2 would have died silently the first time it succeeded.

   Now the DECLARATION is matched whatever its current value, and replacing a
   non-empty one is allowed and reported. What is still refused is a file whose
   declaration cannot be found at all: that means a human restructured tiers.ts
   and the bot must not guess where the value goes.

   Exported for tests/challenger-edit.test.ts, which pins both against the real
   tiers.ts and against an already-adopted copy of it. */
function editOverrides(key: string, params: Record<string, unknown>): void {
  const src = readFileSync(TIERS_PATH, "utf8");
  writeFileSync(
    TIERS_PATH,
    replaceDeclaration(src, "CHALLENGER_OVERRIDES", JSON.stringify({ [key]: params }))
  );
}
function editPromotion(label: string, strategyId: string, symbols: string[]): void {
  const src = readFileSync(TIERS_PATH, "utf8");
  const entry = `[{ label: ${JSON.stringify(label)}, strategyId: ${JSON.stringify(strategyId)}, symbols: ${JSON.stringify(symbols)} }]`;
  writeFileSync(TIERS_PATH, replaceDeclaration(src, "PROMOTED_SHADOWS", entry));
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

    // Confirmed only if last week's single row is a challenger with the SAME set.
    if (!confirmsTwoWeeks(v.params, await priorRows(key, [lastWeek]))) {
      console.log(`    not confirmed yet — needs the same set two weeks running.`);
      continue;
    }
    /* Cooldown: not proposed in the last COOLDOWN_WEEKS weeks, INCLUDING this
       one. `i + 1` covered weeks 1..4 ago and left week 0 out, so a set
       proposed on Monday could be proposed again on Thursday — and autopilot
       runs this daily. */
    const cooldownWeeks = Array.from({ length: COOLDOWN_WEEKS + 1 }, (_, i) => weeksAgo(nowSec, i));
    const proposedRecently = (await priorRows(key, cooldownWeeks)).some(
      (r) => r.verdict === "proposed" && canonicalParams(r.params) === canonicalParams(v.params)
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
      // openPr's `finally` already returned the tree to a clean main.
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
        `Adds \`PROMOTED_SHADOWS\` entry \`{ label: "${strategy}", strategyId: "${strategy}", symbols: ["${symbol}"] }\` with the standard tier-B locks. On merge, ${strategy}/${symbol} stops auditioning as a shadow (it now runs live), so it is never double-counted.`,
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
      } else console.log(`  ${stream}: WOULD open a promotion PR (no token).`);
    }
  } catch (e) {
    console.error(`shadow promotion scan failed: ${e instanceof Error ? e.message : e}`);
  }

  /* "No challenger survives yet" is the healthy null result — but only when
     nothing tried to ship. A survivor we failed to open a PR for is a FAILURE,
     and reporting it as the null result is what let Ring 2 look alive while it
     was dead. Alert and exit non-zero. */
  if (prFailures.length) {
    const text =
      `⚠️ <b>Challenger</b>: ${prFailures.length} proposal(s) survived the gate but could not be opened as PRs.\n` +
      prFailures.join("\n") +
      `\nRing 2 is not proposing. Paper only.`;
    console.error(`challenger: ${prFailures.length} PR(s) failed to open — ${prFailures.join(" | ")}`);
    try {
      await sendTelegram(text);
    } catch (e) {
      console.error(`telegram failed: ${e instanceof Error ? e.message : e}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(proposals ? `opened ${proposals} PR(s).` : `no challenger survives yet — nothing to propose.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
