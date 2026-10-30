"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { benchmarkBaselines } from "@/lib/research/auto-benchmark";
import { money } from "@/lib/format";
import { stampIn } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useLiveRefresh } from "@/lib/hooks/useLiveRefresh";
import page from "@/components/ui/page.module.css";

type Trial = { trial_key: string; config_hash: string; registered_at: string; decided_at: string | null; status: string; outcome: { strategyId?: string; verdict?: string; headline?: string } | null };
type Baseline = { config_hash: string; symbol: string; net: unknown; window_from: string | null; window_to: string | null; bar_source: string | null };
const NAMES: Record<string, string> = { "ema-cross": "Moving-average crossover", orb: "Opening-range breakout", "vwap-reversion": "Average-price reversion", "bollinger-breakout": "Quiet-market breakout" };

/** Read the existing preregistered weekly screens and their immutable results. */
export default function WeeklyResearch() {
  const { zone } = useZone(), { mask } = usePrivacy();
  const [data, setData] = useState<{ trials: Trial[]; baselines: Baseline[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const db = getNeon();
      const r = await db.from("research_trials").select("trial_key,config_hash,registered_at,decided_at,status,outcome").like("trial_key", "auto-benchmark.%").order("registered_at", { ascending: false }).limit(12);
      if (r.error) throw new Error(r.error.message);
      const trials = (r.data ?? []) as Trial[];
      const hashes = trials.map(t => t.config_hash);
      const b = hashes.length ? await db.from("research_baselines").select("config_hash,symbol,net,window_from,window_to,bar_source").in("config_hash", hashes).like("baseline_key", "auto:%") : { data: [], error: null };
      if (b.error) throw new Error(b.error.message);
      if (current !== request.current) return;
      setData({ trials, baselines: (b.data ?? []) as Baseline[] });
      setLoadedAt(Date.now());
      setFailed(false);
    } catch { if (current === request.current) setFailed(true); }
  }, []);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  useLiveRefresh(() => void load(), 5 * 60_000);
  return <section className={page.stack} aria-label="Weekly method screens">
    <div className={page.sectionHead}><h2>Weekly method screens</h2></div>
    <p className={page.note}>One untested method is checked at a time against matched random entries. Results below also compare its historical net after costs with doing nothing ($0). This is a screen, not proof or permission to trade.</p>
    {failed && <p className={page.warning}>Method results could not refresh.{data && loadedAt ? ` Showing the last successful read from ${stampIn(loadedAt / 1000, zone)}.` : ""} <button type="button" onClick={() => void load()}>Try again</button></p>}
    {!data ? <p className={page.empty}>{failed ? "Results unavailable." : "Loading method results…"}</p> : !data.trials.length ? <p className={page.empty}>No weekly screens have been recorded yet.</p> :
      data.trials.map(t => {
        const id = t.outcome?.strategyId ?? t.trial_key.split(":").at(-1) ?? "";
        const results = benchmarkBaselines(t.config_hash, data.baselines);
        const verdict = t.status === "abandoned" ? "Stopped before a result was recorded" : t.status !== "complete" ? "Waiting for the recorded result" : !t.outcome ? "Recorded verdict is unavailable" : t.outcome.verdict === "no-edge" ? "Did not pass the random-entry screen" : t.outcome.verdict === "beats-random" ? "Passed the random-entry screen; further checks required" : t.outcome.verdict === "insufficient-sample" ? "Too few results to judge" : "Recorded verdict is unavailable";
        return <article className={page.card} key={t.config_hash}>
          <h3 className={page.cardTitle}>{NAMES[id] ?? id}</h3>
          <p>{verdict}.</p>
          <p className={page.note}>Registered {stampIn(Date.parse(t.registered_at) / 1000, zone)}{t.decided_at ? ` · Result ${stampIn(Date.parse(t.decided_at) / 1000, zone)}` : ""}.</p>
          {results.length > 0 ? <ul>{results.map(r => <li key={r.symbol}>{r.symbol}: {r.status === "insufficient-sample" ? "Too few trades to compare" : `${mask(money(r.net))} after costs versus $0 without trading`} (n={r.n}). <span className={page.dim}>Source: {r.source ?? "not recorded"}; market dates: {r.from ?? "unknown"} to {r.to ?? "unknown"}.</span></li>)}</ul> : <p className={page.note}>The saved net comparison is not available.</p>}
        </article>;
      })}
  </section>;
}
