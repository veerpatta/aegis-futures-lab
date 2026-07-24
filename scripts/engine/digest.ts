/* Weekly digest — Saturday-morning report of the trailing 7 days, sent to
   Telegram (compact, phone-first) and posted as a GitHub issue (full
   markdown, label `digest`; the previous week's digest issue is closed).
   Run by .github/workflows/weekly-digest.yml; also fine locally:
   npx tsx scripts/engine/digest.ts (skips GitHub without GITHUB_TOKEN,
   skips Telegram without the bot secrets).

   A zero-signal week still reports — silence must be distinguishable from
   breakage — and a data-integrity section scans bars_5m for session gaps,
   duplicates and zero/negative-range bars. Paper only, delayed data. */

import { createClient } from "@supabase/supabase-js";
import { inNySession, nyMeta } from "@/lib/time/ny";
import { earlyCloseMinuteNy, isMarketHoliday } from "@/lib/market/holidays";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { fmtPf } from "@/lib/stats";
import { sendTelegram } from "./notify";
import { fetchAllRows } from "./paginate";
import { activeOnly, exDoubtful, pausedPractice, stats } from "./digest-stats";
import { promotionReport, type ShadowLike } from "./promotion";

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

const REPO = process.env.GITHUB_REPOSITORY || "veerpatta/aegis-futures-lab";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const PAGE = 1000;

interface SignalRow {
  tier: "A" | "B";
  symbol: string;
  status: string;
  pnl_usd: number | null;
  regime: string | null;
  fill_confidence: string | null;
  vix_bucket: string | null;
  model_veto: boolean | null;
  suppressed: boolean | null;
  signal_ts: string;
}

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0)}`;

/* ── "What I learned this week" ────────────────────────────────────────────
   Diff the latest condition_ledger against the snapshot ~7 days prior and
   surface only cells that crossed a significance-ish threshold: the latest
   cell has n ≥ 10 AND (profit factor moved > 0.2 OR win rate moved > 10pts).
   A cell that only just reached n ≥ 10 (prior was thin/absent) counts as a
   new lesson too. Everything degrades to "still collecting" — a missing
   learned_stats table or no prior snapshot is not an error. */
interface LedgerCell {
  n: number;
  pf: number | null;
  winRate: number | null;
}
type LedgerGroup = Record<string, LedgerCell>;
interface LedgerPayload {
  tierRegime?: LedgerGroup;
  tierVix?: LedgerGroup;
  dayOfWeek?: LedgerGroup;
  entryHour?: LedgerGroup;
}
const LEDGER_GROUPS: { key: keyof LedgerPayload; label: string }[] = [
  { key: "tierRegime", label: "regime" },
  { key: "tierVix", label: "VIX" },
  { key: "dayOfWeek", label: "weekday" },
  { key: "entryHour", label: "hour" },
];

async function weeklyLessons(): Promise<string[]> {
  let rows: { date_key: string; payload: LedgerPayload }[];
  try {
    const { data, error } = await supabase
      .from("learned_stats")
      .select("date_key, payload")
      .eq("stat_key", "condition_ledger")
      .order("date_key", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as { date_key: string; payload: LedgerPayload }[];
  } catch {
    return ["No new lessons this week — the nightly knowledge job has not populated its tables yet."];
  }
  if (rows.length < 2) return ["No new lessons this week — still collecting (need a prior week to compare)."];

  const latest = rows[0];
  const [ly, lm, ld] = latest.date_key.split("-").map(Number);
  const cutoff = Date.UTC(ly, lm - 1, ld) - 7 * 86400_000;
  const prior = rows.find((r) => {
    const [y, m, d] = r.date_key.split("-").map(Number);
    return Date.UTC(y, m - 1, d) <= cutoff;
  });
  if (!prior) return ["No new lessons this week — still collecting (no snapshot from ~7 days ago yet)."];

  const out: string[] = [];
  for (const { key, label } of LEDGER_GROUPS) {
    const now = latest.payload[key] ?? {};
    const then = prior.payload[key] ?? {};
    for (const [bucket, cell] of Object.entries(now)) {
      if (cell.n < 10) continue;
      const before = then[bucket];
      const pfNow = cell.pf ?? null;
      if (!before || before.n < 10) {
        out.push(`${label} · ${bucket}: now enough data (n=${cell.n}) — PF ${fmtPf(pfNow)}, WR ${cell.winRate ?? "—"}%`);
        continue;
      }
      const dPf = pfNow !== null && before.pf !== null ? pfNow - before.pf : null;
      const dWr = cell.winRate !== null && before.winRate !== null ? cell.winRate - before.winRate : null;
      if ((dPf !== null && Math.abs(dPf) > 0.2) || (dWr !== null && Math.abs(dWr) > 10))
        out.push(
          `${label} · ${bucket}: PF ${fmtPf(before.pf)} → ${fmtPf(pfNow)}, WR ${before.winRate ?? "—"}% → ${cell.winRate ?? "—"}% (n ${before.n}→${cell.n})`
        );
    }
  }
  return out.length ? out : ["No new lessons this week — still collecting (no cell crossed the threshold)."];
}

async function weekBars(symbol: string, fromSec: number) {
  const out: { time: number; high: number; low: number }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, high, low")
      .eq("symbol", symbol)
      .gte("time", fromSec)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m read: ${error.message}`);
    for (const r of data ?? [])
      out.push({ time: Number(r.time), high: Number(r.high), low: Number(r.low) });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/* Session gaps: consecutive archived bars more than 15 min apart, both
   inside the NY session on the same non-holiday day (early-close days only
   count up to the halt). */
function integrityScan(bars: { time: number; high: number; low: number }[]) {
  let gaps = 0;
  let dupes = 0;
  let zeroRange = 0;
  let negativeRange = 0;
  const inScannableSession = (t: number) => {
    if (!inNySession(t)) return false;
    const m = nyMeta(t);
    if (isMarketHoliday(m.dateKey)) return false;
    const early = earlyCloseMinuteNy(m.dateKey);
    return early === null || m.minutes < early;
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.high < b.low) negativeRange++;
    else if (b.high === b.low) zeroRange++;
    const prev = bars[i - 1];
    if (!prev) continue;
    if (prev.time === b.time) dupes++;
    else if (
      b.time - prev.time > 900 &&
      inScannableSession(prev.time) &&
      inScannableSession(b.time) &&
      nyMeta(prev.time).dateKey === nyMeta(b.time).dateKey
    )
      gaps++;
  }
  return { gaps, dupes, zeroRange, negativeRange };
}

async function gh(method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "aegis-digest",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && res.status !== 422)
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => null);
}

async function main() {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - 7 * 86400;
  const fromIso = new Date(fromSec * 1000).toISOString();
  const weekEnding = nyMeta(nowSec).dateKey;

  // ── Signals ──
  const { data: sigData, error: sigErr } = await supabase
    .from("signals")
    .select("tier, symbol, status, pnl_usd, regime, fill_confidence, vix_bucket, model_veto, suppressed, signal_ts")
    .gte("signal_ts", fromIso)
    .order("signal_ts", { ascending: true });
  if (sigErr) throw new Error(`signals read: ${sigErr.message}`);
  const signals = (sigData ?? []) as SignalRow[];
  // Headline stats exclude breaker-suppressed rows (consistent with Home and
  // the Signals page); the benched streams' practice is reported separately.
  const active = activeOnly(signals);
  const practice = pausedPractice(signals);

  const all = stats(active);
  const ex = stats(exDoubtful(active));
  const tierA = stats(active.filter((s) => s.tier === "A"));
  const tierB = stats(active.filter((s) => s.tier === "B"));
  const tierAEx = stats(exDoubtful(active.filter((s) => s.tier === "A")));
  const tierBEx = stats(exDoubtful(active.filter((s) => s.tier === "B")));

  const byStatus = new Map<string, number>();
  for (const s of active) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  const statusLine =
    [...byStatus.entries()].map(([k, n]) => `${n} ${k}`).join(" · ") || "none";

  const regimes = new Map<string, { n: number; net: number }>();
  for (const s of active) {
    const key = s.regime ?? "untagged";
    const r = regimes.get(key) ?? { n: 0, net: 0 };
    r.n++;
    r.net += s.pnl_usd ?? 0;
    regimes.set(key, r);
  }
  const doubtfulCount = active.filter((s) => s.fill_confidence === "doubtful").length;
  const marginalCount = active.filter((s) => s.fill_confidence === "marginal").length;

  // VIX-bucket split — only judged once both buckets have ≥10 signals.
  const vixLow = stats(active.filter((s) => s.vix_bucket === "low"));
  const vixHigh = stats(active.filter((s) => s.vix_bucket === "high"));
  const vixReady = vixLow.total >= 10 && vixHigh.total >= 10;
  const vixLine = vixReady
    ? `VIX split: low ${vixLow.total} (net ${money(vixLow.net)}, PF ${fmtPf(vixLow.pf)}) · high ${vixHigh.total} (net ${money(vixHigh.net)}, PF ${fmtPf(vixHigh.pf)})`
    : `VIX split: collecting (low ${vixLow.total} / high ${vixHigh.total} — judged at ≥10 each)`;

  // ── Engine health ──
  const { data: runData, error: runErr } = await supabase
    .from("engine_runs")
    .select("status, message, ran_at")
    .gte("ran_at", fromIso);
  if (runErr) throw new Error(`engine_runs read: ${runErr.message}`);
  const runs = runData ?? [];
  const errorRuns = runs.filter((r) => r.status === "error");
  let worstAge = 0;
  for (const r of runs) {
    const m = /age MES (\d+)m \/ MNQ (\d+)m/.exec(r.message ?? "");
    if (m) worstAge = Math.max(worstAge, Number(m[1]), Number(m[2]));
  }

  // ── Archive growth + integrity ──
  const integrity: Record<string, ReturnType<typeof integrityScan>> = {};
  let weekRows = 0;
  let spanDays = 0;
  for (const symbol of ["MES", "MNQ"]) {
    const bars = await weekBars(symbol, fromSec);
    weekRows += bars.length;
    integrity[symbol] = integrityScan(bars);
    const { data: first } = await supabase
      .from("bars_5m")
      .select("time")
      .eq("symbol", symbol)
      .order("time", { ascending: true })
      .limit(1);
    if (first?.length)
      spanDays = Math.max(spanDays, Math.round((nowSec - Number(first[0].time)) / 86400));
  }
  const integrityTotal = Object.values(integrity).reduce(
    (a, v) => ({
      gaps: a.gaps + v.gaps,
      dupes: a.dupes + v.dupes,
      zeroRange: a.zeroRange + v.zeroRange,
      negativeRange: a.negativeRange + v.negativeRange,
    }),
    { gaps: 0, dupes: 0, zeroRange: 0, negativeRange: 0 }
  );
  const integrityBad =
    integrityTotal.gaps + integrityTotal.dupes + integrityTotal.negativeRange > 0;

  // ── Shadow auditions (all-time — the whole point is the growing sample) ──
  interface ShadowDbRow extends ShadowLike {
    strategy: string;
    symbol: string;
  }
  let shadowRows: ShadowDbRow[] = [];
  try {
    // Full history (paginated) — the scoreboard is the whole growing sample.
    shadowRows = await fetchAllRows<ShadowDbRow>(
      supabase,
      "shadow_signals",
      "strategy, symbol, status, pnl_usd, regime, fill_confidence"
    );
  } catch (e) {
    console.error(`shadow read failed (section skipped): ${e instanceof Error ? e.message : e}`);
  }
  const shadowStreams = [...new Set(shadowRows.map((r) => `${r.strategy}|${r.symbol}`))]
    .sort()
    .map((key) => {
      const [strategy, symbol] = key.split("|");
      return {
        strategy,
        symbol,
        report: promotionReport(shadowRows.filter((r) => r.strategy === strategy && r.symbol === symbol)),
      };
    });

  // ── Watchdog issues opened this week (best effort) ──
  let watchdogOpened: number | null = null;
  if (GH_TOKEN) {
    try {
      const issues = await gh(
        "GET",
        `/repos/${REPO}/issues?labels=watchdog&state=all&since=${encodeURIComponent(fromIso)}&per_page=50`
      );
      watchdogOpened = Array.isArray(issues)
        ? issues.filter((i) => i.created_at >= fromIso).length
        : null;
    } catch (e) {
      console.error(`watchdog issue count failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── What I learned this week (Ring 0 diff) ──
  const lessons = await weeklyLessons();

  // ── Win-probability model (Ring 1b): status + how its vetoes would have done ──
  let modelLine = "Win-prob model: not trained yet.";
  try {
    const { data: reg } = await supabase
      .from("model_registry")
      .select("status, train_n, oos_brier, baseline_brier")
      .order("trained_at", { ascending: false })
      .limit(1);
    const m = reg?.[0] as
      | { status: string; train_n: number | null; oos_brier: number | null; baseline_brier: number | null }
      | undefined;
    if (m) {
      const vetoed = signals.filter((s) => s.model_veto);
      const vc = vetoed.filter((s) => s.pnl_usd !== null);
      const w = vc.filter((s) => (s.pnl_usd ?? 0) > 0).length;
      const l = vc.length - w;
      const net = vc.reduce((a, s) => a + (s.pnl_usd ?? 0), 0);
      const ghost = m.status !== "active";
      modelLine =
        `Win-prob model: <b>${m.status}</b> (${m.train_n ?? 0} clean examples, OOS Brier ${m.oos_brier ?? "—"} vs baseline ${m.baseline_brier ?? "—"}). ` +
        (vetoed.length === 0
          ? `${ghost ? "Would have vetoed" : "Vetoed"} 0 signals this week.`
          : `${ghost ? "Would have vetoed" : "Vetoed"} ${vetoed.length} this week; those closed ${w}-${l} for ${money(net)}` +
            (ghost ? " — a losing net there means the vetoes would have helped." : "."));
    }
  } catch {
    /* model_registry absent — section stays as "not trained yet" */
  }

  // ── Open bot PRs (Ring 2) ──
  let botPrs: { number: number; title: string; html_url: string }[] = [];
  if (GH_TOKEN) {
    try {
      const pulls = await gh("GET", `/repos/${REPO}/pulls?state=open&per_page=50`);
      if (Array.isArray(pulls))
        botPrs = pulls
          .filter((p) => {
            const ref = p?.head?.ref;
            return typeof ref === "string" && (ref.startsWith("bot/challenger-") || ref.startsWith("bot/promote-"));
          })
          .map((p) => ({ number: p.number, title: p.title, html_url: p.html_url }));
    } catch (e) {
      console.error(`bot PR list failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const statLine = (label: string, s: ReturnType<typeof stats>) =>
    `${label}: ${s.total} signals · ${s.closed} closed · net ${money(s.net)} · PF ${fmtPf(s.pf)}${
      s.winRate === null ? "" : ` · WR ${s.winRate}%`
    }`;

  // ── Telegram (compact) ──
  const tg = [
    `<b>Aegis weekly digest</b> — week ending ${weekEnding}`,
    `paper only · delayed data · never orders`,
    all.total === 0
      ? `No signals this week — quiet market, not a breakage (engine health below).`
      : `Net ${money(all.net)} · PF ${fmtPf(all.pf)}${all.winRate === null ? "" : ` · WR ${all.winRate}%`} (${all.closed} closed of ${all.total})`,
    ...(all.total
      ? [
          `excluding ${doubtfulCount} doubtful fills: net ${money(ex.net)} · PF ${fmtPf(ex.pf)}`,
          `Tier A ${tierA.total} (net ${money(tierA.net)}) · Tier B ${tierB.total} (net ${money(tierB.net)})`,
          `Regimes: ${[...regimes.entries()].map(([k, v]) => `${k} ${v.n} (${money(v.net)})`).join(" · ") || "—"}`,
          vixLine,
        ]
      : []),
    ...(practice.total ? [`Paused-stream practice (not counted above): ${practice.total} signals, ${practice.closed} closed, net ${money(practice.net)}`] : []),
    `Health: ${runs.length} runs, ${errorRuns.length} error${errorRuns.length === 1 ? "" : "s"}, worst bar age ${worstAge}m` +
      (watchdogOpened !== null ? `, ${watchdogOpened} watchdog alert${watchdogOpened === 1 ? "" : "s"}` : ""),
    `Archive: +${weekRows.toLocaleString()} bars this week · span ${spanDays}d · integrity ${
      integrityBad
        ? `⚠ ${integrityTotal.gaps} gaps / ${integrityTotal.dupes} dupes / ${integrityTotal.negativeRange} bad bars`
        : "OK"
    }`,
    ...(shadowStreams.length
      ? [
          `Shadow auditions (not signals): ${shadowStreams
            .map(
              (s) =>
                `${s.strategy}/${s.symbol} ${s.report.closed}cl PF ${fmtPf(s.report.pf)} ${money(s.report.net)}${s.report.promotable ? " ✅" : ""}`
            )
            .join(" · ")}`,
        ]
      : []),
    `Learned: ${lessons.length === 1 ? lessons[0] : `${lessons.length} new lessons this week (see digest issue)`}`,
    modelLine,
    ...(botPrs.length ? [`🤖 Bot is proposing ${botPrs.length} upgrade PR${botPrs.length === 1 ? "" : "s"} — review on GitHub.`] : []),
  ].join("\n");
  await sendTelegram(tg);

  // ── GitHub issue (full markdown) ──
  const md = [
    `Trailing 7 days ending **${weekEnding}** (NY). Paper only, delayed data — never orders.`,
    ``,
    `## Signals`,
    all.total === 0
      ? `**No signals this week.** That is a quiet market, not a breakage — engine health below.`
      : [
          `| Scope | Signals | Closed | Net | PF | Win rate |`,
          `|---|---:|---:|---:|---:|---:|`,
          ...[
            ["All", all],
            ["All — excluding doubtful fills", ex],
            ["Tier A", tierA],
            ["Tier A — ex-doubtful", tierAEx],
            ["Tier B", tierB],
            ["Tier B — ex-doubtful", tierBEx],
          ].map(
            ([label, s]) =>
              `| ${label} | ${(s as ReturnType<typeof stats>).total} | ${(s as ReturnType<typeof stats>).closed} | ${money((s as ReturnType<typeof stats>).net)} | ${fmtPf((s as ReturnType<typeof stats>).pf)} | ${(s as ReturnType<typeof stats>).winRate ?? "—"}${(s as ReturnType<typeof stats>).winRate === null ? "" : "%"} |`
          ),
          ``,
          `Status: ${statusLine}. Fill audit: ${marginalCount} marginal, ${doubtfulCount} doubtful.`,
          ``,
          `### Regimes`,
          `| Regime | Signals | Net |`,
          `|---|---:|---:|`,
          ...[...regimes.entries()].map(([k, v]) => `| ${k} | ${v.n} | ${money(v.net)} |`),
          ``,
          `### VIX bucket (low/high vs trailing 20-day median)`,
          vixLine,
          ``,
          practice.total
            ? `### Paused-stream practice (breaker-benched — excluded from every table above)\n${practice.total} signals · ${practice.closed} closed · net ${money(practice.net)}. These streams keep simulating silently until they earn their spot back.`
            : `_No paused streams this week._`,
        ].join("\n"),
    ``,
    `## Engine health`,
    `- Runs attempted: ${runs.length} (${errorRuns.length} error${errorRuns.length === 1 ? "" : "s"})`,
    `- Worst bar age seen: ${worstAge}m`,
    watchdogOpened !== null ? `- Watchdog issues opened this week: ${watchdogOpened}` : `- Watchdog issues: n/a (no token)`,
    errorRuns.length
      ? `- Error messages:\n${errorRuns.map((r) => `  - \`${(r.message ?? "").slice(0, 160)}\``).join("\n")}`
      : ``,
    ``,
    `## Shadow auditions — strategies auditioning on live data, NOT signals`,
    shadowStreams.length === 0
      ? `No shadow rows yet.`
      : [
          `All-time since audition start. Promotable only when ALL boxes tick: ≥60 closed signals AND PF ≥ 1.2 (costs included) AND positive net in ≥2 regimes with data.`,
          ``,
          `| Stream | Signals | Closed | Net | PF | WR | ex-doubtful | Checklist | Promotable |`,
          `|---|---:|---:|---:|---:|---:|---|---|---|`,
          ...shadowStreams.map(({ strategy, symbol, report: r }) => {
            const checklist = r.checklist.map((c) => `${c.pass ? "✅" : "❌"} ${c.label}`).join("<br>");
            return `| ${strategy} / ${symbol} | ${r.total} | ${r.closed} | ${money(r.net)} | ${fmtPf(r.pf)} | ${r.winRate ?? "—"}${r.winRate === null ? "" : "%"} | PF ${fmtPf(r.exPf)} · ${money(r.exNet)} | ${checklist} | ${r.promotable ? "**YES**" : "no"} |`;
          }),
        ].join("\n"),
    ``,
    `## The bot is proposing`,
    botPrs.length === 0
      ? `No open bot PRs. The weekly challenger runs Sundays; "no challenger survives yet" is the normal outcome.`
      : botPrs.map((p) => `- [#${p.number} ${p.title}](${p.html_url})`).join("\n"),
    `Nothing changes live paper params without a human merge.`,
    ``,
    `## Win-probability model`,
    `${modelLine.replace(/<\/?b>/g, "**")}`,
    `The model can only ever veto the worst signals (bottom decile) and never create a trade; it acts only once it has ≥300 clean-fill examples and beats the base-rate baseline out-of-sample, and demotes itself if it slips.`,
    ``,
    `## What I learned this week`,
    `Changes in the nightly knowledge tables (condition ledger) vs the snapshot ~7 days ago. Only cells with ≥10 closed signals whose profit factor moved >0.2 or win rate moved >10pts are reported.`,
    ``,
    ...lessons.map((l) => `- ${l}`),
    ``,
    `## Bar archive`,
    `- Rows added this week: ${weekRows.toLocaleString()} · total span ≈ ${spanDays} days`,
    ``,
    `## Data integrity (bars_5m, this week, NY sessions, holidays excluded)`,
    `| Symbol | Session gaps >15m | Duplicate stamps | Zero-range bars | Negative-range bars |`,
    `|---|---:|---:|---:|---:|`,
    ...Object.entries(integrity).map(
      ([s, v]) => `| ${s} | ${v.gaps} | ${v.dupes} | ${v.zeroRange} | ${v.negativeRange} |`
    ),
    ``,
    integrityBad
      ? `⚠️ Integrity findings above — labeled \`data-quality\`.`
      : `No integrity findings.`,
  ].join("\n");

  console.log(md);

  if (!GH_TOKEN) {
    console.log("\nGITHUB_TOKEN not set — digest issue skipped (printed above).");
    return;
  }
  // Rotate: close last week's digest issue(s), open this week's.
  for (const name of ["digest", "data-quality"])
    await gh("POST", `/repos/${REPO}/labels`, { name, color: name === "digest" ? "0e8a16" : "d93f0b" });
  const open = await gh("GET", `/repos/${REPO}/issues?labels=digest&state=open&per_page=10`);
  const labels = integrityBad ? ["digest", "data-quality"] : ["digest"];
  const created = await gh("POST", `/repos/${REPO}/issues`, {
    title: `Weekly digest ${weekEnding}`,
    body: md,
    labels,
  });
  console.log(`opened digest issue #${created?.number}`);
  if (Array.isArray(open))
    for (const issue of open) {
      await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, {
        body: `Superseded by #${created?.number}.`,
      });
      await gh("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed" });
      console.log(`closed previous digest issue #${issue.number}`);
    }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
