/* Quarterly-expiry roll-day fill for the CME equity-index micros.
   ─────────────────────────────────────────────────────────────────────────
   THE GAP. Equity-index futures (MES, MNQ, M2K, MYM) expire quarterly — March,
   June, September, December — and the expiring contract STOPS TRADING at the
   09:30 ET open on expiry day, because its final settlement is the index's
   opening print. The rest of that day's session trades only in the next
   quarterly contract.

   Databento's `.c.0` continuous symbol resolves the "nearest expiry" contract
   per UTC date, so on expiry day it still points at the contract that has just
   stopped. Measured 2026-09-18 (docs/research/2026-09-25-contract-quality.json):
   both MES and MNQ have no five-minute bars from 13:25 to 19:20 UTC — 72 bars
   each — and `.c.0` only moves to MESZ6/MNQZ6 at 2026-09-21 00:00 UTC. That
   blocks qualification (scripts/diag/contract-quality.ts) and recurs every
   quarter: 2026-12-18 next.

   THE FILL. For an expiry day, buy the NEXT quarterly contract by raw symbol
   (e.g. MESZ6 for the September 2026 expiry) from 09:25 ET to the session
   flatten and insert ONLY the five-minute bars the continuous series is missing.
   09:25 rather than 09:30: the expiring contract's last bucket (09:25-09:30)
   can never be proven closed — no later minute ever prints — so the
   aggregator drops it, and that is the first missing bar.

   It is a substitution, and it is reported as one: every fill is its own
   ledger row in private_research.data_purchases with a report naming the
   contract and the exact bars it supplied, and contract-quality.ts lists the
   fills separately from the daily requests. Bars that already exist are never
   overwritten.

   Times come from the NY-time helpers (import only — lib/time and lib/market
   are inside the research-code hash), so the 09:25 ET start is 13:25 UTC in
   summer and 14:25 UTC in winter without a hardcoded offset. */

import { NY_FLAT_BY_MIN, nyMeta, nyTimeToUnix } from "@/lib/time/ny";
import { flattenMinuteNy, holidayFor } from "@/lib/market/holidays";
import { CHUNK_TAIL_SEC } from "./databento";

/** Equity-index roots that follow the quarterly third-Friday expiry. Gold and
    silver list monthly with different last-trade rules and are NOT covered. */
export const EQUITY_INDEX_ROOTS = ["MES", "MNQ", "M2K", "MYM"] as const;
export type EquityIndexRoot = (typeof EQUITY_INDEX_ROOTS)[number];

export function isEquityIndexRoot(value: string): value is EquityIndexRoot {
  return (EQUITY_INDEX_ROOTS as readonly string[]).includes(value);
}

/** CME month codes for the quarterly cycle. */
export const QUARTERLY_MONTH_CODES: Readonly<Record<number, string>> = Object.freeze({ 3: "H", 6: "M", 9: "U", 12: "Z" });

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** The third Friday of `month` (1-12) as a NY calendar date 'YYYY-MM-DD'. */
export function thirdFriday(year: number, month: number): string {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstFriday = 1 + ((5 - firstWeekday + 7) % 7);
  return `${year}-${pad(month)}-${pad(firstFriday + 14)}`;
}

/* The scheduled last trading day for the quarterly contract of `month`.

   Normally the third Friday. When that Friday is an exchange holiday the
   final settlement moves to the preceding business day (CME equity-index
   rule: the settlement is the index's opening quotation, which needs the
   stock market open). Only two holidays can land on a quarterly third Friday
   — Good Friday (March) and Juneteenth (June; 2026-06-19 and 2027-06-18 are
   both third Fridays) — and lib/market/holidays.ts lists both, so ANY listed
   holiday on that date steps back. Verify against CME's published last-trade
   dates when the holiday table is extended. */
export function quarterlyExpiryDay(year: number, month: number): string {
  if (!QUARTERLY_MONTH_CODES[month]) throw new Error(`${year}-${pad(month)} is not a quarterly expiry month`);
  let ms = Date.parse(`${thirdFriday(year, month)}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const key = keyOf(ms);
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidayFor(key)) return key;
    ms -= 86_400_000;
  }
  throw new Error(`No business day found before the third Friday of ${year}-${pad(month)}`);
}

/** True when `dateKey` (NY date) is an equity-index quarterly expiry day. */
export function isQuarterlyExpiryDay(dateKey: string): boolean {
  const [year, month] = dateKey.split("-").map(Number);
  return !!QUARTERLY_MONTH_CODES[month] && quarterlyExpiryDay(year, month) === dateKey;
}

/** Every quarterly expiry day in [fromKey, toKey) — NY dates, toKey exclusive. */
export function expiryDaysBetween(fromKey: string, toKey: string): string[] {
  const [fy] = fromKey.split("-").map(Number);
  const [ty] = toKey.split("-").map(Number);
  const out: string[] = [];
  for (let year = fy; year <= ty; year++)
    for (const month of [3, 6, 9, 12]) {
      const day = quarterlyExpiryDay(year, month);
      if (day >= fromKey && day < toKey) out.push(day);
    }
  return out;
}

/** Raw CME symbol, single-digit year as Globex lists it: MESZ6, MNQH7. */
export function contractSymbol(root: string, year: number, month: number): string {
  const code = QUARTERLY_MONTH_CODES[month];
  if (!code) throw new Error(`${year}-${pad(month)} is not a quarterly contract month`);
  return `${root}${code}${year % 10}`;
}

/** The contract that becomes the front month once the contract expiring in
    `expiryDateKey`'s month has stopped: Sep 2026 → Z6, Dec 2026 → H7. */
export function nextQuarterlyContract(root: string, expiryDateKey: string): string {
  const [year, month] = expiryDateKey.split("-").map(Number);
  if (!QUARTERLY_MONTH_CODES[month]) throw new Error(`${expiryDateKey} is not in a quarterly expiry month`);
  return month === 12 ? contractSymbol(root, year + 1, 3) : contractSymbol(root, year, month + 3);
}

/** Splits 'MESZ6' into its root, contract month and year digit, or null. */
export function parseContractSymbol(symbol: string): { root: EquityIndexRoot; month: number; yearDigit: number } | null {
  const m = /^(MES|MNQ|M2K|MYM)([HMUZ])(\d)$/.exec(symbol);
  if (!m) return null;
  const month = Number(Object.entries(QUARTERLY_MONTH_CODES).find(([, code]) => code === m[2])![0]);
  return { root: m[1] as EquityIndexRoot, month, yearDigit: Number(m[3]) };
}

/** 09:25 ET, in NY minutes: the first bucket the expiring contract cannot close. */
export const ROLL_FILL_FROM_MIN = 9 * 60 + 25;

/** [fromSec, toSec) of five-minute bucket starts the fill may supply: 09:25 ET
    to the day's flatten (15:25 ET, or five minutes before an early close). */
export function rollFillWindow(dateKey: string): { fromSec: number; toSec: number } {
  return {
    fromSec: nyTimeToUnix(dateKey, ROLL_FILL_FROM_MIN),
    toSec: nyTimeToUnix(dateKey, flattenMinuteNy(dateKey, NY_FLAT_BY_MIN)),
  };
}

/** Same shape as scripts/engine/databento-purchase.ts DataRequest. */
export interface RollFillRequest {
  dataset: string;
  schema: string;
  stype_in: string;
  symbols: string;
  start: string;
  end: string;
}

export interface RollFillPlan {
  root: EquityIndexRoot;
  /** The continuous series the fill patches, as stored in bars_5m.symbol. */
  continuous: string;
  expiry: string;
  contract: string;
  window: { fromSec: number; toSec: number };
  request: RollFillRequest;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** The purchase that fills `root`'s expiry-day gap, or null when `dateKey` is
    not a quarterly expiry day. The request runs CHUNK_TAIL_SEC past the
    window so the last bucket has a later minute proving it closed (the same
    rule lib/data/databento.ts applies to every chunk). */
export function rollFillPlan(root: string, dateKey: string): RollFillPlan | null {
  if (!isEquityIndexRoot(root)) throw new Error(`${root} is not a quarterly equity-index root (${EQUITY_INDEX_ROOTS.join(", ")})`);
  if (!isQuarterlyExpiryDay(dateKey)) return null;
  const window = rollFillWindow(dateKey);
  const contract = nextQuarterlyContract(root, dateKey);
  return {
    root,
    continuous: `${root}.c.0`,
    expiry: dateKey,
    contract,
    window,
    request: {
      dataset: "GLBX.MDP3",
      schema: "ohlcv-1m",
      stype_in: "raw_symbol",
      symbols: contract,
      start: iso(window.fromSec),
      end: iso(window.toSec + CHUNK_TAIL_SEC),
    },
  };
}

/** Recognises a purchase-ledger request as a roll fill this module would have
    issued, or returns null. Anything raw-symbol that does NOT match exactly is
    not a roll fill and must be reported, never quietly accepted. */
export function matchRollFill(request: Partial<RollFillRequest> | null | undefined): RollFillPlan | null {
  if (!request || request.stype_in !== "raw_symbol" || typeof request.symbols !== "string" || typeof request.start !== "string") return null;
  const parsed = parseContractSymbol(request.symbols);
  const startMs = Date.parse(request.start);
  if (!parsed || !Number.isFinite(startMs)) return null;
  const dateKey = nyMeta(startMs / 1000).dateKey;
  const plan = isQuarterlyExpiryDay(dateKey) ? rollFillPlan(parsed.root, dateKey) : null;
  if (!plan) return null;
  const want = plan.request;
  const same = (Object.keys(want) as (keyof RollFillRequest)[]).every((k) => request[k] === want[k]);
  return same ? plan : null;
}
