"use client";
import {useEffect,useState,useCallback} from "react";
import Link from "next/link";
import {usePaper} from "@/components/providers/PaperProvider";
import {useBotHealth} from "@/components/providers/BotHealthProvider";
import {usePrivacy} from "@/components/providers/PrivacyProvider";
import {useZone} from "@/components/providers/ZoneProvider";
import {Badge,Button,Panel} from "@/components/ui";
import BottomSheet,{SheetClose} from "@/components/ui/BottomSheet";
import {botState,candidateName,freshTraining,type Candidate,type Position} from "@/lib/paper/overview";
import {fmtStamp} from "@/lib/time/session";
import {nyMeta} from "@/lib/time/ny";
import {fetchMarket,type MarketPayload} from "@/lib/data/fetch";
import styles from "./trader-desk.module.css";

export default function TraderDesk({bot=false}:{bot?:boolean}) {
 const {data,candidates,activity,errors,loadedAt,loading,refresh}=usePaper();const health=useBotHealth();
 const {mask}=usePrivacy(),{zone}=useZone();
 const [sheet,setSheet]=useState<"how"|"risk"|"training"|Candidate|Position|null>(null);
 const closeSheet=useCallback(()=>setSheet(null),[]);
 const [quotes,setQuotes]=useState<Partial<Record<"MES"|"MNQ",MarketPayload>>>({});const [quoteErrors,setQuoteErrors]=useState<string[]>([]);
 const [today,setToday]=useState<string|null>(null);
 useEffect(()=>{const tick=()=>setToday(nyMeta(Date.now()/1000).dateKey);tick();const t=setInterval(tick,60000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(bot)return;let live=true;const load=async()=>{const symbols=["MES","MNQ"] as const;const results=await Promise.allSettled(symbols.map(s=>fetchMarket(s)));if(!live)return;
  const failures:string[]=[];results.forEach((r,i)=>{if(r.status==="fulfilled")setQuotes(q=>({...q,[symbols[i]]:r.value}));else failures.push(symbols[i]);});setQuoteErrors(failures);};void load();const t=setInterval(()=>void load(),60000);return()=>{live=false;clearInterval(t);};},[bot]);
 const cash=(v:unknown)=>v==null||!Number.isFinite(Number(v))?"—":mask(Number(v).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}));
 const stamp=(v?:string|null)=>v?fmtStamp(v,zone):"Not recorded";
 const state=botState(data,errors.includes("Account"));const positions=data?.positions??[],open=positions.filter(p=>!p.closed_at);
 const training=freshTraining(data?.learning??null);
 const title=sheet==="how"?"Your daily routine":sheet==="risk"?"Practice account limits":sheet==="training"?"What training does":sheet&&"candidate_key" in sheet?candidateName(sheet.candidate_key):sheet?`${sheet.symbol} · ${sheet.side}`:"Details";
 return <div className={styles.page}>
  <div className={styles.titleRow}><div><span className={styles.eyebrow}>Your trading workspace</span><h1>{bot?"Bot":"Today"}</h1></div><Button variant="ghost" onClick={()=>setSheet("how")}>How it works</Button></div>
  <p className={styles.disclaimer}>Paper only · Delayed prices · Nothing here touches real money.</p>
  {errors.length>0&&<div role="alert" className={styles.notice}>{errors.join(", ")} could not refresh. Previous figures may be old. <button onClick={refresh}>Retry</button></div>}
  <section className={styles.status} aria-label="Bot status">
   <div className={styles.row}><span className={styles.eyebrow}>Bot status</span><Badge tone={loading?"default":state.tone}>{loading?"Checking…":state.label}</Badge></div>
   <h2>{loading?"Checking the practice account":data?.release?.status==="active"||data?.release?.status==="probation"?candidateName(data.release.candidate_key):state.label==="Researching"?"Testing ideas. Waiting for evidence.":state.label}</h2>
   <p>{loading?"Loading the recorded account and latest checks.":state.reason}</p>
   <div className={styles.next}><span>Next step</span><p>{state.next}</p><Link href={bot?"/replay":"/brain"}>{bot?"Open Journal":"See what the bot is doing"}<span aria-hidden> →</span></Link></div>
  </section>
  {!bot&&<>
   <section className={styles.account} aria-label="Paper account"><div className={styles.row}><span className={styles.eyebrow}>Practice account</span><button onClick={()=>setSheet("risk")}>Risk limits ↗</button></div>
    <div className={styles.balance}>{cash(data?.account?.equity)}</div><p className={styles.muted}>Equity, including open paper trades</p>
    <div className={styles.metrics}><div><span>Today’s P&amp;L</span><strong>{data?.account?.day_key===today?cash(data.account.daily_pnl):"—"}</strong><small>{data?.account?.day_key===today?"Includes open trades":"Waiting for today’s account update"}</small></div><div><span>Open risk</span><strong>{cash(data?.account?.open_risk)}</strong><small>Limit {cash(100)}</small></div></div>
   </section>
   <div className={styles.columns}><Panel title="Current position" hint="Practice account only">{open.length?open.map(p=><Trade key={p.id} p={p} cash={cash} onClick={()=>setSheet(p)}/>):<div className={styles.empty}><span className={styles.emptyIcon} aria-hidden>◇</span><h3>No open paper position</h3><p>{data?.release&&data.release.status!=="paused"?"The bot is waiting for a qualifying setup.":"Research signals do not open trades in this account."}</p><Link href="/brain">View the requirements →</Link></div>}</Panel>
    <Panel title="Markets" hint="Delayed quotes"><div className={styles.list}>{(["MES","MNQ"] as const).map(s=><Link key={s} href={`/markets?symbol=${s}`} className={styles.market}><div><b>{s}</b><span>{s==="MES"?"S&P micro":"Nasdaq micro"}</span></div><div><strong className="num">{quotes[s]?.price?.toLocaleString("en-US",{maximumFractionDigits:2})??"—"}</strong><small>{quoteErrors.includes(s)?"Could not refresh":quotes[s]?stamp(quotes[s]?.dataTimestamp):"Loading quote…"}</small></div></Link>)}</div></Panel></div>
  </>}
  <div className={styles.health}><div><span>Price checks</span><b>{health.loading?"Checking…":health.loadFailed||health.stale?"Needs attention":health.asleep?"Outside scheduled hours":health.delayed?"Prices delayed":"Running"}</b><small>{stamp(health.lastRun?.ran_at)}</small></div><button onClick={()=>setSheet("training")}><span>Training</span><b>{!data?"Checking…":training?"Up to date":"Needs attention"}</b><small>{stamp(data?.learning?.finished_at)}</small></button></div>
  {bot&&<>
   <Panel title="Research progress" hint="Each idea must earn its place"><p className={styles.muted}>Past simulations, separate confirmation, and new observations are checked independently. More training does not automatically mean a better strategy.</p>
    {errors.includes("Research")&&<p className={styles.caution}>Research progress may be incomplete.</p>}
    {!candidates.length?<p>Research results are {loading?"loading":"not available yet"}.</p>:<div className={styles.candidates}>{candidates.map(c=>{const h=c.historical as {n?:number;net?:number;gate?:{promote:boolean}}|null;const passed=h?.gate?.promote;return <button key={c.candidate_key} className={styles.candidate} onClick={()=>setSheet(c)}><div className={styles.row}><b>{candidateName(c.candidate_key)}</b><span aria-hidden>↗</span></div><Badge tone={!h||Number(h.n)<150?"amber":passed?"green":"red"}>{!h?"Awaiting test":Number(h.n)<150?"Too little evidence":passed?"Historical checks passed":"Did not qualify"}</Badge><p>{h?`${cash(h.net)} after costs · n=${h.n??0}`:"Registered before testing"}</p><small>New observations: {c.forward_closed}/60 closes · {c.forward_days}/20 trading days</small></button>;})}</div>}
   </Panel>
   <div className={styles.columns}><Panel title="Model learning"><h3>{data?.model?.status==="active"?"Model active":"Model observing"}</h3><p className={styles.muted}>The model must improve predictions and net trading results before it can filter entries.</p><p>{data?.model?`${data.model.train_n??0} eligible training trades`:"No model recorded yet"}</p><button className={styles.textButton} onClick={()=>setSheet("training")}>Understand the latest result →</button></Panel><Panel title="Risk controls"><p>One qualified strategy at a time. Risk starts at {cash(25)} per trade and can rise to {cash(50)} after another qualifying review.</p><button className={styles.textButton} onClick={()=>setSheet("risk")}>See all account limits →</button></Panel></div>
  </>}
  <Panel title="Latest activity" hint="Recorded actions"><ol className={styles.activity}>{activity.slice(0,bot?12:4).map(a=><li key={a.id}><span className={styles.activityDot}/><div><b>{a.kind}</b><p>{a.detail}</p><small>{stamp(a.at)}</small></div></li>)}</ol>{!activity.length&&<p>{errors.includes("Activity")?"Activity could not be loaded.":"No recorded activity to show yet."}</p>}</Panel>
  {!bot&&positions.some(p=>p.closed_at)&&<Panel title="Recent paper trades">{positions.filter(p=>p.closed_at).slice(0,5).map(p=><Trade key={p.id} p={p} cash={cash} onClick={()=>setSheet(p)}/>)}</Panel>}
  <div className={styles.footer}><span>Account read {stamp(loadedAt)}</span><button onClick={()=>{refresh();health.refresh();}}>Refresh</button></div>
  {bot&&<div className={styles.links}><Link href="/brain/history">Detailed learning history →</Link><Link href="/research-history">Legacy signal research →</Link><Link href="/diagnostics">Validation evidence →</Link></div>}
  <BottomSheet open={sheet!==null} onClose={closeSheet} title={title}><div className={styles.row}><h2>{title}</h2><SheetClose onClose={closeSheet}/></div><div className={styles.sheet}>
   {sheet==="how"&&<><p>Nothing here sends an order to a broker. Prices and the practice simulation are delayed.</p><ol><li><b>Check Today.</b> Read the status and its reason. Researching means the account is waiting for a strategy to qualify.</li><li><b>Inspect the decision.</b> Open a position for entry, stop, target, risk and the reason for the trade.</li><li><b>Keep your own record.</b> Use Journal to write down what you chose and why. Your entries stay separate from the bot’s account.</li><li><b>Review on Bot.</b> See what ran, what failed, and which evidence is still missing.</li></ol><Link href="/guide">Read the full Guide →</Link></>}
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
 const conf=c.confirmation as {n?:number;gate?:{promote?:boolean}}|null;
 return <><p>Historical simulations are separate from trades observed as new prices arrive.</p><ol className={styles.steps}><li><b>Historical checks</b><p>{h?`${cash(h.net)} after costs · n=${h.n??0}`:"Not measured"}</p></li><li><b>Separate confirmation</b><p>{conf?`${conf.gate?.promote?"Passed":"Not qualified"} · n=${conf.n??0}`:"Awaiting a separate test"}</p></li><li><b>New observations</b><p>{c.forward_closed} of 60 closed trades across {c.forward_days} of 20 trading days. Net {cash(c.forward_net)}.</p></li><li><b>Weekly qualification</b><p>{c.weekly_passes} recorded activation passes. Activation requires two qualifying forward reviews at least six days apart, with ten new closes between them.</p></li></ol><details><summary>Historical evidence details</summary>{h?.gate?.checks?.map(x=><p key={x.key}><b>{x.label}: {x.status==="not-measured"?"Not measured":x.status==="pass"?"Passed":"Failed"}</b><br/>{x.detail}</p>)??<p>No historical checks recorded.</p>}</details><p>A failed or missing check blocks activation. More data does not turn a failed result into a pass automatically.</p></>;
}
