/* Databento historical backfill for the bars_5m archive.
   ─────────────────────────────────────────────────────────────────────────
   THIS FILE CURRENTLY ONLY ESTIMATES. `--estimate` calls Databento's free
   metadata endpoints and spends nothing; the credit-spending `--run` path
   lands in the next commit, after a human has seen a real number.

   Why an estimate step exists at all: the free credit is $125 and expires six
   months from signup, so the historical pull is a one-shot decision. Guessing
   the range and discovering the cost afterwards is not recoverable. Databento
   publishes metadata.get_cost and metadata.get_billable_size for exactly this,
   both free, and the request parameters here are IDENTICAL to the ones the
   real pull will use — an estimate built from different parameters is not an
   estimate.

   Auth is HTTP Basic with the API key as the username and an empty password
   (Databento's documented scheme). The key comes from DATABENTO_API_KEY, read
   from the environment or from a gitignored .env.local — deliberately NOT from
   a command-line argument, which would leave it in shell history and in the
   process list.

   Run with:  npx tsx scripts/engine/databento-backfill.ts --estimate

   Paper only, delayed data — nothing here touches real money or real orders. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HIST = "https://hist.databento.com/v0";
const DATASET = "GLBX.MDP3";
const SCHEMA = "ohlcv-1m";
const STYPE_IN = "continuous";
/* Continuous front-month, volume-rolled. These are the real CME contracts,
   which is the entire point of the exercise — the live feed's MES=F/MNQ=F are
   the right instruments but a delayed, unofficial, front-month stitch. */
const SYMBOLS = ["MES.c.0", "MNQ.c.0"] as const;

/** The free credit, for framing the printed numbers. */
const FREE_CREDIT_USD = 125;

/* ── Storage projection ───────────────────────────────────────────────────
   On a free-tier Supabase project the binding constraint is NOT the dollar
   cost — it is the 500 MB database ceiling. get_billable_size reports the
   size of the ONE-MINUTE download; what actually lands in bars_5m is the
   five-minute aggregate, roughly a fifth of the rows. So the download size
   badly overstates the storage impact and cannot be used for this.

   Both constants are measured against the live table rather than guessed
   (2026-07-31: 30,312 rows occupying 5,349,376 bytes including indexes,
   covering 2026-05-12 → 2026-07-30 for two symbols). */
const MEASURED_BYTES_PER_ROW = 176.5;
const BARS_PER_TRADING_DAY = 270; // ~22.5h of Globex at 5m, per symbol
const SUPABASE_FREE_TIER_BYTES = 500e6;
/** Current database total, measured the same day, for headroom arithmetic. */
const CURRENT_DB_BYTES = 17e6;

function projectStorage(start: string, end: string, symbols: number) {
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  const tradingDays = Math.max(0, days * (5 / 7)); // weekends carry no session
  const rows = tradingDays * BARS_PER_TRADING_DAY * symbols;
  return { rows: Math.round(rows), bytes: Math.round(rows * MEASURED_BYTES_PER_ROW) };
}

/* Candidate windows, cheapest first. The first one is the minimum that makes
   the proxy-error measurement possible at all: it must overlap the existing
   Yahoo archive, which starts 2026-05-12. The longer windows are what the
   credit is actually for — Yahoo caps 5m history at a sliding 60 days, so
   everything before that is unobtainable from the live feed at any price. */
const WINDOWS: { label: string; start: string; end: string; why: string }[] = [
  {
    label: "overlap-only",
    start: "2026-05-12",
    end: "2026-07-30",
    why: "matches the existing Yahoo archive exactly — the minimum for the proxy-error comparison",
  },
  {
    label: "6-month",
    start: "2026-02-01",
    end: "2026-07-30",
    why: "adds a quarter of unobtainable history either side of the current tuning window",
  },
  {
    label: "1-year",
    start: "2025-07-30",
    end: "2026-07-30",
    why: "a full year — enough to see the same season twice",
  },
  {
    label: "2-year",
    start: "2024-07-30",
    end: "2026-07-30",
    why: "two years; enough for a train/holdout split that spans regimes",
  },
  {
    label: "5-year",
    start: "2021-07-30",
    end: "2026-07-30",
    why: "five years — covers the 2022 bear market, which no shorter window does",
  },
  {
    /* MES and MNQ began trading on CME on 2019-05-06. Asking for anything
       earlier cannot return these contracts, so this is the true ceiling. */
    label: "max",
    start: "2019-05-06",
    end: "2026-07-30",
    why: "the entire life of both contracts — MES/MNQ launched 2019-05-06",
  },
];

/* ── Key loading ──────────────────────────────────────────────────────── */

function loadApiKey(): string {
  const fromEnv = process.env.DATABENTO_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  // .env.local is gitignored (.gitignore has `.env*`), so it is a safe home
  // for the key. Parsed minimally rather than pulling in a dependency.
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?DATABENTO_API_KEY\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    /* no .env.local — fall through to the error below */
  }

  throw new Error(
    "DATABENTO_API_KEY is not set.\n" +
      "Put it in a gitignored .env.local at the repo root:\n" +
      '  echo "DATABENTO_API_KEY=db-..." >> .env.local\n' +
      "or export it in your shell. It is deliberately not accepted as a CLI\n" +
      "argument, which would leave the key in shell history."
  );
}

function authHeader(key: string): string {
  // Documented scheme: key as username, empty password.
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

/* ── Requests ─────────────────────────────────────────────────────────── */

/** Shared request shape, so the estimate cannot drift from the real pull. */
function rangeParams(start: string, end: string, symbols: readonly string[]) {
  return {
    dataset: DATASET,
    schema: SCHEMA,
    stype_in: STYPE_IN,
    symbols: symbols.join(","),
    start,
    end,
  };
}

async function postForm(path: string, key: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${HIST}/${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(key),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface the vendor's own message — a 401 here means the key, a 422 means
    // the parameters, and guessing between them wastes a day.
    throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} -> unparseable response: ${text.slice(0, 200)}`);
  }
}

const fmtUsd = (v: number) => `$${v.toFixed(2)}`;
const fmtBytes = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${v} B`;

async function estimate(): Promise<void> {
  const key = loadApiKey();
  console.log(
    `Databento cost estimate — ${DATASET} ${SCHEMA}, stype_in=${STYPE_IN}, ` +
      `symbols ${SYMBOLS.join(" + ")}`
  );
  console.log(`Free credit for framing: ${fmtUsd(FREE_CREDIT_USD)}\n`);
  console.log("These calls are metadata only. Nothing below spends credit.\n");

  const rows: { label: string; cost: number | null; bytes: number | null; note: string }[] = [];

  for (const w of WINDOWS) {
    const params = rangeParams(w.start, w.end, SYMBOLS);
    let cost: number | null = null;
    let bytes: number | null = null;
    let note = w.why;
    try {
      const costRes = await postForm("metadata.get_cost", key, { ...params, mode: "historical-streaming" });
      cost = typeof costRes === "number" ? costRes : Number(costRes?.cost ?? costRes);
      const sizeRes = await postForm("metadata.get_billable_size", key, params);
      bytes = typeof sizeRes === "number" ? sizeRes : Number(sizeRes?.size ?? sizeRes);
    } catch (e) {
      note = `FAILED — ${e instanceof Error ? e.message : String(e)}`;
    }
    rows.push({ label: w.label, cost, bytes, note });
    const store = projectStorage(w.start, w.end, SYMBOLS.length);
    const dbAfter = CURRENT_DB_BYTES + store.bytes;
    console.log(
      `${w.label.padEnd(14)} ${w.start} → ${w.end}  ` +
        `${cost === null ? "cost —" : fmtUsd(cost).padEnd(9)} ` +
        `dl ${(bytes === null ? "—" : fmtBytes(bytes)).padEnd(9)} ` +
        `store ~${fmtBytes(store.bytes).padEnd(8)} ` +
        `db→${fmtBytes(dbAfter)} of ${fmtBytes(SUPABASE_FREE_TIER_BYTES)}` +
        `${dbAfter > SUPABASE_FREE_TIER_BYTES ? "  ⚠ OVER FREE TIER" : ""}`
    );
    console.log(`${"".padEnd(14)} ${note}\n`);
  }

  const affordable = rows.filter((r) => r.cost !== null && r.cost <= FREE_CREDIT_USD);
  console.log("─".repeat(72));
  if (!affordable.length) {
    console.log("No window priced inside the free credit, or every request failed.");
  } else {
    const best = affordable[affordable.length - 1];
    console.log(
      `Largest window inside the ${fmtUsd(FREE_CREDIT_USD)} credit: ` +
        `${best.label} at ${fmtUsd(best.cost as number)} ` +
        `(${(((best.cost as number) / FREE_CREDIT_USD) * 100).toFixed(1)}% of it).`
    );
  }
  console.log(
    "\n'dl' is the one-minute download get_billable_size reports; 'store' is the\n" +
      "five-minute aggregate that actually lands in bars_5m, projected from the\n" +
      `live table's measured ${MEASURED_BYTES_PER_ROW} bytes/row. On a free-tier project the 500 MB\n` +
      "database ceiling binds long before the $125 credit does, so read the db\n" +
      "column, not the dollar column, when choosing."
  );
  console.log(
    "\nNothing was downloaded and no credit was spent. Pick a window before the\n" +
      "backfill runs — the pull is one-shot and the credit expires six months\n" +
      "from signup."
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--estimate")) {
    await estimate();
    return;
  }
  console.error(
    "Usage: npx tsx scripts/engine/databento-backfill.ts --estimate\n\n" +
      "Only --estimate exists so far, and it spends nothing. The credit-spending\n" +
      "backfill is added in a later commit, after a human has approved a window."
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
