/** Register every trial before reading bars. No tuning or parameter search. */
import { writeFileSync } from "node:fs";
import { createClient, transaction } from "@/lib/neon/server";
import { fetchArchiveBars } from "@/lib/data/archive";
import { alignArchiveSlice } from "@/lib/data/window";
import { executeRun } from "@/lib/backtest/run";
import { RESEARCH_IDS, RESEARCH_VERSION } from "@/lib/strategies/research-v2";
import { ALL_RESEARCH_IDS, candidateKey, researchConfigHash, researchRequest } from "../engine/research-observer";
import { stableHash } from "../engine/learning-audit";
import { researchCodeHash } from "../engine/research-code";
import { effectiveTrialCount } from "../engine/trial-count";
import { evaluatePromotion, type PromotionEvidence } from "@/lib/validation/promotionGate";
import { deflatedSharpe, trialSharpeDispersion } from "@/lib/validation/deflatedSharpe";
import { probabilityOfBacktestOverfitting } from "@/lib/validation/pbo";
import { combinatorialPurgedCv } from "@/lib/validation/purgedCv";
import { nyMeta } from "@/lib/time/ny";
import { candidatePool, profileFrom } from "@/lib/diagnostics/randomEntry";
import { runNullDistribution } from "@/lib/diagnostics/randomEntryRun";

const confirmation = process.argv.includes("--confirmation");
const asOf = process.argv.includes("--as-of") ? process.argv[process.argv.indexOf("--as-of") + 1] : "";
if (confirmation && (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf) > Date.now() || Date.parse(asOf) <= Date.parse("2026-07-30"))) throw new Error("Confirmation requires a valid --as-of cutoff");
const end = Date.parse(confirmation ? asOf : "2026-07-30T00:00:00Z") / 1000;
const confirmationFrom = "2026-07-30T00:00:00Z";
const decisionRule = "Frozen rules; all existing promotion gates, stressed drawdown below $1000, untouched confirmation data and 60 forward closes over 20 trading days, two weekly passes with 10 new closes. No parameter tuning.";
async function main() {
  const specs = ALL_RESEARCH_IDS.flatMap(id => (["MES", "MNQ"] as const).map(symbol => ({ id, symbol, key: candidateKey(id, symbol) })));
  await transaction(async c => {
    for (const s of specs) await c.query(`INSERT INTO research_trials(trial_key,hypothesis,prediction,decision_rule,config_hash,params,dataset,status,code_sha)
      VALUES($1,$2,$3,$4,$5,$6,$7,'registered',$8) ON CONFLICT(config_hash) DO NOTHING`,
      [s.key, s.id, "Positive net returns after costs and every validation gate", decisionRule, stableHash({ key:s.key, config:researchConfigHash }),
        JSON.stringify({ version: RESEARCH_VERSION, risk: 50, strategy: s.id, symbol:s.symbol }),
        JSON.stringify({ source:"databento", developmentEnd:confirmationFrom, confirmationFrom, note:"Old inspected archive is development, never independent confirmation" }), process.env.GITHUB_SHA ?? null]);
  });
  if (process.argv.includes("--register-only")) { console.log("Registered all frozen trials and reserved confirmation period."); return; }
  const db=createClient();
  const counts=await transaction(c=>c.query("SELECT params,dataset FROM research_trials"));
  const totalTrials=effectiveTrialCount(counts.rows);
  const barsBySymbol = Object.fromEntries(await Promise.all((["MES","MNQ"] as const).map(async symbol =>
    [symbol,alignArchiveSlice(await fetchArchiveBars(db,{symbol,source:"databento",fromSec:confirmation?Date.parse(confirmationFrom)/1000-35*86400:undefined,toSec:end-300}))] as const)));
  if(confirmation && Object.values(barsBySymbol).some(b=>!b.length || b.at(-1)!.time < end-4*86400)) throw new Error("Confirmation contract data is incomplete; import within existing credit first");
  const results=[];
  for(const s of specs) {
    const bars=barsBySymbol[s.symbol];
    const req={...researchRequest(s.id,s.symbol,bars),window:confirmation?{fromTime:Date.parse(confirmationFrom)/1000,toTime:end-300}:undefined};
    const run=executeRun({...req,keepOpenAtEnd:false});
    const trades=run.trades, pnl=trades.map(t=>t.pnl), rs=trades.map(t=>t.rMultiple);
    const net=pnl.reduce((a,b)=>a+b,0), avg=rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:0;
    const sd=rs.length>1?Math.sqrt(rs.reduce((a,b)=>a+(b-avg)**2,0)/(rs.length-1)):0;
    const daily:Record<string,number>={};
    for(const t of trades) {const d=nyMeta(t.entryTime).dateKey;daily[d]=(daily[d]??0)+t.pnl;}
    let percentile:number|null=null;
    // A negative net already fails the gate. Do not spend hours proving a second failure.
    if(net>0 && trades.length>=150) {
      const nullRes=runNullDistribution({cell:s.key,series:req.series,execution:req.execution,locks:req.locks,
        startingCapital:req.startingCapital,sessionExitMinute:req.sessionExitMinute,pointValues:req.pointValues,
        sessionWindow:{fromMin:s.id==="rsi-context-v2"?120:570,toMin:925},profile:profileFrom(trades),
        geometry:{kind:"bootstrap",draws:trades.filter(t=>t.atrAtEntry && t.initialStop !== undefined).map(t=>({stopAtrMult:Math.abs(t.entryPrice-t.initialStop!)/t.atrAtEntry!,target:{kind:"rMultiple" as const,r:s.id==="rsi-context-v2"?1.5:2}}))},
        mode:"matchDayCounts",iterations:250},trades,candidatePool(req.series,{fromMin:s.id==="rsi-context-v2"?120:570,toMin:925}));
      percentile=nullRes.percentileAvgR;
    }
    const folds=combinatorialPurgedCv(trades.map(t=>({t0:t.entryTime,t1:t.exitTime})),6,2);
    const foldNet=folds.filter(f=>f.test.length).map(f=>f.test.reduce((sum,i)=>sum+pnl[i],0)/f.test.length);
    const stress=executeRun({...req,keepOpenAtEnd:false,execution:{...req.execution,cost:req.execution.cost*2,slippage:req.execution.slippage*2,
      friction:req.execution.friction?{...req.execution.friction,bySymbol:Object.fromEntries(Object.entries(req.execution.friction.bySymbol).map(([k,v])=>[k,{...v,slippageTicks:v.slippageTicks*2}]))}:undefined}});
    let peak=10000,equity=10000,dd=0; for(const t of stress.trades){equity+=t.pnl;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}
    results.push({...s,n:trades.length,net,rs,daily,sharpe:sd?avg/sd:0,percentile,foldNet,stressDrawdown:dd,
      datasetHash:stableHash(bars),configHash:researchConfigHash});
    console.log(`${s.key}: n=${trades.length}, net=${net.toFixed(2)}, stress DD=${dd.toFixed(2)}`);
  }
  const days=[...new Set(results.flatMap(r=>Object.keys(r.daily)))].sort();
  const pbo=days.length>=64?probabilityOfBacktestOverfitting(results.map(r=>days.map(d=>r.daily[d]??0)),{splits:8}):null;
  const dispersion=trialSharpeDispersion(results.map(r=>r.sharpe));
  const output=results.map(r=>{
    const evidence:PromotionEvidence={randomEntryPercentile:r.percentile,deflated:r.rs.length>2?deflatedSharpe(r.rs,totalTrials,dispersion):null,pbo,
      oosNetExpectancy:r.foldNet.length?r.foldNet.reduce((a,b)=>a+b,0)/r.foldNet.length:null,
      cvFoldSurvival:r.foldNet.length?r.foldNet.filter(n=>n>0).length/r.foldNet.length:null,trades:r.n};
    return {...r,stage:confirmation?"confirmation":"development",rs:undefined,daily:undefined,foldNet:undefined,evidence,gate:evaluatePromotion(evidence),codeHash:researchCodeHash(),confirmationPassed:false,
      note:"Development evidence. Independent contract confirmation and forward paper evidence still required."};
  });
  await transaction(async c=>{
    for(const r of output) {
      if(confirmation) await c.query(`INSERT INTO research_confirmations(id,candidate_key,code_hash,config_hash,outcome)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[stableHash({key:r.key,hash:r.datasetHash,config:r.configHash,code:r.codeHash}),r.key,r.codeHash,r.configHash,JSON.stringify(r)]);
      else { await c.query(`UPDATE research_trials SET status=$2,outcome=$3,decided_at=now()
        WHERE config_hash=$1 AND outcome IS NULL`,[stableHash({key:r.key,config:researchConfigHash}),"complete",JSON.stringify(r)]);
        await c.query(`INSERT INTO research_measurements(id,candidate_key,code_hash,config_hash,outcome) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[stableHash({key:r.key,hash:r.datasetHash,config:r.configHash,code:r.codeHash}),r.key,r.codeHash,r.configHash,JSON.stringify(r)]);
      }
    }
  });
  writeFileSync(`docs/research/2026-09-25-research-v2${confirmation?"-confirmation":""}.json`,JSON.stringify({version:RESEARCH_VERSION,totalTrials,confirmationFrom,results:output},null,2));
  console.log(`${output.filter(r=>r.gate.promote).length}/${output.length} ${confirmation?"confirmation":"development"} passes; independent confirmation remains required.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
