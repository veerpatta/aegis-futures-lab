/* Engine watchdog — dead-cron AND silence detector. Runs on its own GitHub
   Actions schedule (.github/workflows/watchdog.yml, twice hourly at :17/:47 —
   offset from the engine's every-15-min cadence) with PLAIN node: no npm
   install, no TypeScript.

   Independent checks, each with its own issue label and lifecycle so one can
   never mask another (training freshness is `watchdog-learning`, and the
   `watchdog-components` check fires when the same best-effort part of a pass —
   research observer, paper broker, orphan sweep, excursion — failed on the two
   newest runs while the heartbeat still said `ok`, and `watchdog-learner`
   fires when the experimental learner's Neon Function stops checking in):

     `watchdog`          the cron is dead — no heartbeat for 45 min inside the
                         run window, or the two newest runs both errored.
     `watchdog-silence`  the cron is FINE but a configured stream has produced
                         zero signals for 10 consecutive trading days (item
                         2.5). Tier A ran silent from go-live without a single
                         alert, because "healthy engine" and "engine producing
                         anything" were never the same question. Holidays and
                         weekends are excluded via the same CME table the app
                         uses.

   The stream list comes from lib/engine/expected-streams.json rather than from
   the database on purpose: a stream that has produced NOTHING has no rows, so
   any DB-derived list is blind to exactly the failure being hunted.
   tests/silence.test.ts pins that file to tiers.ts.

   Reads the latest heartbeats via the Neon Data API with a short-lived
   anonymous token (public SELECT is allowed by design).
   Alerts when the engine should be running (inside the 06:00–21:45 UTC
   Mon–Fri cron window and not a CME full holiday — same table the app uses,
   lib/market/cme-holidays.json) but the newest run is older than 45 minutes,
   or the two newest runs both errored. Alerting = Telegram (best effort)
   + exactly one open GitHub issue labeled `watchdog` (comment if it already
   exists, close it with a "recovered" comment when healthy again).

   Exit code: always 0 — a flaky watchdog that spams red X's gets ignored —
   EXCEPT when an alert was needed and every delivery path failed. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEON_AUTH_URL = process.env.NEON_AUTH_URL ||
  "https://ep-twilight-recipe-b3apaham.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth";
const NEON_DATA_API_URL = process.env.NEON_DATA_API_URL ||
  "https://ep-twilight-recipe-b3apaham.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1";
const STALE_MINUTES = Number(process.env.WATCHDOG_STALE_MINUTES || 45);
const REPO = process.env.GITHUB_REPOSITORY || "veerpatta/aegis-futures-lab";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const LABEL = "watchdog";
const SILENCE_LABEL = "watchdog-silence";
const COMPONENT_LABEL = "watchdog-components";
const LEARNER_LABEL = "watchdog-learner";

/* Copy of COMPONENT_FAILED from lib/engine/markers.ts — this script runs on
   bare node and cannot import TypeScript. tests/component-failures.test.ts
   pins the two equal. */
export const COMPONENT_FAILED = "component_failed";

/* ── Helpers ─────────────────────────────────────────────────────────── */

function nyDateKey(date) {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date);
}

const repoFile = (...parts) =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", ...parts);

function loadClosedHolidays() {
  const raw = JSON.parse(readFileSync(repoFile("lib", "market", "cme-holidays.json"), "utf8"));
  return new Set(raw.holidays.filter((h) => h.kind === "closed").map((h) => h.date));
}

/* The configured streams + the silence threshold. Kept in JSON so this plain-
   node script and tiers.ts can share one source of truth (tests/silence.test.ts
   asserts they agree). */
function loadExpectedStreams() {
  const raw = JSON.parse(readFileSync(repoFile("lib", "engine", "expected-streams.json"), "utf8"));
  return {
    streams: raw.streams,
    silenceTradingDays: Number(process.env.WATCHDOG_SILENCE_DAYS || raw.silenceTradingDays || 10),
    // Per-stream overrides. WATCHDOG_SILENCE_DAYS deliberately does NOT override
    // these: it is the blunt global escape hatch, and letting it flatten a
    // stream-specific threshold would silently undo the reason that stream has
    // one. See the note in expected-streams.json.
    silenceTradingDaysByStream: raw.silenceTradingDaysByStream || {},
  };
}

/* Stream key for a signals row — mirrors streamKeyForRow in
   lib/engine/streams.ts. Tier A is one stream over both symbols; tier B is
   keyed by strategy label AND symbol. Duplicated (not imported) because this
   script must run on plain node with no build step. */
function streamKeyForRow(row) {
  if (row.tier === "A") return "A";
  const label = String(row.dedupe_key ?? "").split(":")[1] ?? "";
  return `B:${label}:${row.symbol}`;
}

/* NY trading days strictly after `from` up to and including `to` — weekends and
   full CME holidays excluded. Mirrors tradingDaysBetween in
   lib/time/trading-days.ts. */
function tradingDaysBetween(from, to, closedHolidays) {
  if (!(to > from)) return 0;
  const toKey = nyDateKey(to);
  const cursor = new Date(Date.UTC(
    Number(nyDateKey(from).slice(0, 4)),
    Number(nyDateKey(from).slice(5, 7)) - 1,
    Number(nyDateKey(from).slice(8, 10))
  ));
  let count = 0;
  for (let i = 0; i < 400; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const key = cursor.toISOString().slice(0, 10);
    // Stop BEFORE counting once the cursor has passed `to`. Counting first and
    // breaking after meant a same-NY-day span counted tomorrow and returned 1
    // instead of 0, so an alert body could report one day more silence than
    // there was.
    if (key > toKey) break;
    const wd = cursor.getUTCDay();
    if (wd !== 0 && wd !== 6 && !closedHolidays.has(key)) count++;
    if (key === toKey) break;
  }
  return count;
}

let anonymousToken;
async function neonGet(path) {
  if (!anonymousToken) {
    const auth = await fetch(`${NEON_AUTH_URL}/token/anonymous`);
    if (!auth.ok) throw new Error(`anonymous token → HTTP ${auth.status}`);
    anonymousToken = (await auth.json()).token;
  }
  const res = await fetch(`${NEON_DATA_API_URL}/${path}`, {
    headers: { Authorization: `Bearer ${anonymousToken}` },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/* Which configured streams have gone quiet for their own threshold or more
   consecutive trading days. A stream that has NEVER produced a signal is timed
   from the engine's FIRST run, not from epoch — otherwise a freshly deployed
   stream would alert on day one.

   `silenceTradingDaysByStream` overrides `silenceTradingDays` per stream, so a
   measurably rare stream gets a threshold matched to its own cadence instead of
   an alert that can never clear. Optional and defaulted: every existing caller
   that passes only the global threshold behaves exactly as before.

   Pure, so it is unit-tested directly. */
export function findSilentStreams({
  expected,
  rows,
  engineFirstRunMs,
  nowMs,
  silenceTradingDays,
  silenceTradingDaysByStream = {},
  closedHolidays,
}) {
  const newest = new Map();
  for (const row of rows) {
    const key = streamKeyForRow(row);
    const ms = Date.parse(row.signal_ts);
    if (!Number.isFinite(ms)) continue;
    if (!newest.has(key) || ms > newest.get(key)) newest.set(key, ms);
  }
  const out = [];
  for (const stream of expected) {
    const lastMs = newest.get(stream) ?? null;
    // No signal ever ⇒ measure from when the engine started running at all.
    const sinceMs = lastMs ?? engineFirstRunMs;
    if (sinceMs === null) continue; // engine has never run — the cron check owns that
    const threshold = Number(silenceTradingDaysByStream[stream] ?? silenceTradingDays);
    const days = tradingDaysBetween(new Date(sinceMs), new Date(nowMs), closedHolidays);
    if (days >= threshold)
      out.push({
        stream,
        days,
        threshold,
        lastSignal: lastMs === null ? null : new Date(lastMs).toISOString(),
        everProduced: lastMs !== null,
      });
  }
  return out;
}

/* Parts of an engine pass that failed on EVERY one of the newest `consecutive`
   runs. The observer, broker, orphan sweep and excursion writer are best
   effort — the run still records `ok` — so their failures only ever showed up
   as text inside a green heartbeat. One bad pass is a blip (a Neon hiccup);
   the same component failing twice in a row is a fault worth a person.

   `runs` is newest first, as the Data API returns it. Errored runs carry no
   component markers, so a dead engine never doubles as a component alert —
   the cron check owns that. Pure, so it is unit-tested directly. */
export function findComponentFailures(runs, consecutive = 2) {
  const recent = runs.slice(0, consecutive);
  if (recent.length < consecutive) return [];
  const pattern = new RegExp(`${COMPONENT_FAILED}\\[([a-z-]+)\\]`, "g");
  const sets = recent.map(
    (r) => new Set([...(r?.message ?? "").matchAll(pattern)].map((m) => m[1]))
  );
  return [...sets[0]].filter((c) => sets.every((s) => s.has(c)));
}

/* The engine's cron window as a pure predicate — the whole Globex week: every
   15 minutes at every hour Mon-Fri UTC, plus every 15 minutes at hours 22-23
   on Sunday, which is the Globex reopen.

   The Sunday block spans both DST regimes (Globex reopens 18:00 ET = 22:00 UTC
   in EDT, 23:00 UTC in EST), and Saturday is empty because the market is shut
   for all of Saturday UTC either way.

   DUPLICATED from engineScheduled() in lib/time/session.ts on purpose: this
   script runs on bare `node` with no `npm ci`, so it cannot import a TS module.
   tests/session-schedule.test.ts pins the two definitions equal across a full
   week, which is the only thing keeping the copy honest. */
export function inCronWindow(now) {
  const dow = now.getUTCDay();
  if (dow >= 1 && dow <= 5) return true;
  return dow === 0 && now.getUTCHours() >= 22;
}

/* Whether a MISSING heartbeat is worth alerting about. Narrower than
   inCronWindow: CME full holidays are excluded because the day has no session
   to miss. (The engine itself still runs on holidays — GitHub's cron knows
   nothing about the CME calendar — and writes a green "holiday" heartbeat, so
   the dashboard deliberately does NOT apply this holiday carve-out.) */
function shouldBeRunning(now, closedHolidays) {
  if (!inCronWindow(now)) return false;
  return !closedHolidays.has(nyDateKey(now));
}

/* Are we inside the first `STARTUP_GRACE_MINUTES` of the cron window?

   GitHub delays scheduled runs on public repos by 15-60 minutes (self-heal.yml
   records a real 49-minute case). The watchdog fires at :17, so on the first
   pass after a gap the engine's slot may merely be late while the newest
   heartbeat is still from before the gap — the staleness test trips, Telegram
   fires, an issue opens, and the :47 pass closes it again. Churn on a delay
   that is normal.

   Expressed as "was the window shut `grace` minutes ago?" rather than as an
   offset from a fixed hour, so it stays correct now that the window is the
   whole Globex week and its only gap is Friday night to Sunday 22:00 UTC.

   Inside the grace a MISSING heartbeat is not alerted. Two consecutive errored
   runs still are: that is evidence of a failure, not of a late start. */
const STARTUP_GRACE_MINUTES = Number(process.env.WATCHDOG_STARTUP_GRACE_MINUTES || 75);

function withinStartupGrace(now) {
  if (!inCronWindow(now)) return false;
  return !inCronWindow(new Date(now.getTime() - STARTUP_GRACE_MINUTES * 60_000));
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("telegram: secrets not set — skipping");
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 1500));
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (res.ok) return true;
      console.error(`telegram: HTTP ${res.status} (attempt ${attempt + 1}/3)`);
    } catch (e) {
      console.error(`telegram: ${e?.message ?? e} (attempt ${attempt + 1}/3)`);
    }
  }
  return false;
}

/* 422 used to be swallowed for EVERY call, because creating a label that
   already exists returns one and that is genuinely fine. The cost was that a
   422 on the issue create — an over-long body, a validation change at GitHub's
   end — also came back as a plain object, `raiseIssue` returned true anyway,
   and the run exited 0. Engine dead + Telegram down + issue 422 meant a green
   watchdog and no alert anywhere, which is the one outcome this script exists
   to prevent. Now only the caller that expects a 422 opts into tolerating it. */
async function gh(method, path, body, { tolerate422 = false } = {}) {
  if (!GH_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "aegis-watchdog",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && !(tolerate422 && res.status === 422))
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const openIssueFor = async (label) => {
  const issues = await gh("GET", `/repos/${REPO}/issues?labels=${label}&state=open&per_page=5`);
  return Array.isArray(issues) && issues.length ? issues[0] : null;
};
const openWatchdogIssue = () => openIssueFor(LABEL);

/* One open issue per label: comment if it exists, otherwise open it. Returns
   true when the alert was delivered to GitHub. */
async function raiseIssue(label, color, title, body, stillText) {
  try {
    const existing = await openIssueFor(label);
    if (existing) {
      await gh("POST", `/repos/${REPO}/issues/${existing.number}/comments`, { body: stillText });
      console.log(`commented on ${label} issue #${existing.number}`);
    } else {
      await gh("POST", `/repos/${REPO}/labels`, { name: label, color }, { tolerate422: true });
      const issue = await gh("POST", `/repos/${REPO}/issues`, { title, body, labels: [label] });
      // An issue with no number is not an issue. Saying "opened #undefined"
      // and returning true is how a lost alert used to look like a delivered one.
      if (!issue?.number) throw new Error(`issue create returned no number for ${label}`);
      console.log(`opened ${label} issue #${issue.number}`);
    }
    return true;
  } catch (e) {
    console.error(`${label} issue alert failed: ${e?.message ?? e}`);
    return false;
  }
}

/* Self-close, same lifecycle the dead-cron check has always used. */
async function resolveIssue(label, comment) {
  try {
    const issue = await openIssueFor(label);
    if (!issue) return;
    await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, { body: comment });
    await gh("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed" });
    console.log(`closed ${label} issue #${issue.number}`);
  } catch (e) {
    console.error(`${label} issue cleanup failed (non-fatal): ${e?.message ?? e}`);
  }
}

/* ── Silence check (item 2.5) ─────────────────────────────────────────────
   Independent of the cron check: runs whether or not the engine looks healthy,
   because a perfectly healthy cron producing nothing is the failure we missed.
   Never throws — a read failure skips the check for this pass. */
async function checkSilence(now, closedHolidays) {
  const { streams, silenceTradingDays, silenceTradingDaysByStream } = loadExpectedStreams();
  const thresholdFor = (s) => Number(silenceTradingDaysByStream[s] ?? silenceTradingDays);
  let rows = [];
  let firstRun = null;
  try {
    // Most recent 1000 signals is far more than 10 trading days of any stream.
    rows = await neonGet(
      "signals?select=dedupe_key,tier,symbol,signal_ts&order=signal_ts.desc&limit=1000"
    );
    const runs = await neonGet("engine_runs?select=ran_at&order=ran_at.asc&limit=1");
    firstRun = Array.isArray(runs) && runs.length ? Date.parse(runs[0].ran_at) : null;
  } catch (e) {
    console.log(`silence check skipped (${e?.message ?? e})`);
    return null;
  }

  const silent = findSilentStreams({
    expected: streams,
    rows,
    engineFirstRunMs: firstRun,
    nowMs: now.getTime(),
    silenceTradingDays,
    silenceTradingDaysByStream,
    closedHolidays,
  });

  console.log(
    `silence: ${silent.length} of ${streams.length} configured stream(s) past their own ` +
      `threshold` +
      (silent.length
        ? ` → ${silent.map((s) => `${s.stream} (${s.days}d ≥ ${s.threshold})`).join(", ")}`
        : "")
  );

  if (!silent.length) {
    await resolveIssue(
      SILENCE_LABEL,
      `Recovered at ${now.toISOString()} — every configured stream is inside its own silence threshold ` +
        `(${streams.map((s) => `\`${s}\` ${thresholdFor(s)}d`).join(", ")}).`
    );
    return { silent, telegramOk: true, issueOk: true };
  }

  const lines = silent.map(
    (s) =>
      `- \`${s.stream}\`: ${s.days} trading days silent (threshold ${s.threshold}) — ` +
      (s.everProduced ? `last signal ${s.lastSignal}` : `has NEVER produced a signal`)
  );
  const telegramOk = await sendTelegram(
    `🔇 <b>Stream silence</b>: ${silent.length} configured stream(s) have produced nothing for ` +
      `longer than their own threshold.\n` +
      silent
        .map(
          (s) =>
            `${s.stream}: ${s.days}d (≥${s.threshold})${s.everProduced ? `, last ${String(s.lastSignal).slice(0, 16)}` : ", never"}`
        )
        .join("\n") +
      `\nThe cron may be perfectly healthy — this is about output, not uptime. Paper only.`
  );
  const issueOk = await raiseIssue(
    SILENCE_LABEL,
    "fbca04",
    `Watchdog: ${silent.length} stream(s) silent past their threshold`,
    `A configured stream can be silent while the engine is entirely healthy — that is how tier A ` +
      `ran quiet from go-live with no alert. Weekends and full CME holidays are excluded.\n\n` +
      lines.join("\n") +
      `\n\n- Detected: ${now.toISOString()}\n` +
      `- Thresholds: ${streams.map((s) => `\`${s}\` ${thresholdFor(s)}d`).join(", ")} ` +
      `(default ${silenceTradingDays}, per-stream overrides in lib/engine/expected-streams.json)\n\n` +
      `This issue closes itself on the next signal from every stream. A genuinely rare stream may ` +
      `need its threshold raised rather than its logic changed — check ` +
      `scripts/diag/PHASE1-FINDINGS.md before assuming a defect.`,
    `Still silent at ${now.toISOString()}:\n${lines.join("\n")}`
  );
  return { silent, telegramOk, issueOk };
}

/* ── Component check ──────────────────────────────────────────────────────
   Independent of both checks above, with its own label and lifecycle. Returns
   true when an alert was needed and every delivery path failed. Never throws. */
async function checkComponents(now) {
  let runs = [];
  try {
    runs = await neonGet("engine_runs?select=ran_at,status,message&order=ran_at.desc&limit=2");
  } catch (e) {
    console.log(`component check skipped (${e?.message ?? e})`);
    return false;
  }
  const failing = findComponentFailures(runs);
  console.log(`components: ${failing.length ? failing.join(", ") : "all healthy"}`);
  if (!failing.length) {
    await resolveIssue(COMPONENT_LABEL, `Recovered at ${now.toISOString()} — no component failed on the latest runs.`);
    return false;
  }
  const detail = runs[0]?.message
    ?.split("; ")
    .filter((part) => part.startsWith(COMPONENT_FAILED))
    .join("\n") ?? "";
  const telegramOk = await sendTelegram(
    `🧩 <b>Engine part failing</b>: ${failing.join(", ")} failed on the last two runs. ` +
      `The signal feed is still running. Paper only.`
  );
  const issueOk = await raiseIssue(
    COMPONENT_LABEL,
    "fbca04",
    `Watchdog: ${failing.join(", ")} failing on consecutive engine runs`,
    `These parts of the engine pass are best effort, so the runs still record \`ok\` — ` +
      `but each one failed on the last two runs:\n\n${failing.map((c) => `- \`${c}\``).join("\n")}\n\n` +
      `Latest messages:\n\n\`\`\`\n${detail.slice(0, 1500)}\n\`\`\`\n\n` +
      `- Detected: ${now.toISOString()}\n\nThis issue closes itself when a later pass is clean.`,
    `Still failing at ${now.toISOString()}: ${failing.join(", ")}.`
  );
  return !telegramOk && !issueOk;
}

/* ── Experimental learner check ───────────────────────────────────────────
   The learner (lib/experiment) runs as its own Neon Function, not inside the
   signal engine, so a healthy engine heartbeat says nothing about it. Its own
   label and lifecycle: alert when, inside the futures week and past the
   startup grace, the newest ok tick is more than LEARNER_STALE_MINUTES old (or
   none ever ran), or the two newest ticks both errored. Pure part exported for
   tests/experiment-watchdog.test.ts. */
const LEARNER_STALE_MINUTES = Number(process.env.WATCHDOG_LEARNER_STALE_MINUTES || 90);

export function findLearnerProblems(health, now, { staleMinutes = LEARNER_STALE_MINUTES, warmingUp = false, active = true } = {}) {
  const problems = [];
  for (const h of health ?? []) {
    const ticks = (h.runs ?? []).filter((r) => r.job === "tick");
    if (ticks.length >= 2 && ticks[0].status === "error" && ticks[1].status === "error")
      problems.push({ lineage: h.lineage, reason: `the last two learner checks failed (${(ticks[0].message ?? "no message").slice(0, 120)})` });
    if (!active || warmingUp) continue;
    const last = Date.parse(h.last_ok_tick_at ?? "");
    const age = Number.isFinite(last) ? (now.getTime() - last) / 60000 : Infinity;
    const everRan = ticks.length > 0;
    if (age > staleMinutes && (everRan || Number.isFinite(last)))
      problems.push({ lineage: h.lineage, reason: `no successful learner check for ${age === Infinity ? "ever" : Math.round(age) + " min"}` });
    if (h.execution_clock === "delayed_market" && now.getTime() - Date.parse(h.registered_at ?? "") > 60 * 60000) {
      const source = Date.parse(h.source_data_as_of ?? "");
      const cursor = Date.parse(h.data_as_of ?? "");
      if (!Number.isFinite(source)) problems.push({ lineage: h.lineage, reason: "no completed source batch has been published" });
      else if (!Number.isFinite(cursor) || source - cursor > 60 * 60000)
        problems.push({ lineage: h.lineage, reason: `virtual trading is behind the published prices (${h.backlog_count ?? 0} events waiting)` });
      if (Number(h.stuck_orders) > 0)
        problems.push({ lineage: h.lineage, reason: `${h.stuck_orders} virtual order(s) have not progressed for over 60 minutes` });
    }
  }
  return problems;
}

async function checkLearner(now, closedHolidays) {
  let health = [];
  try {
    health = await neonGet("experiment_health?select=lineage,status,last_ok_tick_at,runs,execution_clock,registered_at,data_as_of,backlog_count,stuck_orders,source_data_as_of");
  } catch (e) {
    console.log(`learner check skipped (${e?.message ?? e})`);
    return false;
  }
  const problems = findLearnerProblems(health, now, { warmingUp: withinStartupGrace(now), active: shouldBeRunning(now, closedHolidays) });
  console.log(`learner: ${problems.length ? problems.map((p) => p.reason).join("; ") : "healthy"}`);
  if (!problems.length) {
    await resolveIssue(LEARNER_LABEL, `Recovered at ${now.toISOString()} — the experimental learner is checking in again.`);
    return false;
  }
  const lines = problems.map((p) => `- ${p.lineage}: ${p.reason}`).join("\n");
  const telegramOk = await sendTelegram(
    `🧪 <b>Experimental learner</b> needs attention:
${problems.map((p) => p.reason).join("\n")}
Virtual only. Fallback: run the experiment-fallback workflow.`
  );
  const issueOk = await raiseIssue(
    LEARNER_LABEL,
    "fbca04",
    "Watchdog: virtual trading needs attention",
    `The learner's Neon Function (aegisexp) should run every 15 minutes through the futures week.

${lines}

` +
      `- Detected: ${now.toISOString()}
- Fallback: Actions → experiment-fallback → Run workflow (job: tick)
- Health: https://br-small-mode-b3y8iq6w-aegisexp.compute.c-4.ap-southeast-1.aws.neon.tech/health

` +
      `Virtual only — nothing here touches real money. This issue closes itself when a later check is healthy.`,
    `Still unhealthy at ${now.toISOString()}:
${lines}`
  );
  return !telegramOk && !issueOk;
}

/* ── Main ────────────────────────────────────────────────────────────── */

/** True when checkSilence needed to alert and every delivery path failed. */
const alertLost = (silence) =>
  Boolean(silence && silence.silent.length && !silence.telegramOk && !silence.issueOk);

async function main() {
  const now = new Date();
  const closedHolidays = loadClosedHolidays();
  // A healthy price engine cannot stand in for completed model training.
  // Four days covers the weekend and a full market holiday without alert churn.
  let sideAlertLost = false;
  try {
    const [completed, models] = await Promise.all([
      neonGet("learning_runs?select=finished_at,status&status=eq.ok&order=finished_at.desc&limit=1"),
      neonGet("model_registry?select=trained_at,train_n&order=trained_at.desc&limit=1"),
    ]);
    const finished = Date.parse(completed[0]?.finished_at ?? "");
    const trained = Date.parse(models[0]?.trained_at ?? "");
    if (![finished, trained].every(Number.isFinite) || now.getTime() - Math.min(finished, trained) > 4 * 86400000) {
      sideAlertLost = !await raiseIssue("watchdog-learning", "fbca04", "Watchdog: completed training is overdue",
        `The last completed learning job or model artifact is more than four days old. Last learning: ${completed[0]?.finished_at ?? "none"}; last model: ${models[0]?.trained_at ?? "none"}. Check nightly-learn. A successful engine heartbeat does not resolve this alert.`,
        "Completed learning is still overdue.");
    } else await resolveIssue("watchdog-learning", `Training recovered: ${completed[0].finished_at}.`);
  } catch (error) {
    console.error(`training health unreadable: ${error?.message ?? error}`);
    sideAlertLost = true;
  }
  // Training and component alerts share one flag so every return path below
  // turns the run red when either lost its delivery.
  if (await checkComponents(now)) sideAlertLost = true;
  if (await checkLearner(now, closedHolidays)) sideAlertLost = true;

  let runs = [];
  try {
    runs = await neonGet("engine_runs?select=ran_at,status,message&order=ran_at.desc&limit=2");
  } catch (e) {
    // Database briefly unreachable — do not alert on a read failure alone.
    // The silence check does its own reads and reports its own failure.
    console.log(`heartbeat unreadable (${e?.message ?? e}) — skipping the cron check`);
    // Skipping the CRON check is deliberate; discarding the SILENCE check's
    // delivery outcome was not. A silence alert that failed both paths still
    // has to turn the run red.
    const silence = await checkSilence(now, closedHolidays);
    return alertLost(silence) || sideAlertLost ? 1 : 0;
  }

  const latest = runs[0] ?? null;
  const ageMin = latest ? (now.getTime() - new Date(latest.ran_at).getTime()) / 60000 : Infinity;
  const warmingUp = withinStartupGrace(now);
  const stale = ageMin > STALE_MINUTES && !warmingUp;
  const doubleError = runs.length >= 2 && runs[0].status === "error" && runs[1].status === "error";
  const active = shouldBeRunning(now, closedHolidays);
  const unhealthy = active && (stale || doubleError);

  console.log(
    `watchdog: active=${active} ageMin=${ageMin === Infinity ? "∞" : ageMin.toFixed(1)} ` +
      `stale=${stale} doubleError=${doubleError} (threshold ${STALE_MINUTES}m)` +
      (warmingUp ? ` — inside the ${STARTUP_GRACE_MINUTES}m startup grace after the weekend gap` : "")
  );

  if (!unhealthy) {
    // Self-heal: close any open watchdog issue once the engine is back.
    if (latest)
      await resolveIssue(
        LABEL,
        `Recovered at ${now.toISOString()} — latest run ${latest.ran_at} (${latest.status}).`
      );
    console.log("engine healthy");
    // A healthy cron says nothing about OUTPUT — that is the whole point of 2.5.
    const silence = await checkSilence(now, closedHolidays);
    return alertLost(silence) || sideAlertLost ? 1 : 0;
  }

  const since = latest ? latest.ran_at : "unknown (no runs recorded)";
  const reason = doubleError
    ? `last two runs errored (${runs[0].message?.slice(0, 120) ?? "no message"})`
    : `no run for ${ageMin === Infinity ? "ever" : Math.round(ageMin) + " min"} inside the cron window`;
  const text =
    `⚠️ <b>Engine watchdog</b>: signal engine looks dead.\n` +
    `${reason}.\nLatest run: ${since}\n` +
    `Check https://github.com/${REPO}/actions/workflows/signal-engine.yml`;

  const telegramOk = await sendTelegram(text);
  const issueOk = await raiseIssue(
    LABEL,
    "d93f0b",
    `Watchdog: engine stale since ${since}`,
    `The signal engine should be running but is not.\n\n` +
      `- Reason: ${reason}\n- Detected: ${now.toISOString()}\n- Latest heartbeat: ${since}\n\n` +
      `This issue closes itself when the watchdog sees a healthy run again.`,
    `Still unhealthy at ${now.toISOString()} — ${reason}.`
  );

  // Silence is checked even when the cron is dead: separate label, separate
  // lifecycle, so a dead cron cannot hide a silent stream or vice versa. Its
  // delivery outcome used to be discarded here, which meant a silence alert
  // could be lost on a run that still exited 0 because the cron alert landed.
  const silence = await checkSilence(now, closedHolidays);

  // Exit non-zero ONLY when an alert was needed and every path failed —
  // that red X is itself the last-resort alert.
  if (!telegramOk && !issueOk) return 1;
  return alertLost(silence) || sideAlertLost ? 1 : 0;
}

/* Run only when this file IS the entry point.

   Two test files import from here — tests/silence.test.ts for
   findSilentStreams and tests/session-schedule.test.ts for inCronWindow — and
   without this guard the import alone fired main(): live Supabase and GitHub
   reads during `npm test`, and, worse, `process.exitCode = 1` whenever the
   engine looked stale inside the cron window. ci.yml runs the suite on every
   pull request, so a perfectly good PR could go red because the trading
   engine happened to be behind. */
const isEntryPoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint)
  // process.exitCode (not process.exit) — lets pending I/O drain and avoids a
  // libuv teardown assert seen on some Node builds after fetch().
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      console.error(`watchdog crashed: ${e?.message ?? e}`);
      process.exitCode = 0; // never spam red X's for watchdog-side flakiness
    });
