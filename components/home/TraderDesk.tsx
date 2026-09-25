"use client";
import {useEffect,useState,useCallback} from "react";
import Link from "next/link";
import {usePaper} from "@/components/providers/PaperProvider";
import {useBotHealth} from "@/components/providers/BotHealthProvider";
import {usePrivacy} from "@/components/providers/PrivacyProvider";
import {useZone} from "@/components/providers/ZoneProvider";
import {Badge,Button} from "@/components/ui";
import BottomSheet,{SheetClose} from "@/components/ui/BottomSheet";
import {botState,candidateName,freshTraining,type Candidate,type Position} from "@/lib/paper/overview";
import {fmtStamp} from "@/lib/time/session";
import {nyMeta} from "@/lib/time/ny";
import simple from "./simple-workspace.module.css";
import styles from "./trader-desk.module.css";

export default function TraderDesk() {
 const {data,candidates,activity,errors,loadedAt,loading,refresh}=usePaper();const health=useBotHealth();
 const {mask}=usePrivacy(),{zone}=useZone();
 const [sheet,setSheet]=useState<"how"|"risk"|"training"|Candidate|Position|null>(null);
 const closeSheet=useCallback(()=>setSheet(null),[]);
 const [allActivity,setAllActivity]=useState(false);
 const [today,setToday]=useState<string|null>(null);
 useEffect(()=>{const tick=()=>setToday(nyMeta(Date.now()/1000).dateKey);tick();const t=setInterval(tick,60000);return()=>clearInterval(t);},[]);
 const cash=(v:unknown)=>v==null||!Number.isFinite(Number(v))?"—":mask(Number(v).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}));
 const stamp=(v?:string|null)=>v?fmtStamp(v,zone):"Not recorded";
 const state=botState(data,errors.includes("Account"));const positions=data?.positions??[],open=positions.filter(p=>!p.closed_at);
 const training=freshTraining(data?.learning??null);
 const title=sheet==="how"?"Your daily routine":sheet==="risk"?"Practice account limits":sheet==="training"?"What training does":sheet&&"candidate_key" in sheet?candidateName(sheet.candidate_key):sheet?`${sheet.symbol} · ${sheet.side}`:"Details";
 return <div className={`${styles.page} ${simple.page}`}>
  <div className={simple.heading}><h1 className="pageTitle">Bot</h1><Button variant="ghost" onClick={()=>setSheet("how")}>How it works</Button></div>
  <p className={simple.caption}>Paper only · Delayed prices · No real orders</p>
  {errors.length>0&&<div role="alert" className={styles.notice}>{errors.join(", ")} could not refresh. Previous figures may be old. <button onClick={refresh}>Retry</button></div>}
  <section className={simple.status} aria-label="Bot status"><Badge tone={loading?"default":state.tone}>{loading?"Checking…":state.label}</Badge><p>{loading?"Checking the practice account…":state.reason}</p></section>
  <div className={simple.facts}>
   <div><span>Price checks</span><b>{health.loading?"Checking…":health.loadFailed||health.stale?"Needs attention":health.asleep?"Outside scheduled hours":health.delayed?"Delayed":"Running"}</b><small>{stamp(health.lastRun?.ran_at)}</small></div>
   <button onClick={()=>setSheet("training")}><span>Training ↗</span><b>{errors.includes("Account")?"Not verified":!data?"Checking…":training?"Up to date":"Needs attention"}</b><small>{stamp(data?.learning?.finished_at)}</small></button>
  </div>
  <section aria-label="Paper account" className={simple.section}>
   <div className={simple.heading}><h2>Practice account</h2><button onClick={()=>setSheet("risk")}>Risk limits ↗</button></div>
   <div className={simple.numbers}><div><span>Equity</span><b>{cash(data?.account?.equity)}</b></div><div><span>Today's result</span><b>{data?.account?.day_key===today?cash(data.account.daily_pnl):"—"}</b></div><div><span>Open risk</span><b>{cash(data?.account?.open_risk)}</b></div></div>
   <p className={simple.caption}>Equity and today's result include open paper trades.</p>
   {!data?.account||errors.includes("Account")?<p>{loading?"Checking positions…":"Positions not verified"}</p>:open.length?open.map(p=><Trade key={p.id} p={p} cash={cash} onClick={()=>setSheet(p)}/>):<p className={simple.caption}>No open paper position</p>}
  </section>
  <section aria-label="Research progress" className={simple.section}>
   <div className={simple.heading}><h2>Strategy progress</h2><span className={simple.caption}>After costs · simulated</span></div>
   {errors.includes("Research")&&<p className={styles.caution}>Research progress may be incomplete.</p>}
   {!candidates.length?<p className={simple.caption}>{loading?"Loading strategy tests…":"No strategy results available."}</p>:<div className={simple.list}>{candidates.map(c=>{const h=c.historical as {n?:number;net?:number;gate?:{promote:boolean}}|null;return <button key={c.candidate_key} className={simple.progress} onClick={()=>setSheet(c)}><div><b>{candidateName(c.candidate_key)}</b><span className={!h||Number(h.n??0)<150?simple.amber:h.gate?.promote?simple.green:simple.red}>{!h?"Awaiting test":Number(h.n??0)<150?"Too little evidence":h.gate?.promote?"Historical checks passed":"Did not qualify"}</span></div><div><b className="num">{h?cash(h.net):"—"}</b><small>{h?`n=${h.n??0} trades`:"No result"} ↗</small></div></button>;})}</div>}
  </section>
  <section className={simple.section}><div className={simple.heading}><h2>Latest activity</h2>{activity.length>3&&<button onClick={()=>setAllActivity(!allActivity)}>{allActivity?"Show less":"View all"}</button>}</div><ol className={styles.activity}>{activity.slice(0,allActivity?activity.length:3).map(a=><li key={a.id}><span className={styles.activityDot}/><div><b>{a.kind}{a.candidate_key?` · ${candidateName(a.candidate_key)}`:""}</b><p>{a.detail}</p><small>{stamp(a.at)}</small></div></li>)}</ol>{!activity.length&&<p className={simple.caption}>{errors.includes("Activity")?"Activity could not be loaded.":loading?"Loading activity…":"No recorded activity yet."}</p>}</section>
  <div className={styles.footer}><span>Account read {stamp(loadedAt)}</span><button onClick={()=>{refresh();health.refresh();}}>Refresh</button></div>
  <details className={simple.details}><summary>More details</summary><div className={styles.links}><button className={styles.textButton} onClick={()=>setSheet("training")}>Model and training</button><Link href="/brain/history">Learning history →</Link><Link href="/research-history">Legacy signal research →</Link><Link href="/diagnostics">Validation evidence →</Link><Link href="/replay">Journal →</Link></div></details>
  <BottomSheet open={sheet!==null} onClose={closeSheet} title={title}><div className={styles.row}><h2>{title}</h2><SheetClose onClose={closeSheet}/></div><div className={styles.sheet}>
   {sheet==="how"&&<><p>Nothing here sends an order to a broker. Prices and the practice simulation are delayed.</p><ol><li><b>Check Home and Signals.</b> Read the signal count and Entry, Stop and Target. These are delayed research ideas.</li><li><b>Inspect the decision.</b> Open a position for entry, stop, target, risk and the reason for the trade.</li><li><b>Keep your own record.</b> Use Journal to write down what you chose and why. Your entries stay separate from the bot’s account.</li><li><b>Review on Bot.</b> See what ran, what failed, and which evidence is still missing.</li></ol><Link href="/guide">Read the full Guide →</Link></>}
   {sheet==="risk"&&<><p>Starting balance {cash(10000)}. This is a simulation balance.</p><ul><li>Probation risk: {cash(25)} per trade.</li><li>Full risk: {cash(50)} after another qualifying weekly review.</li><li>Total open risk: {cash(100)}.</li><li>Daily loss limit: {cash(200)}, including open positions.</li><li>Drawdown lock: {cash(1000)} from the account’s highest equity.</li></ul><p>Contract sizing includes costs. A trade is skipped if one contract exceeds the available budget. Gaps can cause losses beyond the planned stop. Loss history survives strategy changes. There is no compounding.</p></>}
   {sheet==="training"&&<><p>Latest training: {data?.learning?.status??"not recorded"} · {stamp(data?.learning?.finished_at)}.</p><p>Training studies closed outcomes. It cannot recover genuine forward observations from past prices or promise profit.</p><p>{data?.model?`Latest model: ${data.model.status}. Training sample: n=${data.model.train_n??0}.`:"No trained model is recorded."}</p><p>Prediction error: {data?.model?.oos_brier?.toFixed(4)??"not measured"}; simple baseline: {data?.model?.baseline_brier?.toFixed(4)??"not measured"}. Lower is better. Prediction accuracy and net returns must both improve.</p><Link href="/brain/history">Open the detailed learning record →</Link></>}
   {sheet&&typeof sheet==="object"&&"candidate_key" in sheet&&<CandidateDetails c={sheet} cash={cash}/>}
   {sheet&&typeof sheet==="object"&&"symbol" in sheet&&<><p>{sheet.closed_at?"Closed paper trade":"Open paper trade"} · {sheet.qty} contract{sheet.qty===1?"":"s"}</p><dl className={styles.tradeDetails}>{Object.entries({Entry:sheet.entry,Stop:sheet.stop,Target:sheet.target,"Planned risk":cash(sheet.risk),"Net result":sheet.closed_at?cash(sheet.pnl):"Still open"}).map(([k,v])=><div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}</dl><h3>Why this trade</h3><p>{sheet.reason}</p><p>Opened {stamp(sheet.opened_at)}{sheet.closed_at?` · Closed ${stamp(sheet.closed_at)}`:""}</p><Link href="/replay">Record your own decision in Journal →</Link></>}
  </div></BottomSheet>
 </div>;
}
function Trade({p,cash,onClick}:{p:Position;cash:(n:unknown)=>string;onClick:()=>void}) {return <button className={styles.trade} onClick={onClick}><div><b>{p.symbol} · {p.side==="LONG"?"Buy":"Sell"}</b><span>{p.qty} contracts · {p.closed_at?"Closed":"Open"}</span></div><div><b className="num">{p.closed_at?cash(p.pnl):cash(p.risk)}</b><span>{p.closed_at?"Net after costs":"Planned risk"} ↗</span></div></button>;}
function CandidateDetails({c,cash}:{c:Candidate;cash:(n:unknown)=>string}) {
 const h=c.historical as {n?:number;net?:number;gate?:{checks?:{key:string;label:string;status:string;detail:string}[]}}|null;
 const conf=c.confirmation as {n?:number;gate?:{promote?:boolean};dataQuality?:{ready:boolean;missingBars:number}}|null;
 return <><p>Historical simulations are separate from trades observed as new prices arrive.</p><ol className={styles.steps}><li><b>Historical checks</b><p>{h?`${cash(h.net)} after costs · n=${h.n??0}`:"Not measured"}</p></li><li><b>Separate confirmation</b><p>{conf?`${conf.dataQuality?.ready===false?"Data incomplete — qualification blocked":conf.gate?.promote?"Passed":"Not qualified"} · n=${conf.n??0}`:"Awaiting a separate test"}</p>{conf?.dataQuality?.ready===false&&<p>{conf.dataQuality.missingBars} missing session bars. This result is provisional.</p>}</li><li><b>New observations</b><p>{c.forward_closed} of 60 closed trades across {c.forward_days} of 20 trading days. Net {cash(c.forward_net)}.</p></li><li><b>Weekly qualification</b><p>{c.weekly_passes} recorded activation passes. Activation requires two qualifying forward reviews at least six days apart, with ten new closes between them.</p></li></ol><details><summary>Historical evidence details</summary>{h?.gate?.checks?.map(x=><p key={x.key}><b>{x.label}: {x.status==="not-measured"?"Not measured":x.status==="pass"?"Passed":"Failed"}</b><br/>{x.detail}</p>)??<p>No historical checks recorded.</p>}</details><p>A failed or missing check blocks activation. More data does not turn a failed result into a pass automatically.</p></>;
}
