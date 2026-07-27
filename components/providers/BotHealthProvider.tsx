"use client";

/* Engine health, fetched once for the whole app.

   Three surfaces need the same answer and must never disagree: the header bell
   (is anything wrong?), Home's heartbeat strip (did the last twelve checks run
   on time?) and Home's bot-status card. Before the native pass Home fetched
   engine_runs itself with `.limit(5)`; the heartbeat wants twelve, and the bell
   wants them on every page, so the fetch moved up here.

   `revision` is the refresh bus. The tap-to-refresh chip calls `refresh()`,
   which reloads engine state and bumps `revision`; pages that own their own
   queries (Home's signals and zones) re-run them when it changes. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getSupabase,
  type BotPolicyRow,
  type EngineRunRow,
} from "@/lib/supabase/client";
import { streamLabel } from "@/lib/engine/streams";
import { dataDelayed, engineScheduled, fmtStamp } from "@/lib/time/session";
import { useData } from "./DataProvider";
import { useZone } from "./ZoneProvider";

/** Two missed 15-minute cron slots plus jitter. */
const STALE_AFTER_MIN = 40;
const RUN_HISTORY = 12; // the heartbeat strip's bar count
const AUTO_REFRESH_MS = 60_000;

export interface BotAlert {
  id: string;
  tone: "warn" | "bad" | "info";
  text: string;
}

interface BotHealthValue {
  runs: EngineRunRow[];
  policy: BotPolicyRow[];
  lastRun: EngineRunRow | null;
  /** No run scheduled right now — weekend or outside the cron's UTC hours. */
  asleep: boolean;
  /** A scheduled run is overdue. Never true while `asleep`. */
  stale: boolean;
  delayed: boolean;
  alerts: BotAlert[];
  loading: boolean;
  refreshing: boolean;
  /** Epoch ms of the last successful load — the refresh chip's timestamp. */
  loadedAt: number | null;
  /** The last poll came back with an error; the snapshot on screen is older. */
  loadFailed: boolean;
  refresh: () => void;
  revision: number;
}

const BotHealthContext = createContext<BotHealthValue | null>(null);

export function BotHealthProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<EngineRunRow[]>([]);
  const [policy, setPolicy] = useState<BotPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const { events } = useData();
  const { zone } = useZone();

  const load = useCallback(async (manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const supabase = getSupabase();
      const [runsRes, policyRes] = await Promise.all([
        supabase
          .from("engine_runs")
          .select("*")
          .order("ran_at", { ascending: false })
          .limit(RUN_HISTORY),
        supabase
          .from("bot_policy")
          .select("*")
          .order("changed_at", { ascending: false })
          .limit(50),
      ]);
      if (!runsRes.error) setRuns((runsRes.data ?? []) as EngineRunRow[]);
      if (!policyRes.error) setPolicy((policyRes.data ?? []) as BotPolicyRow[]);
      /* supabase-js reports PostgREST failures on `res.error` rather than
         throwing, so this `catch` never sees them. Bumping `loadedAt`
         regardless made the chip say "Updated just now" over a snapshot that
         had not moved, and tap-to-refresh looked like it worked while changing
         nothing. Only stamp the load when both queries actually came back. */
      const failed = Boolean(runsRes.error || policyRes.error);
      setLoadFailed(failed);
      if (!failed) setLoadedAt(Date.now());
    } catch {
      /* leave the previous snapshot on screen — a failed poll is not news */
      setLoadFailed(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
      /* Hold the spinner briefly so a cache-fast refresh still reads as an
         action the tap caused, rather than a flicker. */
      if (manual) setTimeout(() => setRefreshing(false), 450);
    }
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(false), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const refresh = useCallback(() => {
    setRevision((r) => r + 1);
    load(true);
  }, [load]);

  const lastRun = runs[0] ?? null;
  /* Asleep is not stale. The engine's cron only fires 06:00-21:59 UTC Mon-Fri,
     so a Friday-evening-to-Monday-morning silence is the schedule working, not
     a missed check. Reporting it as "has not checked in recently" was the
     single loudest false alarm on the dashboard. */
  const asleep = !engineScheduled(Math.floor(Date.now() / 1000));
  const overdue =
    !lastRun || Date.now() - new Date(lastRun.ran_at).getTime() > STALE_AFTER_MIN * 60_000;
  const stale = !asleep && overdue;
  const delayed = dataDelayed(runs, Math.floor(Date.now() / 1000));

  /* Everything the bell is allowed to claim, derived from real rows only. */
  const alerts = useMemo<BotAlert[]>(() => {
    const out: BotAlert[] = [];
    if (!loading && stale)
      out.push({
        id: "stale",
        tone: "warn",
        text: lastRun
          ? "The bot has not checked in recently — signals catch up on the next pass"
          : "No engine runs recorded yet",
      });
    if (lastRun && lastRun.status === "error")
      out.push({ id: "run-failed", tone: "bad", text: "The last check failed" });
    if (delayed)
      out.push({
        id: "delayed",
        tone: "warn",
        text: "Data delayed more than usual — signals catch up on the next pass",
      });

    const latest = new Map<string, BotPolicyRow>();
    for (const p of policy) if (!latest.has(p.stream)) latest.set(p.stream, p);
    for (const [stream, p] of latest) {
      if (p.action !== "paused") continue;
      out.push({
        id: `paused-${stream}`,
        tone: "warn",
        text: `${streamLabel(stream)} paused by the breaker — still simulating, hidden from the numbers`,
      });
    }

    const next = events
      .filter((e) => new Date(e.time).getTime() > Date.now())
      .sort((a, b) => a.time.localeCompare(b.time))[0];
    if (next)
      out.push({
        id: "news",
        tone: "info",
        text: `News pause ${fmtStamp(next.time, zone)} (${next.name})`,
      });

    return out;
  }, [loading, stale, lastRun, delayed, policy, events, zone]);

  const value = useMemo<BotHealthValue>(
    () => ({
      runs,
      policy,
      lastRun,
      asleep,
      stale,
      delayed,
      alerts,
      loading,
      refreshing,
      loadedAt,
      loadFailed,
      refresh,
      revision,
    }),
    [
      runs,
      policy,
      lastRun,
      asleep,
      stale,
      delayed,
      alerts,
      loading,
      refreshing,
      loadedAt,
      loadFailed,
      refresh,
      revision,
    ]
  );

  return <BotHealthContext.Provider value={value}>{children}</BotHealthContext.Provider>;
}

export function useBotHealth(): BotHealthValue {
  const ctx = useContext(BotHealthContext);
  if (!ctx) throw new Error("useBotHealth must be used inside BotHealthProvider");
  return ctx;
}
