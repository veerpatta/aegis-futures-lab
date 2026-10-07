/* Databento historical backfill for the bars_5m archive.
   ─────────────────────────────────────────────────────────────────────────
   `--estimate` calls Databento's free metadata endpoints and spends nothing.
   `--run` SPENDS CREDIT: it quotes the whole run first and refuses above the
   remaining credit in the purchase ledger (scripts/engine/databento-purchase.ts),
   then buys month by month, one ledger row per month, plus the roll-day fills
   for every quarterly expiry of an equity-index symbol in the window.

   Long history for a new symbol, e.g. the micro Russell and Dow:
     npx tsx scripts/engine/databento-backfill.ts --estimate --symbols M2K.c.0,MYM.c.0 --from 2019-05-06 --to 2026-10-03
     npx tsx scripts/engine/databento-backfill.ts --run --window custom --symbols M2K.c.0,MYM.c.0 --from 2019-05-06 --to 2026-10-03
   (CI only: .github/workflows/databento-backfill.yml.)

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
import {
  budgetCheck,
  CREDIT_CAP,
  ledgerEntry,
  ledgerUsed,
  markImported,
  metadata,
  purchaseId,
  quoteCost,
  RESERVE_FACTOR,
  reserveBudget,
  type DataRequest,
} from "./databento-purchase";
import { importRollFill } from "./refresh-contract-data";
import { expiryDaysBetween, isEquityIndexRoot, rollFillPlan, type RollFillPlan } from "@/lib/data/roll-fill";
import {
  CHUNK_TAIL_SEC,
  DATABENTO_SUNDAY_GAP,
  assertAligned,
  bars5mFromOhlcv1mCsv,
  isUtcSaturday,
  isUtcSunday,
  monthBoundaries,
} from "@/lib/data/databento";

const HIST = "https://hist.databento.com/v0";
const DATASET = "GLBX.MDP3";
const SCHEMA = "ohlcv-1m";
const STYPE_IN = "continuous";
/* Continuous front-month. These are the real CME contracts, which is the
   entire point of the exercise — the live feed's MES=F/MNQ=F are the right
   instruments but a delayed, unofficial, front-month stitch.

   ROLL RULE, PER SYMBOL, and the comment above this one used to be wrong.
   It said "volume-rolled" while every symbol used `.c.0`, which is Databento's
   CALENDAR rank — nearest expiry, regardless of where the liquidity is.

   For MES/MNQ that distinction is invisible: they list quarterly, so the
   nearest expiry IS the liquid one almost all the time. Their baselines were
   measured on `.c.0` and stay on it; changing them would invalidate every
   published figure.

   For gold it is not invisible. MGC lists monthly but liquidity concentrates
   in Feb/Apr/Jun/Aug/Oct/Dec, so in those months `.c.0` tracks the contract
   that is expiring and that everyone has already rolled out of. Measured on a
   real pull: every even month came back ~88% empty (2025-02: 661 bars against
   MES's 5,471; 2025-04: 755; 2025-06: 743) while odd months were full. The
   data was not missing — it was the wrong contract.

   `.v.0` is the volume rank: whichever contract is actually trading. Its
   download is 273.7 MB against `.c.0`'s 69.8 MB over the same window, which is
   the same fact stated in bytes.

   M2K (Micro Russell 2000) and MYM (Micro Dow) list quarterly exactly like
   MES/MNQ, so they take `.c.0` too — and the same expiry-day gap: `.c.0`
   follows the expiring contract for the whole UTC date after it stops at the
   09:30 ET settlement. A `--run` over an equity-index symbol therefore also
   buys the roll-day fills for every quarterly expiry in its window
   (lib/data/roll-fill.ts, scripts/engine/refresh-contract-data.ts). Their
   contract specs live in lib/costs; nothing here needs a point value. */
const ALL_SYMBOLS = ["MES.c.0", "MNQ.c.0", "M2K.c.0", "MYM.c.0", "MGC.v.0", "SI.v.0"] as const;

/* --symbols MGC.c.0,SI.c.0 restricts the pull.

   This exists because the archive is built INCREMENTALLY. MES and MNQ were
   pulled in 2026-07; re-requesting them to add gold would spend credit again
   on bars already stored and double the projected storage. The estimate and
   the run share this filter, so the number you read is the number you spend —
   an estimate built from a different symbol set is not an estimate. */
const SYMBOLS: readonly string[] = (() => {
  const i = process.argv.indexOf("--symbols");
  const raw = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
  if (!raw) return ALL_SYMBOLS;
  const want = raw.split(",").map((x: string) => x.trim()).filter(Boolean);
  const unknown = want.filter(
    (w: string) => !(ALL_SYMBOLS as readonly string[]).includes(w)
  );
  if (unknown.length)
    throw new Error(
      `Unknown --symbols: ${unknown.join(", ")}. Known: ${ALL_SYMBOLS.join(", ")}`
    );
  return want;
})();

/** The free credit, for framing the printed numbers. */
const FREE_CREDIT_USD = 125;

/* ── Storage projection ───────────────────────────────────────────────────
   On a free Neon project the storage limit is 0.5 GB. get_billable_size reports the
   size of the ONE-MINUTE download; what actually lands in bars_5m is the
   five-minute aggregate, roughly a fifth of the rows. So the download size
   badly overstates the storage impact and cannot be used for this.

   Both constants are measured against the live table rather than guessed
   (2026-07-31: 30,312 rows occupying 5,349,376 bytes including indexes,
   covering 2026-05-12 → 2026-07-30 for two symbols). */
const MEASURED_BYTES_PER_ROW = 176.5;
const BARS_PER_TRADING_DAY = 270; // ~22.5h of Globex at 5m, per symbol
const NEON_FREE_TIER_BYTES = 500e6;

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

// Explicit custom dates supersede the legacy fixed archive windows.
const fromIndex = process.argv.indexOf("--from"), toIndex = process.argv.indexOf("--to");
if (fromIndex >= 0 || toIndex >= 0) {
  const start = process.argv[fromIndex + 1], end = process.argv[toIndex + 1];
  if (fromIndex < 0 || toIndex < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    !Number.isFinite(Date.parse(start)) || Date.parse(start) >= Date.parse(end) || Date.parse(end) > Date.now())
    throw new Error("Provide valid --from YYYY-MM-DD and --to YYYY-MM-DD (exclusive, no future dates)");
  WINDOWS.splice(0, WINDOWS.length, { label: "custom", start, end, why: "Explicit recovery window" });
}

/* ── Secret loading ───────────────────────────────────────────────────── */

/* Read a secret from the environment, falling back to a gitignored .env.local
   (.gitignore covers `.env*`). Deliberately never a CLI argument, which would
   leave the value in shell history and in the process list. */
function loadSecret(name: string, hint: string): string {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;

  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line);
      if (!m) continue;
      const value = m[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    /* no .env.local — fall through to the error below */
  }

  throw new Error(
    `${name} is not set.\n` +
      `Put it in a gitignored .env.local at the repo root:\n` +
      `  echo "${name}=${hint}" >> .env.local\n` +
      `or export it in your shell.`
  );
}

const loadApiKey = () => loadSecret("DATABENTO_API_KEY", "db-...");

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
  const databaseUrl = new URL(loadSecret("DATABASE_URL", "<Neon pooled database URL>"));
  databaseUrl.searchParams.set("sslmode", "verify-full");
  const { Client } = await import("pg");
  const database = new Client({ connectionString: databaseUrl.toString() });
  await database.connect();
  let currentDbBytes: number;
  let ledgerUsed: number;
  try {
    currentDbBytes = Number((await database.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
    ledgerUsed = Number((await database.query("SELECT coalesce(sum(reserved_usd),0) AS n FROM private_research.data_purchases")).rows[0].n);
  } finally {
    await database.end();
  }
  console.log(
    `Databento cost estimate — ${DATASET} ${SCHEMA}, stype_in=${STYPE_IN}, ` +
      `symbols ${SYMBOLS.join(" + ")}`
  );
  console.log(`Free credit for framing: ${fmtUsd(FREE_CREDIT_USD)}`);
  console.log(
    `Purchase ledger (what --run is held to): ${fmtUsd(ledgerUsed)} reserved of the ${fmtUsd(CREDIT_CAP)} attested credit, ` +
      `${fmtUsd(CREDIT_CAP - ledgerUsed)} left; a window needs cost x ${RESERVE_FACTOR} of that.\n`
  );
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
    const dbAfter = currentDbBytes + store.bytes;
    console.log(
      `${w.label.padEnd(14)} ${w.start} → ${w.end}  ` +
        `${cost === null ? "cost —" : fmtUsd(cost).padEnd(9)} ` +
        `dl ${(bytes === null ? "—" : fmtBytes(bytes)).padEnd(9)} ` +
        `store ~${fmtBytes(store.bytes).padEnd(8)} ` +
        `db→${fmtBytes(dbAfter)} of ${fmtBytes(NEON_FREE_TIER_BYTES)}` +
        `${dbAfter > NEON_FREE_TIER_BYTES ? "  ⚠ OVER FREE TIER" : ""}` +
        `${cost !== null && !budgetCheck([cost], ledgerUsed).fits ? "  ⚠ OVER LEDGER CREDIT" : ""}`
    );
    const fills = rollFillPlans(w.start, w.end);
    if (fills.length)
      note +=
        `\n${"".padEnd(14)} + up to ${fills.length} roll-day fill(s) (${fills.map((p) => p.contract).slice(0, 4).join(", ")}${fills.length > 4 ? ", …" : ""}),` +
        ` each 6 hours of one contract, quoted and bought at run time only where the continuous series has a gap`;
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
      `live table's measured ${MEASURED_BYTES_PER_ROW} bytes/row. On a free Neon project the 0.5 GB\n` +
      "database ceiling binds long before the $125 credit does, so read the db\n" +
      "column, not the dollar column, when choosing."
  );
  console.log(
    "\nNothing was downloaded and no credit was spent. Pick a window before the\n" +
      "backfill runs — the pull is one-shot and the credit expires six months\n" +
      "from signup."
  );
}

/* ── The backfill ─────────────────────────────────────────────────────────

   SPENDS CREDIT. Fetches ohlcv-1m month by month, folds each month to 5m and
   upserts it as source='databento'.

   WHY MONTHLY CHUNKS WITH A TAIL. Aggregation calls a 5-minute bucket closed
   only when the data contains a later minute (see lib/data/databento.ts). Cut
   the request at a month boundary and the final bucket of every month has no
   later minute inside that response, so it is dropped — 87 silently missing
   bars, one per seam, each of which would leave a hole in exactly the kind of
   multi-day frame zone-v5 builds structure from.

   The fix has two halves and needs both:
     * request [monthStart, nextMonthStart + 300s) so the last real bucket has
       a later minute to prove it closed;
     * keep every boundary 5m-aligned. Month starts are midnight UTC and
       86400 % 300 === 0, so they already are. If they were not, the first
       bucket of each chunk would be missing its earlier minutes while looking
       complete — a half-formed bar that no check downstream could catch.
   Buckets seen twice across the overlap are harmless: the upsert is keyed
   (symbol, source, time) and the second write is identical to the first. */

const UPSERT_CHUNK = 1000; // matches archiveNewBars in run-live.ts

/* bars_5m.symbol for each vendor symbol. Plain strings rather than FeedSymbol:
   the archive may hold a series before the app can chart or trade it (M2K and
   MYM land here first; lib/market/contracts.ts decides when they are fetchable). */
const FEED_SYMBOL: Record<string, string> = {
  "MES.c.0": "MES",
  "MNQ.c.0": "MNQ",
  "M2K.c.0": "M2K",
  "MYM.c.0": "MYM",
  "MGC.v.0": "MGC",
  /* Full-size silver, not micro. It is a CONFIRMATION series — never traded,
     only read for its zone structure — and specs.ts role-locks SIL against
     exactly that duty because its thin book manufactures structure that is not
     there. */
  "SI.v.0": "SI",
};

const isoZ = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** One chunk's request. The SAME object is quoted, reserved in the purchase
    ledger and downloaded, so the number reserved is the number spent — and an
    interrupted run can tell from the ledger which chunks it already paid for. */
function chunkRequest(symbol: string, from: Date, to: Date): DataRequest {
  return rangeParams(isoZ(from), isoZ(new Date(to.getTime() + CHUNK_TAIL_SEC * 1000)), [symbol]);
}

async function fetchOhlcv1mCsv(key: string, request: DataRequest): Promise<string> {
  const params = new URLSearchParams({
    ...request,
    encoding: "csv",
    // Ask for decimal prices explicitly, and tell the parser so — the two must
    // agree or assertPlausible fires (which is the point).
    pretty_px: "true",
    pretty_ts: "false",
  });
  const res = await fetch(`${HIST}/timeseries.get_range`, {
    method: "POST",
    headers: {
      Authorization: authHeader(key),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/csv",
    },
    body: params,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `timeseries.get_range ${request.symbols} ${request.start} -> HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  return text;
}

/** The roll-day fills a window over the selected symbols needs: every
    quarterly expiry in [start, end) for each equity-index symbol (metals are
    volume-rolled `.v.0` and have no such gap). */
function rollFillPlans(start: string, end: string): RollFillPlan[] {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return SYMBOLS.map((s) => FEED_SYMBOL[s])
    .filter((feed): feed is string => !!feed && isEquityIndexRoot(feed))
    .flatMap((root) => expiryDaysBetween(start, end).map((day) => rollFillPlan(root, day)!))
    .filter((p) => Date.parse(p.request.end) <= endMs);
}

/** UTC date keys ('YYYY-MM-DD') that have no bars at all in this slice. */
function emptyDayKeys(bars: { time: number }[], from: Date, to: Date): string[] {
  const seen = new Set(bars.map((b) => new Date(b.time * 1000).toISOString().slice(0, 10)));
  const out: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    if (!seen.has(key)) out.push(key);
  }
  return out;
}

/* BUDGET. Every chunk goes through the same purchase ledger as the daily
   refresh (scripts/engine/databento-purchase.ts): the whole run is quoted
   first, for free, and refused — before a byte is bought — if the quotes plus
   the 25% reserve would pass the remaining attested credit. Each chunk is then
   reserved in the ledger before its download and marked imported after, so an
   interrupted run never pays twice for a month it already stored, and a chunk
   whose download outcome is unknown stops the next run until a person
   reconciles it (the same rule purchase() applies).

   This replaces the 2026-09-25 requirement of a DATABENTO_VERIFIED_CREDIT_USD
   checked within the hour, which nothing in CI could supply. When that
   variable IS set, it still applies as an extra ceiling. */
async function run(windowLabel: string): Promise<void> {
  const w = WINDOWS.find((x) => x.label === windowLabel);
  if (!w) throw new Error(`Unknown window "${windowLabel}". Known: ${WINDOWS.map((x) => x.label).join(", ")}`);

  const key = loadApiKey();
  // The ledger helpers read both from the environment.
  process.env.DATABENTO_API_KEY ??= key;
  process.env.DATABASE_URL ??= loadSecret("DATABASE_URL", "<Neon pooled database URL>");
  const range = await metadata("metadata.get_dataset_range", { dataset: DATASET });
  const availableEnd = range.schemas?.[SCHEMA]?.end ?? range.end;
  if (!availableEnd || Date.parse(w.end) > Date.parse(availableEnd)) throw new Error("Requested data is not yet available for this schema");
  const { createClient, transaction } = await import("@/lib/neon/server");
  const supabase = createClient();

  // Fail before spending anything if the schema is not ready. Without the
  // source column every row would land in the yahoo namespace and overwrite
  // the archive this whole design exists to protect.
  {
    const { error } = await supabase.from("bars_5m").select("source").limit(1);
    if (error)
      throw new Error(
        `bars_5m has no usable "source" column (${error.message}).\n` +
          "Apply db/neon-schema.sql first — " +
          "without it this backfill would overwrite the Yahoo history."
      );
  }

  console.log(`Backfill window "${w.label}": ${w.start} → ${w.end}`);
  console.log(`Symbols: ${SYMBOLS.join(", ")} · writing source='databento'\n`);

  const months = monthBoundaries(w.start, w.end);
  // Cheap, and it is the assumption the whole seam design rests on.
  assertAligned(months);

  /* ── Plan: the chunks still to buy ─────────────────────────────────────── */
  const chunks: { vendorSymbol: string; feed: string; from: Date; to: Date; request: DataRequest; id: string }[] = [];
  for (const vendorSymbol of SYMBOLS) {
    const feed = FEED_SYMBOL[vendorSymbol];
    if (!feed) throw new Error(`No feed symbol mapped for ${vendorSymbol}`);

    // Resume off the data itself rather than a side-car progress file: one
    // less thing to get out of step with reality, and re-running is free.
    const { data: resumeRow, error: resumeErr } = await supabase
      .from("bars_5m")
      .select("time")
      .eq("symbol", feed)
      .eq("source", "databento")
      .order("time", { ascending: false })
      .limit(1);
    if (resumeErr) throw new Error(`resume probe for ${feed}: ${resumeErr.message}`);
    const resumeFrom = resumeRow?.length ? Number(resumeRow[0].time) : null;
    if (resumeFrom !== null) {
      console.log(
        `${feed}: resuming — already have data through ${new Date(resumeFrom * 1000).toISOString()}`
      );
      /* Resume skips any month ending at or before the NEWEST stored bar,
         which is correct when months were filled oldest-first — the normal
         interrupted-run case.

         It is wrong when the window starts before anything stored, because
         those earlier months would be skipped and read back as Databento
         having no data. The test for that is the OLDEST stored bar, not the
         newest: a gap at the front is the failure, and comparing against the
         newest bar would also reject every legitimate resume (the first
         version of this guard did exactly that, and blocked the resume of the
         very run it was written for). */
      const { data: oldestRow, error: oldestErr } = await supabase
        .from("bars_5m")
        .select("time")
        .eq("symbol", feed)
        .eq("source", "databento")
        .order("time", { ascending: true })
        .limit(1);
      if (oldestErr) throw new Error(`oldest probe for ${feed}: ${oldestErr.message}`);
      const oldest = oldestRow?.length ? Number(oldestRow[0].time) : null;
      const windowStart = months[0].from.getTime() / 1000;
      if (oldest !== null && windowStart < oldest) {
        const have = new Date(oldest * 1000).toISOString().slice(0, 10);
        throw new Error(
          `${feed}: window starts ${w.start} but the oldest stored bar is ${have}.\n` +
            `Resume fills forward from the newest bar, so ${w.start} → ${have} would be ` +
            `skipped and read back as missing data.\n` +
            `Either run a window starting at or after ${have}, or clear the namespace:\n` +
            `  delete from public.bars_5m where source = 'databento' and symbol = '${feed}';`
        );
      }
    }

    for (const { from, to } of months) {
      // Skip whole months already stored. `to` rather than `from` so a month
      // that was only partially written is re-fetched and completed.
      if (resumeFrom !== null && to.getTime() / 1000 <= resumeFrom) continue;
      const request = chunkRequest(vendorSymbol, from, to);
      const id = purchaseId(request);
      const prior = await ledgerEntry(id);
      if (prior?.status === "imported") continue; // paid for and stored by an earlier run
      if (prior)
        throw new Error(
          `${feed} ${isoZ(from).slice(0, 7)}: an earlier purchase (${id}) has an uncertain result (status ${prior.status}). ` +
            "Reconcile it against Databento's usage page before re-running. Nothing was bought."
        );
      chunks.push({ vendorSymbol, feed, from, to, request, id });
    }
  }

  /* ── Quote everything first (free); refuse above the remaining credit ── */
  const fills: RollFillPlan[] = [];
  const fillQuotes: number[] = [];
  for (const p of rollFillPlans(w.start, w.end)) {
    const prior = await ledgerEntry(purchaseId(p.request));
    if (prior?.status === "imported") continue;
    fills.push(p);
    if (!prior) fillQuotes.push(await quoteCost(p.request));
  }
  const quotes = new Map<string, number>();
  for (const c of chunks) quotes.set(c.id, await quoteCost(c.request));
  const budget = budgetCheck([...quotes.values(), ...fillQuotes], await ledgerUsed());
  console.log(
    `Quote: ${chunks.length} monthly chunk(s) ${fmtUsd([...quotes.values()].reduce((a, b) => a + b, 0))}` +
      ` + ${fillQuotes.length} roll-day fill(s) ${fmtUsd(fillQuotes.reduce((a, b) => a + b, 0))};` +
      ` with the ${RESERVE_FACTOR}x reserve ${fmtUsd(budget.reserve)} of ${fmtUsd(budget.remaining)} remaining (cap ${fmtUsd(budget.cap)}).`
  );
  if (!budget.fits)
    throw new Error("REFUSED: this run's quote plus the 25% reserve exceeds the remaining attested credit. Nothing was bought.");
  const verifiedCredit = Number(process.env.DATABENTO_VERIFIED_CREDIT_USD);
  if (process.env.DATABENTO_VERIFIED_CREDIT_USD && (!Number.isFinite(verifiedCredit) || budget.reserve > verifiedCredit))
    throw new Error("REFUSED: quote plus 25% reserve exceeds DATABENTO_VERIFIED_CREDIT_USD. Nothing was bought.");
  const size = await transaction((c) => c.query("SELECT pg_database_size(current_database()) AS bytes"));
  const projected = chunks.reduce((n, c) => n + projectStorage(isoZ(c.from), isoZ(c.to), 1).bytes, 0);
  if (Number(size.rows[0].bytes) + projected > NEON_FREE_TIER_BYTES)
    throw new Error(
      `Import would exceed the existing storage budget (${fmtBytes(Number(size.rows[0].bytes))} now + ~${fmtBytes(projected)} projected > ` +
        `${fmtBytes(NEON_FREE_TIER_BYTES)}); no download started. Run fewer symbols or a shorter window.`
    );

  /* ── Buy and store, one ledger row per chunk ─────────────────────────── */
  const knownSundayGaps: string[] = [];
  const unexpectedGaps: string[] = [];
  let totalRows = 0;
  for (const { vendorSymbol, feed, from, to, request, id } of chunks) {
    await reserveBudget(request, quotes.get(id)!, projectStorage(isoZ(from), isoZ(to), 1).bytes);
    const csv = await fetchOhlcv1mCsv(key, request);
    const bars = bars5mFromOhlcv1mCsv(csv, { rawPrices: false }, vendorSymbol);

    // Trim the overlap tail: bars at or past `to` belong to the next chunk,
    // which will fetch them with their full complement of minutes.
    const inChunk = bars.filter((b) => b.time < to.getTime() / 1000);

    for (const day of emptyDayKeys(inChunk, from, to)) {
      const daySec = Date.parse(`${day}T12:00:00Z`) / 1000;
      // Saturday has no session at all, so it is not a gap and never gets
      // listed. Sunday IS a session (the Globex reopen) that Databento's
      // continuous feed is known to omit, so it is counted and reported.
      if (isUtcSaturday(daySec)) continue;
      if (isUtcSunday(daySec)) knownSundayGaps.push(`${feed} ${day}`);
      else unexpectedGaps.push(`${feed} ${day}`);
    }

    for (let i = 0; i < inChunk.length; i += UPSERT_CHUNK) {
      const rows = inChunk.slice(i, i + UPSERT_CHUNK).map((b) => ({
        symbol: feed,
        source: "databento",
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      }));
      const { error } = await supabase
        .from("bars_5m")
        .upsert(rows, { onConflict: "symbol,source,time" });
      if (error) throw new Error(`bars_5m upsert ${feed} ${isoZ(from)}: ${error.message}`);
    }
    await markImported(id, { kind: "monthly-backfill", feed, bars: inChunk.length, first: inChunk[0]?.time, last: inChunk.at(-1)?.time });
    totalRows += inChunk.length;
    console.log(
      `${feed} ${isoZ(from).slice(0, 7)}: ${inChunk.length} 5m bars (running total ${totalRows})`
    );
  }

  console.log(`\nDone. ${totalRows} rows written as source='databento'.`);

  /* Quarterly expiry days: `.c.0` has no prices after the 09:30 ET settlement.
     After the months are in, buy the next contract for exactly those bars;
     each fill is its own ledger row and is printed as a substitution. */
  const filled = [];
  for (const p of fills) filled.push(await importRollFill(p.root, p.expiry));
  if (filled.length) console.log(`\nRoll-day fills: ${JSON.stringify(filled)}`);

  /* The known Databento issue is Sunday-shaped, so Sunday gaps are reported
     and moved on from. Anything else is either a CME holiday or a real hole,
     and only a human can tell which — so it is listed rather than swallowed.
     Neither case fails the run: a partial backfill that says exactly what it
     is missing beats one that exits 1 and tells you nothing. */
  if (knownSundayGaps.length)
    console.log(
      `\n${knownSundayGaps.length} empty UTC Sunday(s) — expected, ${DATABENTO_SUNDAY_GAP}.\n` +
        "  Databento's continuous-contract feed has returned no Sunday data since 2026-05-17."
    );
  if (unexpectedGaps.length) {
    console.log(`\n⚠ ${unexpectedGaps.length} empty NON-Sunday day(s) — check these:`);
    for (const g of unexpectedGaps.slice(0, 40)) console.log(`    ${g}`);
    if (unexpectedGaps.length > 40) console.log(`    …and ${unexpectedGaps.length - 40} more`);
    console.log("  Most will be CME holidays. Any that are not are real holes.");
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  if (args.has("--estimate")) {
    await estimate();
    return;
  }
  if (args.has("--run")) {
    const idx = argv.indexOf("--window");
    const label = idx >= 0 ? argv[idx + 1] : undefined;
    if (!label)
      throw new Error(
        "--run needs an explicit --window <label>. There is no default: the pull\n" +
          "spends credit, so the window is always a stated decision.\n" +
          `Known windows: ${WINDOWS.map((x) => x.label).join(", ")}`
      );
    await run(label);
    return;
  }
  console.error(
    "Usage:\n" +
      "  npx tsx scripts/engine/databento-backfill.ts --estimate\n" +
      "  npx tsx scripts/engine/databento-backfill.ts --run --window <label>\n\n" +
      `Windows: ${WINDOWS.map((x) => x.label).join(", ")}\n` +
      "--estimate spends nothing. --run spends credit."
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
