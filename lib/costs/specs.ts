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
 *   - MGC, SIL and SI are NOT tradable in this application. There is no gold
 *     or silver data feed, no FeedSymbol entry, and no measured result. Their
 *     figures are transcribed from the research brief and have not been
 *     checked against a CME contract page. They ship `verified: false` and
 *     `tradable: false`, and tests/costs.test.ts asserts a non-tradable symbol
 *     cannot reach the engine. Do not flip either flag without attaching a
 *     citation to `source`.
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
    tradable: false,
    verified: false,
    source: FROM_BRIEF_UNVERIFIED,
  },
  SIL: {
    symbol: "SIL",
    label: "Micro Silver",
    exchange: "COMEX",
    tickSize: 0.005,
    tickValue: 5,
    pointValue: 1000,
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
