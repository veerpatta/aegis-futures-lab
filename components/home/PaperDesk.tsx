"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getNeon } from "@/lib/neon/client";
import { useZone } from "@/components/providers/ZoneProvider";
import { fmtStamp } from "@/lib/time/session";
import { PAPER_RISK } from "@/lib/paper/policy";
import styles from "./paper-desk.module.css";

type Desk = { account: Record<string, unknown> | null; release: Record<string, unknown> | null;
  learning: Record<string, unknown> | null; recovery: Record<string, unknown> | null;
  positions: Record<string, unknown>[]; trials: Record<string, unknown>[]; evaluation: Record<string, unknown> | null; model: Record<string, unknown> | null };
const dollars = (v: unknown) => typeof v === "number" || typeof v === "string" ? Number(v).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}) : "—";
export default function PaperDesk() {
  const [desk,setDesk]=useState<Desk|null>(null),[error,setError]=useState("");
  const { zone }=useZone();
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      try {
        const db=getNeon();
        const [account,release,learning,recovery,positions,evaluation,model,trials]=await Promise.all([
          db.from("paper_account").select("*").eq("id",1),
          db.from("paper_releases").select("*").in("status",["probation","active"]).limit(1),
          db.from("learning_runs").select("*").order("started_at",{ascending:false}).limit(1),
          db.from("recovery_runs").select("*").order("started_at",{ascending:false}).limit(1),
          db.from("paper_positions").select("*").order("opened_at",{ascending:false}).limit(8),
          db.from("paper_evaluations").select("*").order("evaluated_at",{ascending:false}).limit(1),
          db.from("learned_stats").select("payload").eq("stat_key","context_model_v2").order("computed_at",{ascending:false}).limit(1),
          db.from("research_trials").select("id,trial_key,outcome").like("trial_key","2026-09-25.1:%").order("registered_at",{ascending:false}).limit(6),
        ]);
        if([account,release,learning,recovery,positions,evaluation,model,trials].some(r=>r.error)) throw new Error("The practice account or training record could not be loaded. Retry shortly.");
        if(!cancelled){setDesk({account:account.data?.[0]??null,release:release.data?.[0]??null,learning:learning.data?.[0]??null,recovery:recovery.data?.[0]??null,
          positions:positions.data??[],trials:trials.data??[],evaluation:evaluation.data?.[0]??null,model:model.data?.[0]?.payload??null});setError("");}
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:String(e));}
    };
    void load();const timer=setInterval(()=>void load(),60000);return()=>{cancelled=true;clearInterval(timer);};
  },[]);
  const stamp=(v:unknown)=>typeof v==="string"?fmtStamp(v,zone):"Not recorded";
  const stale=!desk?.learning || desk.learning.status!=="ok" || Date.now()-Date.parse(String(desk.learning.finished_at??desk.learning.started_at))>4*86400000;
  return <section className={styles.card} aria-labelledby="paper-desk-title">
    <div className={styles.heading}><div><span className={styles.eyebrow}>Trade and review</span><h2 id="paper-desk-title">Your practice desk</h2></div>
      <span className={styles.badge}>{desk?.release?"PAPER ACTIVE":"RESEARCH MODE"}</span></div>
    <p className={styles.warning}>Paper only · Delayed prices · Nothing here touches real money.</p>
    {error?<p role="alert" className={styles.warning}>{error}</p>:!desk?<p>Loading practice account and training…</p>:<>
      <h3>{desk.release?String(desk.release.candidate_key):"No strategy qualifies for paper activation yet"}</h3>
      <p>{desk.release?String(desk.release.reason):"The original strategies failed validation. New ideas must pass historical checks and collect new paper results before activation."}</p>
      <dl className={styles.metrics}>
        <div><dt>Practice equity</dt><dd>{dollars(desk.account?.equity)}</dd></div>
        <div><dt>Today, including open trades</dt><dd>{dollars(desk.account?.daily_pnl)}</dd></div>
        <div><dt>Open risk / limit</dt><dd>{dollars(desk.account?.open_risk)} / $100</dd></div>
        <div><dt>Risk per new trade</dt><dd>{desk.release?(desk.release.status==="probation"?"$25":"$50"):"Inactive"}</dd></div>
      </dl>
      {desk.account?.locked===true&&<p role="alert" className={styles.warning}>Drawdown lock. An explicit reset is required before another practice trade.</p>}
      <div className={styles.next}><b>Next step</b><p>{desk.release?"Review each setup and record your own decision in Journal.":"Review the training results. Keep your own practice trades in Journal while the new strategies collect evidence."}</p>
        <nav><Link href="/replay">Open Journal →</Link><Link href="/brain">Review training →</Link></nav></div>
      <details><summary>Training, recovery and risk limits</summary>
        <p className={stale?styles.warning:undefined}>Latest training: {String(desk.learning?.status??"not recorded")} · {stamp(desk.learning?.finished_at)}{stale?" · Needs attention":""}</p>
        <p>Recovery: {String(desk.recovery?.status??"not yet run")} · {stamp(desk.recovery?.finished_at)}. Replayed trades never count as new observations.</p>
        <p>Context model: {desk.model?`${desk.model.qualifies?"Passed comparison; still observing":"Has not passed the comparison"} (n=${desk.model.oos_n??0} test trades).`:"Collecting training evidence."} A filter must improve net returns and prediction accuracy.</p>
        <h3>Latest strategy checks</h3>
        {desk.trials.map(t=>{const r=t.outcome as {id:string;symbol:string;n:number;net:number;gate:{promote:boolean}}|null;return <p key={String(t.id)} className={r&&r.n>=150&&!r.gate.promote?styles.failed:styles.warning}>
          {r?`${r.id} · ${r.symbol}: ${r.n<150?"Too few trades to judge":r.gate.promote?"Historical checks passed; collecting forward evidence":"Did not pass"}. Net ${dollars(r.net)} (n=${r.n}).`:`${String(t.trial_key)}: waiting for a result.`}</p>;})}
        <p>Fixed starting balance {dollars(PAPER_RISK.capital)}. Daily loss limit $200, including open trades. Drawdown lock $1,000. Risk starts at $25 and rises to $50 only after another qualifying weekly review. No compounding.</p>
        <p>Activation needs all historical checks, 60 new closed trades over 20 trading days, and two weekly passes with at least 10 new closes between them.</p>
      </details>
      {desk.positions.length>0&&<div><h3>Recent practice trades</h3>{desk.positions.map(p=><article key={String(p.id)} className={styles.trade}>
        <b>{String(p.symbol)} · {String(p.side)} · {String(p.qty)} contracts</b><p>Entry {String(p.entry)} · Stop {String(p.stop)} · Target {String(p.target)} · Risk {dollars(p.risk)}</p><p>{String(p.reason)}</p>
        <small>{stamp(p.opened_at)} · {p.closed_at?`Closed ${dollars(p.pnl)}`:"Open"}</small></article>)}</div>}
    </>}
  </section>;
}
