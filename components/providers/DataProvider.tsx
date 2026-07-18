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
import type { FeedSymbol } from "@/lib/market/contracts";
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
  const [history, setHistory] = useState<Record<FeedSymbol, FeedState>>({
    MES: EMPTY,
    MNQ: EMPTY,
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsSource, setEventsSource] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedSeries | null>(null);
  const [replayCutoff, setReplayCutoff] = useState<number | null>(null);
  const loadingRef = useRef(false);

  const loadHistory = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    (["MES", "MNQ"] as FeedSymbol[]).forEach((symbol) => {
      setHistory((h) => ({ ...h, [symbol]: { ...h[symbol], status: "loading" } }));
      fetchHistory(symbol)
        .then((payload: HistoryPayload) => {
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
          setHistory((h) => ({
            ...h,
            [symbol]: { status: "error", bars: [], error: error.message },
          }));
        });
    });
    loadingRef.current = false;
  }, []);

  useEffect(() => {
    loadHistory();
    fetchEvents()
      .then((p) => {
        setEvents(p.events);
        setEventsSource(p.source);
      })
      .catch(() => setEventsSource(null));
    const id = setInterval(loadHistory, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadHistory]);

  const newsTimes = useMemo(() => eventTimesSec(events), [events]);

  const value = useMemo(
    () => ({
      history,
      reloadHistory: loadHistory,
      events,
      eventsSource,
      newsTimes,
      imported,
      setImported,
      replayCutoff,
      setReplayCutoff,
    }),
    [history, loadHistory, events, eventsSource, newsTimes, imported, replayCutoff]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}
