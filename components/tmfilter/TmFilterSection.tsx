"use client";

/* Learn → Time machine filter test (#tm-filter). Reads the public, write-once
   tm_filter_* tables: the historical look (stored once) and the forward
   study's calls and looks. Numbers only; every rate carries its count. */

import { useEffect, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { money } from "@/lib/format";
import { TM_FWD_STUDY, TM_HIST_STUDY } from "@/lib/tm-study/rules";
import { TMF_EXPOSED, TMF_LEDE, tmfForwardLine, tmfMissed, tmfPassLine, tmfVerdictWords, type TmfVerdict } from "@/lib/plain/tmfilter";
import { TM_FILTER_RULES } from "@/lib/tm-study/rules";
import page from "@/components/ui/page.module.css";
import exp from "@/components/experiment/experiment.module.css";

interface LookResult {
  verdict: TmfVerdict;
  resolved: number;
  sessions: number;
  skipped: number;
  keptNet: number;
  takeAllNet: number;
  skipRate: number;
  randomPercentile: number | null;
  delta: { est: number; lo: number; hi: number } | null;
  notRun?: Record<string, number>;
}
interface Look {
  study_id: string;
  look: number;
  verdict: TmfVerdict;
  taken_at: string;
  result: LookResult;
}

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; looks: Look[]; fwdCalls: number; fwdSince: string | null };

export default function TmFilterSection() {
  const { mask } = usePrivacy();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const db = getNeon();
        const [looks, calls, study] = await Promise.all([
          db.from("tm_filter_looks").select("study_id,look,verdict,taken_at,result").order("look"),
          db.from("tm_filter_calls").select("decision_key", { count: "exact", head: true }).eq("study_id", TM_FWD_STUDY),
          db.from("tm_filter_studies").select("registered_at").eq("id", TM_FWD_STUDY).limit(1),
        ]);
        if (looks.error || calls.error || study.error) throw new Error("read failed");
        if (!live) return;
        const since = (study.data?.[0] as { registered_at?: string } | undefined)?.registered_at ?? null;
        setState({ kind: "ok", looks: (looks.data ?? []) as unknown as Look[], fwdCalls: calls.count ?? 0, fwdSince: since ? since.slice(0, 10) : null });
      } catch {
        if (live) setState({ kind: "failed" });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "loading") return <p className={page.loading}>Loading the filter test…</p>;
  if (state.kind === "failed") return <p className={page.warning}>The filter test could not load.</p>;

  const hist = state.looks.find((l) => l.study_id === TM_HIST_STUDY) ?? null;
  const fwd = state.looks.filter((l) => l.study_id === TM_FWD_STUDY).sort((a, b) => b.look - a.look)[0] ?? null;
  const h = tmfVerdictWords(hist?.verdict ?? null, "historical");
  const f = tmfVerdictWords(fwd?.verdict ?? null, "forward");
  const r = hist?.result;
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const notRun = r?.notRun ? Object.values(r.notRun).reduce((a, b) => a + b, 0) : 0;

  return (
    <section className={`${page.card} ${exp.card}`} aria-label="Time machine filter test">
      <h2 className={page.cardTitle}>Time machine filter test</h2>
      <p className={exp.reason}>{TMF_LEDE}</p>

      <h3 className={page.cardTitle}>On past ideas, 2019 to 2026</h3>
      <p className={`${page.note} ${page[h.tone]}`}>
        <b>{h.head}.</b> {h.body}
      </p>
      {r && hist?.verdict !== "pass" && (
        <ul>
          {tmfMissed(r, TM_FILTER_RULES.historical.look.percentile).map((line) => (
            <li key={line} className={page.note}>{line}</li>
          ))}
        </ul>
      )}
      {r && (
        <>
          <dl className={exp.facts}>
            <dt>Ideas tested</dt>
            <dd>{r.resolved.toLocaleString("en-US")} over {r.sessions.toLocaleString("en-US")} trading days</dd>
            <dt>Skipped by the filter</dt>
            <dd>
              {r.skipped.toLocaleString("en-US")} of {r.resolved.toLocaleString("en-US")} ({pct(r.skipRate)})
            </dd>
            <dt>Take every idea</dt>
            <dd>{mask(money(r.takeAllNet))} after costs, one contract each</dd>
            <dt>Ideas the filter kept</dt>
            <dd>{mask(money(r.keptNet))} after costs</dd>
            <dt>Difference per idea</dt>
            <dd>{r.delta ? `${money(r.delta.est)} (95% range ${money(r.delta.lo)} to ${money(r.delta.hi)})` : "—"}</dd>
            <dt>Against random skips</dt>
            <dd>{r.randomPercentile === null ? "—" : `better than ${r.randomPercentile}% of 2,000 random skips of the same size`}</dd>
            {notRun > 0 && (
              <>
                <dt>Time machine could not run</dt>
                <dd>{notRun.toLocaleString("en-US")} ideas, taken by the rule</dd>
              </>
            )}
          </dl>
          <p className={page.note}>{tmfPassLine()}</p>
          <p className={page.note}>{TMF_EXPOSED}</p>
        </>
      )}

      <h3 className={page.cardTitle}>On the bot&apos;s new decisions</h3>
      <p className={`${page.note} ${page[f.tone]}`}>
        <b>{f.head}.</b> {f.body}
      </p>
      <p className={page.note}>{tmfForwardLine(state.fwdCalls, state.fwdSince)}</p>
    </section>
  );
}
