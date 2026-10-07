"use client";

/* The trial account for every screen: one read of `trial_overview`, refreshed
   with the rest of the app (lib/hooks/useLiveRefresh.ts) and kept for the
   session so Today paints at once. `decisionFor` answers the Ideas tab's
   question "what did the trial do with this idea?". */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { normaliseOverview, type TrialDecisionRow, type TrialOverview } from "@/lib/trial/overview";
import { readCache, useLiveRefresh, writeCache } from "@/lib/hooks/useLiveRefresh";

const CACHE_KEY = "aegis.trial.v1";

interface TrialState {
  data: TrialOverview | null;
  loading: boolean;
  failed: boolean;
  loadedAt: number | null;
  refresh: () => void;
  decisionFor: (signalKey: string) => TrialDecisionRow | null;
}

const Context = createContext<TrialState>({ data: null, loading: true, failed: false, loadedAt: null, refresh: () => {}, decisionFor: () => null });

export function TrialProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<TrialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await getNeon().from("trial_overview").select("*").limit(1);
      if (res.error) throw new Error(res.error.message);
      const next = normaliseOverview((res.data?.[0] ?? null) as Record<string, unknown> | null);
      if (!next?.account) throw new Error("Trial account missing");
      setData(next);
      setFailed(false);
      setLoadedAt(Date.now());
      writeCache(CACHE_KEY, next);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCache<TrialOverview>(CACHE_KEY);
    if (cached) {
      setData(cached.value);
      setLoadedAt(cached.at);
      setLoading(false);
    }
    void refresh();
  }, [refresh]);
  useLiveRefresh(() => void refresh());

  const byKey = useMemo(() => {
    const map = new Map<string, TrialDecisionRow>();
    for (const d of data?.decisions ?? []) {
      const prev = map.get(d.signal_key);
      if (!prev || d.round > prev.round) map.set(d.signal_key, d);
    }
    return map;
  }, [data]);
  const decisionFor = useCallback((key: string) => byKey.get(key) ?? null, [byKey]);

  return (
    <Context.Provider value={{ data, loading, failed, loadedAt, refresh: () => void refresh(), decisionFor }}>{children}</Context.Provider>
  );
}

export const useTrial = () => useContext(Context);
