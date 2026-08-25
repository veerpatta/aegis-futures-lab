"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Bar } from "@/lib/types";
import { FEED_SYMBOLS, type FeedSymbol } from "@/lib/market/contracts";
import {
  fetchEvents,
  fetchHistory,
  eventTimesSec,
  type CalendarEvent,
  type HistoryPayload,
} from "@/lib/data/fetch";

export interface FeedState {
  status: "idle" | "loading" | "ready" | "error";
  bars: Bar[];
  error?: string;
  fetchedAt?: string;
  lastTimestamp?: string;
  source?: string;
}

export interface ImportedSeries {
  label: string;
  pointValue: number;
  bars: Bar[]; // raw import (may be 1m); aggregated by consumers as needed
  importedAt: number;
}

interface DataContextValue {
  history: Record<FeedSymbol, FeedState>;
  /** Load only the feeds the mounted surface needs. Concurrent callers dedupe per symbol. */
  ensureHistory: (symbols: readonly FeedSymbol[]) => void;
  reloadHistory: () => void;
  events: CalendarEvent[];
  eventsSource: string | null;
  newsTimes: number[];
  imported: ImportedSeries | null;
  setImported: (s: ImportedSeries | null) => void;
  replayCutoff: number | null; // unix sec — when set, "now" for readouts/forward test
  setReplayCutoff: (t: number | null) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

const EMPTY: FeedState = { status: "idle", bars: [] };

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<Record<FeedSymbol, FeedState>>(
    () => Object.fromEntries(FEED_SYMBOLS.map((s) => [s, EMPTY])) as Record<FeedSymbol, FeedState>
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsSource, setEventsSource] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedSeries | null>(null);
  const [replayCutoff, setReplayCutoff] = useState<number | null>(null);
  const requestedRef = useRef<Set<FeedSymbol>>(new Set());
  const inFlightRef = useRef<Partial<Record<FeedSymbol, Promise<void>>>>({});
  const statusRef = useRef<Record<FeedSymbol, FeedState["status"]>>(
    Object.fromEntries(FEED_SYMBOLS.map((symbol) => [symbol, "idle"])) as Record<
      FeedSymbol,
      FeedState["status"]
    >
  );

  const loadSymbols = useCallback((symbols: readonly FeedSymbol[], force = false) => {
    for (const symbol of new Set(symbols)) {
      requestedRef.current.add(symbol);
      if (inFlightRef.current[symbol]) continue;
      if (!force && statusRef.current[symbol] === "ready") continue;
      statusRef.current[symbol] = "loading";
      setHistory((h) => ({ ...h, [symbol]: { ...h[symbol], status: "loading" } }));
      const request = fetchHistory(symbol)
        .then((payload: HistoryPayload) => {
          statusRef.current[symbol] = "ready";
          setHistory((h) => ({
            ...h,
            [symbol]: {
              status: "ready",
              bars: payload.bars,
              fetchedAt: payload.fetchedAt,
              lastTimestamp: payload.lastTimestamp,
              source: payload.source,
            },
          }));
        })
        .catch((error: Error) => {
          statusRef.current[symbol] = "error";
          setHistory((h) => ({
            ...h,
            [symbol]: { status: "error", bars: [], error: error.message },
          }));
        })
        .finally(() => {
          delete inFlightRef.current[symbol];
        });
      inFlightRef.current[symbol] = request;
    }
  }, []);

  const ensureHistory = useCallback(
    (symbols: readonly FeedSymbol[]) => loadSymbols(symbols),
    [loadSymbols]
  );

  const reloadHistory = useCallback(() => {
    loadSymbols([...requestedRef.current], true);
  }, [loadSymbols]);

  useEffect(() => {
    fetchEvents()
      .then((p) => {
        setEvents(p.events);
        setEventsSource(p.source);
      })
      .catch(() => setEventsSource(null));
    const id = setInterval(reloadHistory, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [reloadHistory]);

  const newsTimes = useMemo(() => eventTimesSec(events), [events]);

  const value = useMemo(
    () => ({
      history,
      ensureHistory,
      reloadHistory,
      events,
      eventsSource,
      newsTimes,
      imported,
      setImported,
      replayCutoff,
      setReplayCutoff,
    }),
    [history, ensureHistory, reloadHistory, events, eventsSource, newsTimes, imported, replayCutoff]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}
