"use client";

/* The recorded trade ideas, read once for the whole app.

   One provider instead of one read per screen: switching tabs no longer
   flashes "Loading trade ideas…", and the last good read is kept for the
   session so a reload paints at once (marked with when it was read).

   liveOnly at the read boundary (lib/signals/live.ts): rows from before the
   bot went live and rows the engine reconciled as orphaned never reach a
   headline. Orphaned rows are kept separately for the researchers' drawer.
   Refreshes every minute while visible, when the app comes back to the front,
   on pull-to-refresh, and whenever the header's refresh bumps the health
   `revision`. A failed refresh keeps the previous snapshot and says so. */

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getNeon, type SignalRow } from "@/lib/neon/client";
import { readSignalRows } from "@/lib/signals/snapshot";
import { liveOnly } from "@/lib/signals/live";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { readCache, useLiveRefresh, writeCache } from "@/lib/hooks/useLiveRefresh";

const REFRESH_MS = 60_000;
const CACHE_KEY = "aegis.signals.v1";

export interface SignalFeed {
  rows: SignalRow[];
  orphaned: SignalRow[];
  loading: boolean;
  /** The last refresh failed; `rows` (if any) are from an earlier read. */
  failed: boolean;
  /** Epoch ms of the read the rows came from. */
  loadedAt: number | null;
  refresh: () => void;
}

const FeedContext = createContext<SignalFeed>({ rows: [], orphaned: [], loading: true, failed: false, loadedAt: null, refresh: () => {} });

export function SignalFeedProvider({ children }: { children: React.ReactNode }) {
  const { revision } = useBotHealth();
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [orphaned, setOrphaned] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const all = await readSignalRows(getNeon());
      const live = liveOnly(all);
      setRows(live);
      setOrphaned(all.filter((s) => s.orphaned));
      setFailed(false);
      setLoadedAt(Date.now());
      writeCache(CACHE_KEY, { rows: live, orphaned: all.filter((s) => s.orphaned) });
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCache<{ rows: SignalRow[]; orphaned: SignalRow[] }>(CACHE_KEY);
    if (cached) {
      setRows(cached.value.rows);
      setOrphaned(cached.value.orphaned);
      setLoadedAt(cached.at);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);
  useLiveRefresh(() => void load(), REFRESH_MS);

  return createElement(FeedContext.Provider, { value: { rows, orphaned, loading, failed, loadedAt, refresh: () => void load() } }, children);
}

export function useSignalFeed(): SignalFeed {
  return useContext(FeedContext);
}

/** Unix seconds that tick once a minute — null until mounted so SSR and hydration agree. */
export function useNowSec(stepMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
