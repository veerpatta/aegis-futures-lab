import type { Bar } from "@/lib/types";
import type { FeedSymbol } from "@/lib/market/contracts";

export interface HistoryPayload {
  symbol: string;
  mode: string;
  delayed: boolean;
  source: string;
  session: string;
  range: string;
  interval: string;
  fetchedAt: string;
  firstTimestamp: string;
  lastTimestamp: string;
  bars: Bar[];
}

export interface MarketPayload {
  symbol: string;
  mode: string;
  delayed: boolean;
  source: string;
  price: number;
  previousClose: number;
  change: number;
  fetchedAt: string;
  dataTimestamp: string;
  bars: Bar[];
}

export interface CalendarEvent {
  name: string;
  time: string; // ISO
  publisher: string;
  note: string;
}

export interface EventsPayload {
  source: string;
  verified: boolean;
  coverage: string[];
  limitation: string;
  events: CalendarEvent[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? `${(body as { error?: string }).error}: ${(body as { detail?: string }).detail}`
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return body as T;
}

export const fetchHistory = (symbol: FeedSymbol) =>
  getJson<HistoryPayload>(`/api/history?symbol=${symbol}`);
export const fetchMarket = (symbol: FeedSymbol) =>
  getJson<MarketPayload>(`/api/market?symbol=${symbol}`);
export const fetchEvents = () => getJson<EventsPayload>("/api/events");

export function eventTimesSec(events: CalendarEvent[]): number[] {
  return events.map((e) => Math.floor(new Date(e.time).getTime() / 1000));
}
