import { readFileSync, writeFileSync } from "node:fs";
import { transaction } from "@/lib/neon/server";
import { effectiveTrialCount } from "../engine/trial-count";
import { stableHash } from "../engine/learning-audit";
import { expectedMaxSharpe, probabilisticSharpe, DSR_THRESHOLD, HLZ_T_HURDLE } from "@/lib/validation/deflatedSharpe";
import { evaluatePromotion } from "@/lib/validation/promotionGate";
async function main(){
  await transaction(c=>c.query(`INSERT INTO research_trials(trial_key,hypothesis,prediction,decision_rule,config_hash,params,dataset,status,outcome,decided_at)
    VALUES('historical-gold-2026-08-21','Historical gold-silver-zone benchmark inventory','Retrospective inventory; not a preregistration','Count this known prior test in multiplicity corrections','historical-gold-inventory-2026-08-21','{"retrospective":true}','{"source":"databento","symbols":["MGC"]}','complete','{"reference":"docs/research/2026-08-21-gold-benchmark.md","refuted":true}',now()) ON CONFLICT(config_hash) DO NOTHING`));
  const counted=await transaction(c=>c.query("SELECT params,dataset FROM research_trials"));
  const trials=effectiveTrialCount(counted.rows);
  const file="docs/research/2026-09-25-research-v2.json", report=JSON.parse(readFileSync(file,"utf8"));
  report.originalRegistryRowCount ??= report.totalTrials;
  report.totalTrials=trials;
  report.multiplicityCorrection="Expand bundled market/control trials and include the previously unregistered gold test. Original write-once outcomes are retained; corrected evaluations are appended.";
  for(const r of report.results){
    const d=r.evidence.deflated;
    if(d){ d.trials=trials;d.expectedMaxSharpe=expectedMaxSharpe(trials,d.trialSharpeStdev);d.dsr=probabilisticSharpe(d,d.expectedMaxSharpe);d.significant=d.dsr>DSR_THRESHOLD&&d.tStat>HLZ_T_HURDLE; }
    r.gate=evaluatePromotion(r.evidence);
    await transaction(c=>c.query(`INSERT INTO paper_evaluations(candidate_key,fingerprint,code_hash,config_hash,evidence)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[r.key,stableHash({stage:"multiplicity-correction",trials,key:r.key}),r.codeHash,r.configHash,JSON.stringify({stage:"multiplicity-correction",historical:r,pass:false})]));
  }
  writeFileSync(file,JSON.stringify(report,null,2));console.log(`Corrected trial count: ${trials}; ${report.results.filter((r:{gate:{promote:boolean}})=>r.gate.promote).length}/6 pass. Original outcomes preserved.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
