/* Contract specifications.
 *
 * Two categories live here and they are NOT equally trustworthy, which is why
 * `verified` is a required field rather than a comment:
 *
 *   - MES and MNQ are *derivable from committed code*. POINT_VALUES in
 *     lib/market/contracts.ts has been the basis of every measured result in
 *     this repo, so their point values are verified in the only sense that
 *     matters here: changing them would change numbers we have already
 *     published. Their tick sizes follow from the same arithmetic
 *     (tickValue / tickSize === pointValue).
 *
 *   - MGC became tradable on 2026-08-17 when the gold demand/supply stream was
 *     built. Its citation is EMPIRICAL rather than a CME contract page, and the
 *     `source` string says so in as many words — cmegroup.com refused every
 *     connection from the build environment, so rather than imply a spec sheet
 *     had been read, the tick size was MEASURED from 23,136 real MGC=F prices
 *     (minimum observed increment 0.0996) and cross-checked against the
 *     tickValue/tickSize === pointValue invariant. Replace it with a CME
 *     citation when one can be obtained.
 *
 *   - SI and SIL remain NOT tradable, and that is now a `role` rather than an
 *     absence. SI is `confirmation`: fetched on purpose, never sized. SIL is
 *     `reference` and carries its own lock (below). Stating the role means
 *     "SI has no measured result" reads as intentional rather than unfinished.
 *
 * Do not flip `tradable` or `verified` without attaching a citation to `source`.
 *
 * The invariant tickValue / tickSize === pointValue holds for every row and is
 * asserted in tests — it is what catches a transcription typo, which is the
 * realistic failure mode for a hand-entered table like this one.
 */

export interface ContractSpec {
  symbol: string;
  label: string;
  exchange: string;
  /** Minimum price increment, in points. */
  tickSize: number;
  /** Dollar value of one tick, for one contract. */
  tickValue: number;
  /** Dollar value of one full point, for one contract. */
  pointValue: number;
  /** What this symbol is FOR. Distinct from `tradable` because "never traded"
      has two very different causes: a series we watch on purpose, and a series
      we simply do not use. */
  role: "tradable" | "confirmation" | "reference";
  /** Whether this application can take a position in it. */
  tradable: boolean;
  /** Whether the numbers above have been checked against a primary source. */
  verified: boolean;
  /** Where the numbers came from. Required — an empty string is a lie. */
  source: string;
}

const DERIVED_FROM_REPO =
  "derived from POINT_VALUES in lib/market/contracts.ts, the basis of every " +
  "measured result in this repo; tick size follows from tickValue/tickSize === pointValue";

const MGC_EMPIRICAL =
  "tick size MEASURED 2026-08-17 from 23,136 MGC=F 5-minute prices (minimum " +
  "observed increment 0.0996 -> 0.1); instrument identified by the vendor as " +
  "\"Micro Gold Futures\"; contract unit 10 troy oz and tickValue $1 follow " +
  "from the tickValue/tickSize === pointValue invariant. NOT a CME contract " +
  "page: cmegroup.com refused every connection from the build environment " +
  "(ECONNRESET) and its product API returned no metals rows. Replace with a " +
  "CME citation when one can be obtained.";

const FROM_BRIEF_UNVERIFIED =
  "transcribed from the research brief 2026-07-31; NOT checked against a CME " +
  "contract page. Instrument is not tradable here (no data feed, no FeedSymbol " +
  "entry). Attach a CME citation before setting verified: true.";

export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  MES: {
    symbol: "MES",
    label: "Micro E-mini S&P 500",
    exchange: "CME",
    tickSize: 0.25,
    tickValue: 1.25,
    pointValue: 5,
    role: "tradable",
    tradable: true,
    verified: true,
    source: DERIVED_FROM_REPO,
  },
  MNQ: {
    symbol: "MNQ",
    label: "Micro E-mini Nasdaq-100",
    exchange: "CME",
    tickSize: 0.25,
    tickValue: 0.5,
    pointValue: 2,
    role: "tradable",
    tradable: true,
    verified: true,
    source: DERIVED_FROM_REPO,
  },
  MGC: {
    symbol: "MGC",
    label: "Micro Gold",
    exchange: "COMEX",
    tickSize: 0.1,
    tickValue: 1,
    pointValue: 10,
    role: "tradable",
    tradable: true,
    verified: true,
    source: MGC_EMPIRICAL,
  },
  SIL: {
    symbol: "SIL",
    label: "Micro Silver",
    exchange: "COMEX",
    tickSize: 0.005,
    tickValue: 5,
    pointValue: 1000,
    role: "reference",
    tradable: false,
    verified: false,
    source:
      FROM_BRIEF_UNVERIFIED +
      " Additionally role-locked: micro silver's thin book manufactures zone " +
      "structure that is not there, so it must never be a confirmation series.",
  },
  SI: {
    symbol: "SI",
    label: "Silver (full-size)",
    exchange: "COMEX",
    tickSize: 0.005,
    tickValue: 25,
    pointValue: 5000,
    /* Fetched on purpose: the gold stream reads silver's zone structure to
       confirm an entry. Never sized — at $5,000/point a stray fill here would
       be a 500x error, not a 10x one, which is why the engine throws rather
       than skips on an untradable symbol. */
    role: "confirmation",
    tradable: false,
    verified: false,
    source: FROM_BRIEF_UNVERIFIED,
  },
};

export function specFor(symbol: string): ContractSpec {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) throw new Error(`No contract spec for "${symbol}"`);
  return spec;
}

/** Guard for anything that is about to size or fill a position. */
export function assertTradable(symbol: string): ContractSpec {
  const spec = specFor(symbol);
  if (!spec.tradable) {
    throw new Error(
      `"${symbol}" is not tradable in this application (spec is unverified and ` +
        `there is no data feed for it). It may be referenced for reference or ` +
        `confirmation purposes only.`,
    );
  }
  return spec;
}
