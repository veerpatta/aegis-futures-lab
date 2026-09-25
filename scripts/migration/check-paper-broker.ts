import { transaction } from '../../lib/neon/server';
import { runPaperBroker } from '../engine/paper-broker';
import { researchCodeHash } from '../engine/research-code';
import { researchConfigHash, candidateKey } from '../engine/research-observer';
if (!process.env.DATABASE_URL?.includes('ep-billowing-recipe-b3sx1q0t')) throw new Error('Integration requires the isolated test branch');
async function main(){
 const key='broker-integration-'+Date.now(), code=researchCodeHash(), candidate=candidateKey('vwap-pullback-v1','MES');
 const t=Date.parse('2026-09-24T14:00:00Z')/1000;
 await transaction(async c=>{
  await c.query("UPDATE paper_releases SET status='paused' WHERE status IN ('active','probation')");
  await c.query("UPDATE paper_account SET equity=10000,peak=10000,day_start_equity=10000,daily_pnl=0,open_risk=0,day_key='',last_bar_ts=NULL,locked=false WHERE id=1");
  const e=await c.query("INSERT INTO paper_evaluations(candidate_key,fingerprint,code_hash,config_hash,evidence) VALUES($1,$2,$3,$4,'{\"pass\":true}') RETURNING id",[candidate,key,code,researchConfigHash]);
  await c.query("INSERT INTO paper_releases(candidate_key,activated_at,evaluation_id,code_hash,config_hash,status,reason) VALUES($1,now()-interval '1 day',$2,$3,$4,'probation','Isolated branch integration test')",[candidate,e.rows[0].id,code,researchConfigHash]);
  const intent=JSON.stringify({side:'LONG',stop:97,target:{kind:'rMultiple',r:2},status:'pending'});
  await c.query("INSERT INTO research_observations(observation_key,candidate_key,strategy_version,source,provenance,signal_ts,payload,intent,code_hash,config_hash) VALUES($1,$2,'test','yahoo','forward',to_timestamp($3),$4,$4,$5,$6)",[key,candidate,t,intent,code,researchConfigHash]);
 });
 const bar={time:t,open:100,high:101,low:99,close:100,volume:100};
 await Promise.all([runPaperBroker({MES:[bar],MNQ:[bar]},t+300),runPaperBroker({MES:[bar],MNQ:[bar]},t+300)]);
 let result=await transaction(c=>c.query('SELECT qty,risk,closed_at FROM paper_positions WHERE id=$1',[key]));
 if(result.rows.length!==1||Number(result.rows[0].qty)!==1||Math.abs(Number(result.rows[0].risk)-19.9)>.001)throw new Error('Concurrent entry or sizing mismatch');
 const gap={...bar,time:t+300,open:90,high:91,low:89,close:90};
 await runPaperBroker({MES:[bar,gap],MNQ:[bar,gap]},t+600);
 result=await transaction(c=>c.query('SELECT pnl,closed_at FROM paper_positions WHERE id=$1',[key]));
 if(!result.rows[0].closed_at||Math.abs(Number(result.rows[0].pnl)+54.9)>.001)throw new Error('Gap fill/cost mismatch');
 const before=await transaction(c=>c.query('SELECT equity FROM paper_account WHERE id=1'));
 await runPaperBroker({MES:[bar,gap],MNQ:[bar,gap]},t+600);
 const after=await transaction(c=>c.query('SELECT equity FROM paper_account WHERE id=1'));
 if(Number(before.rows[0].equity)!==Number(after.rows[0].equity))throw new Error('Replay changed closed P&L');
 await transaction(c=>c.query("UPDATE paper_releases SET status='paused',reason='Integration completed' WHERE status IN ('active','probation')"));
 console.log('PASS: concurrent entry serialized, probation sizing includes costs, gap stop charged, replay idempotent');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
