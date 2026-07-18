export type FeedSymbol = "MES" | "MNQ";

export const YAHOO_SYMBOLS: Record<FeedSymbol, string> = {
  MES: "MES=F",
  MNQ: "MNQ=F",
};

export const POINT_VALUES: Record<FeedSymbol, number> = {
  MES: 5,
  MNQ: 2,
};

export const CONTRACT_LABELS: Record<FeedSymbol, string> = {
  MES: "Micro E-mini S&P 500",
  MNQ: "Micro E-mini Nasdaq-100",
};

export function isFeedSymbol(value: string): value is FeedSymbol {
  return value === "MES" || value === "MNQ";
}
