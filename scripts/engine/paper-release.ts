import { transaction } from "@/lib/neon/server";
import { RESEARCH_IDS } from "@/lib/strategies/research-v2";
import { releaseEligible, freshWeeklyEvidence, type ForwardEvidence } from "@/lib/paper/policy";
import { ALL_RESEARCH_IDS, candidateKey, researchConfigHash } from "./research-observer";
import { stableHash } from "./learning-audit";
import { nyMeta } from "@/lib/time/ny";
import { researchCodeHash } from "./research-code";

/** The only automatic release route. Executable candidates must exist in this deployed registry. */
export async function evaluatePaperReleases() {
  const now = new Date().toISOString();
  return transaction(async c => {
    await c.query("SELECT * FROM paper_account WHERE id=1 FOR UPDATE");
    const decisions=[];
    const ranked=await c.query("SELECT trial_key FROM research_trials WHERE outcome IS NOT NULL ORDER BY (outcome->>'net')::numeric DESC NULLS LAST, (outcome->>'stressDrawdown')::numeric ASC NULLS LAST, trial_key");
    const registered=ALL_RESEARCH_IDS.flatMap(id=>["MES","MNQ"].map(symbol=>candidateKey(id,symbol)));
    const keys=[...new Set([...ranked.rows.map(r=>r.trial_key).filter(k=>registered.includes(k)),...registered])];
    for(const key of keys) {
      const trials=await c.query("SELECT outcome,config_hash,code_sha FROM research_trials WHERE trial_key=$1 AND config_hash=$2",[key,stableHash({key,config:researchConfigHash})]);
      const measurement=await c.query("SELECT outcome FROM research_measurements WHERE candidate_key=$1 AND code_hash=$2 AND config_hash=$3 ORDER BY measured_at DESC LIMIT 1",[key,researchCodeHash(),researchConfigHash]);
      const trial=trials.rows[0], historical=measurement.rows[0]?.outcome??trial?.outcome;
      const confirmations=await c.query("SELECT outcome FROM research_confirmations WHERE candidate_key=$1 AND code_hash=$2 AND config_hash=$3 ORDER BY measured_at DESC LIMIT 1",[key,researchCodeHash(),researchConfigHash]);
      const confirmation=confirmations.rows[0]?.outcome;
      const rows=await c.query(`SELECT observation_key,signal_ts,exit_ts,payload FROM research_observations
        WHERE candidate_key=$1 AND provenance='forward' AND exit_ts IS NOT NULL AND exit_ts<=$2 AND jsonb_typeof(payload->'pnl')='number'
        AND code_hash=$3 AND config_hash=$4 AND intent IS NOT NULL
        ORDER BY signal_ts,observation_key`,[key,now,researchCodeHash(),researchConfigHash]);
      const pnl=rows.rows.map(r=>Number(r.payload.pnl));
      if(pnl.some(x=>!Number.isFinite(x))) throw new Error("Invalid forward outcome");
      const wins=pnl.filter(p=>p>0).reduce((a,b)=>a+b,0),loss=-pnl.filter(p=>p<0).reduce((a,b)=>a+b,0);
      const evidence:ForwardEvidence={closed:pnl.length,days:new Set(rows.rows.map(r=>nyMeta(Date.parse(r.signal_ts)/1000).dateKey)).size,
        net:pnl.reduce((a,b)=>a+b,0),pf:loss?wins/loss:wins?999:null,fingerprint:stableHash(rows.rows),evaluatedAt:now};
      const previous=await c.query("SELECT evidence FROM paper_evaluations WHERE candidate_key=$1 AND evidence ? 'forward' ORDER BY evaluated_at DESC LIMIT 1",[key]);
      const prior=previous.rows[0]?.evidence.forward as ForwardEvidence|undefined;
      const pass=historical?.codeHash===researchCodeHash() && historical?.configHash===researchConfigHash && confirmation?.stage==="confirmation" && confirmation?.gate?.promote===true &&
        releaseEligible(historical.evidence,historical.stressDrawdown,prior??null,evidence);
      const codeHash=historical?.codeHash ?? "unverified";
      const inserted=await c.query(`INSERT INTO paper_evaluations(candidate_key,fingerprint,code_hash,config_hash,evidence)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(candidate_key,fingerprint) DO NOTHING RETURNING id`,
        [key,evidence.fingerprint,codeHash,researchConfigHash,JSON.stringify({forward:evidence,historical:historical??null,confirmation:confirmation??null,pass:!!pass})]);
      const active=await c.query("SELECT * FROM paper_releases WHERE status IN ('probation','active') FOR UPDATE");
      if(inserted.rows.length && pass && codeHash!=="unverified") {
        if(!active.rows.length) await c.query(`INSERT INTO paper_releases(candidate_key,evaluation_id,code_hash,config_hash,status,reason)
          VALUES($1,$2,$3,$4,'probation','Every historical and forward gate passed; $25 risk probation')`,[key,inserted.rows[0].id,codeHash,researchConfigHash]);
        else if(active.rows[0].candidate_key===key && active.rows[0].status==="probation" && prior && freshWeeklyEvidence(prior,evidence))
          await c.query("UPDATE paper_releases SET status='active',evaluation_id=$2,reason='Fresh weekly pass after probation; $50 risk' WHERE id=$1",[active.rows[0].id,inserted.rows[0].id]);
      } else if(active.rows[0]?.candidate_key===key && (!pass || !inserted.rows.length)) {
        // Repeated unchanged evidence never promotes; only an actual failed fresh evaluation pauses.
        if(inserted.rows.length && !pass) await c.query("UPDATE paper_releases SET status='paused',reason='Weekly evidence no longer qualifies' WHERE id=$1",[active.rows[0].id]);
      }
      decisions.push({candidate:key,closed:evidence.closed,days:evidence.days,net:evidence.net,eligible:!!pass});
    }
    return decisions;
  });
}
if (process.argv[1]?.replaceAll("\\","/").endsWith("/paper-release.ts"))
  evaluatePaperReleases().then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
