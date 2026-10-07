"use client";

/* The experimental learner for every screen: one read of `experiment_overview`
   (the "learner" lineage), refreshed with the rest of the app while the page
   is visible (lib/hooks/useLiveRefresh.ts — a hidden tab never polls, so a
   visitor cannot keep the database awake).

   The last good read is kept on the device with its time, so an offline phone
   shows a visibly dated snapshot instead of nothing. It holds only public
   simulation figures — nothing private (the journal is never cached here).
   `decisionFor` answers the Ideas tab's question "what did the learner do with
   this idea?". */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { useLiveRefresh } from "@/lib/hooks/useLiveRefresh";
import type { ExpOverview } from "@/lib/experiment/view";

const SNAPSHOT_KEY = "aegis.experiment.v1";
export const EXPERIMENT_LINEAGE = "learner";

type Decision = ExpOverview["recent_decisions"][number];

interface ExperimentState {
  data: ExpOverview | null;
  loading: boolean;
  failed: boolean;
  /** Epoch ms of the figures on screen (from the network or the saved snapshot). */
  loadedAt: number | null;
  fromSnapshot: boolean;
  online: boolean;
  refresh: () => void;
  decisionFor: (opportunityKey: string) => Decision | null;
}

const Context = createContext<ExperimentState>({
  data: null, loading: true, failed: false, loadedAt: null, fromSnapshot: false, online: true, refresh: () => {}, decisionFor: () => null,
});

function readSnapshot(): { at: number; value: ExpOverview } | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: ExpOverview };
    return Number.isFinite(parsed.at) && parsed.value?.experiment ? parsed : null;
  } catch {
    return null;
  }
}

export function ExperimentProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ExpOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [fromSnapshot, setFromSnapshot] = useState(false);
  const [online, setOnline] = useState(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOnline(false);
      setLoading(false);
      return;
    }
    busy.current = true;
    try {
      const res = await getNeon().from("experiment_overview").select("*").eq("lineage", EXPERIMENT_LINEAGE).limit(1);
      if (res.error) throw new Error(res.error.message);
      const row = (res.data?.[0] ?? null) as ExpOverview | null;
      setData(row);
      setFailed(false);
      setFromSnapshot(false);
      setLoadedAt(Date.now());
      if (row) {
        try {
          localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), value: row }));
        } catch {
          /* storage blocked — the screen still works, just without an offline copy */
        }
      }
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const snap = readSnapshot();
    if (snap) {
      setData(snap.value);
      setLoadedAt(snap.at);
      setFromSnapshot(true);
      setLoading(false);
    }
    setOnline(navigator.onLine !== false);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void refresh();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);
  useLiveRefresh(() => void refresh());

  const byKey = useMemo(() => new Map((data?.recent_decisions ?? []).map((d) => [d.opportunity_key, d])), [data]);
  const decisionFor = useCallback((key: string) => byKey.get(key) ?? null, [byKey]);

  return (
    <Context.Provider value={{ data, loading, failed, loadedAt, fromSnapshot, online, refresh: () => void refresh(), decisionFor }}>
      {children}
    </Context.Provider>
  );
}

export const useExperiment = () => useContext(Context);
