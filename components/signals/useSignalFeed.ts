"use client";

/* The recorded trade ideas, read once per screen the same way everywhere.

   liveOnly at the read boundary (lib/signals/live.ts): rows from before the
   bot went live and rows the engine reconciled as orphaned never reach a
   headline. Orphaned rows are kept separately for the researchers' drawer.
   Refreshes every minute and whenever the header's refresh bumps the health
   `revision`. A failed refresh keeps the previous snapshot and says so. */

import { useCallback, useEffect, useState } from "react";
import { getNeon, type SignalRow } from "@/lib/neon/client";
import { readSignalRows } from "@/lib/signals/snapshot";
import { liveOnly } from "@/lib/signals/live";
import { useBotHealth } from "@/components/providers/BotHealthProvider";

const REFRESH_MS = 60_000;

export interface SignalFeed {
  rows: SignalRow[];
  orphaned: SignalRow[];
  loading: boolean;
  /** The last refresh failed; `rows` (if any) are from an earlier read. */
  failed: boolean;
  loadedAt: number | null;
  refresh: () => void;
}

export function useSignalFeed(): SignalFeed {
  const { revision } = useBotHealth();
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [orphaned, setOrphaned] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await readSignalRows(getNeon());
      setRows(liveOnly(all));
      setOrphaned(all.filter((s) => s.orphaned));
      setFailed(false);
      setLoadedAt(Date.now());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, revision]);

  return { rows, orphaned, loading, failed, loadedAt, refresh: load };
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
