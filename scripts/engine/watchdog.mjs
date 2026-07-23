/* Engine watchdog — dead-cron detector. Runs on its own GitHub Actions
   schedule (.github/workflows/watchdog.yml, twice hourly at :17/:47 —
   offset from the engine's every-15-min cadence) with PLAIN node: no npm
   install, no TypeScript.

   Reads the latest heartbeats via Supabase REST with the publishable key
   (public SELECT is allowed by design — values mirror lib/supabase/config.ts).
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
import { fileURLToPath } from "node:url";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bizgcoljagsnytrnaicr.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_4AAYYUppP6lRdoofTTkd_A_YSu6WPNo";
const STALE_MINUTES = Number(process.env.WATCHDOG_STALE_MINUTES || 45);
const REPO = process.env.GITHUB_REPOSITORY || "veerpatta/aegis-futures-lab";
const GH_TOKEN = process.env.GITHUB_TOKEN || "";
const LABEL = "watchdog";

/* ── Helpers ─────────────────────────────────────────────────────────── */

function nyDateKey(date) {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date);
}

function loadClosedHolidays() {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "..", "..", "lib", "market", "cme-holidays.json"), "utf8"));
  return new Set(raw.holidays.filter((h) => h.kind === "closed").map((h) => h.date));
}

function shouldBeRunning(now, closedHolidays) {
  const dow = now.getUTCDay();
  const hour = now.getUTCHours();
  if (dow < 1 || dow > 5) return false;
  if (hour < 6 || hour >= 22) return false; // engine cron: */15 6-21 UTC
  if (closedHolidays.has(nyDateKey(now))) return false;
  return true;
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

async function gh(method, path, body) {
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
  if (!res.ok && res.status !== 422)
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const openWatchdogIssue = async () => {
  const issues = await gh("GET", `/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=5`);
  return Array.isArray(issues) && issues.length ? issues[0] : null;
};

/* ── Main ────────────────────────────────────────────────────────────── */

async function main() {
  const now = new Date();
  const closedHolidays = loadClosedHolidays();

  let runs = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/engine_runs?select=ran_at,status,message&order=ran_at.desc&limit=2`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(`heartbeat read HTTP ${res.status}`);
    runs = await res.json();
  } catch (e) {
    // Supabase briefly unreachable — do not alert on a read failure alone.
    console.log(`heartbeat unreadable (${e?.message ?? e}) — skipping this pass`);
    return 0;
  }

  const latest = runs[0] ?? null;
  const ageMin = latest ? (now.getTime() - new Date(latest.ran_at).getTime()) / 60000 : Infinity;
  const stale = ageMin > STALE_MINUTES;
  const doubleError = runs.length >= 2 && runs[0].status === "error" && runs[1].status === "error";
  const active = shouldBeRunning(now, closedHolidays);
  const unhealthy = active && (stale || doubleError);

  console.log(
    `watchdog: active=${active} ageMin=${ageMin === Infinity ? "∞" : ageMin.toFixed(1)} ` +
      `stale=${stale} doubleError=${doubleError} (threshold ${STALE_MINUTES}m)`
  );

  if (!unhealthy) {
    // Self-heal: close any open watchdog issue once the engine is back.
    if (latest)
      try {
        const issue = await openWatchdogIssue();
        if (issue) {
          await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, {
            body: `Recovered at ${now.toISOString()} — latest run ${latest.ran_at} (${latest.status}).`,
          });
          await gh("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed" });
          console.log(`closed watchdog issue #${issue.number}`);
        }
      } catch (e) {
        console.error(`issue cleanup failed (non-fatal): ${e?.message ?? e}`);
      }
    console.log("engine healthy");
    return 0;
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

  let issueOk = false;
  try {
    const existing = await openWatchdogIssue();
    if (existing) {
      await gh("POST", `/repos/${REPO}/issues/${existing.number}/comments`, {
        body: `Still unhealthy at ${now.toISOString()} — ${reason}.`,
      });
      console.log(`commented on watchdog issue #${existing.number}`);
    } else {
      await gh("POST", `/repos/${REPO}/labels`, { name: LABEL, color: "d93f0b" }); // 422 = exists, fine
      const issue = await gh("POST", `/repos/${REPO}/issues`, {
        title: `Watchdog: engine stale since ${since}`,
        body:
          `The signal engine should be running but is not.\n\n` +
          `- Reason: ${reason}\n- Detected: ${now.toISOString()}\n- Latest heartbeat: ${since}\n\n` +
          `This issue closes itself when the watchdog sees a healthy run again.`,
        labels: [LABEL],
      });
      console.log(`opened watchdog issue #${issue?.number}`);
    }
    issueOk = true;
  } catch (e) {
    console.error(`issue alert failed: ${e?.message ?? e}`);
  }

  // Exit non-zero ONLY when the alert was needed and every path failed —
  // that red X is itself the last-resort alert.
  return telegramOk || issueOk ? 0 : 1;
}

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
