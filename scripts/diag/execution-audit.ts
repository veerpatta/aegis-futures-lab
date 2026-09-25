/** Deterministic ambiguous-bar audit; quotes are evidence, not guaranteed fills. */
import {writeFileSync} from "node:fs";
import {transaction} from "@/lib/neon/server";
import {purchase} from "../engine/databento-purchase";
import {stableHash} from "../engine/learning-audit";
function rows(csv:string){const lines=csv.trim().split(/\r?\n/);const keys=lines.shift()!.split(",");return lines.filter(Boolean).map(l=>Object.fromEntries(l.split(",").map((v,i)=>[keys[i],v])));}
async function main(){
 const selected=await transaction(c=>c.query(`WITH candidates AS (
 SELECT DISTINCT ON(s.id) s.id,s.symbol,s.direction,s.stop_price,s.target_price,b.time,b.open,b.high,b.low,
 (b.high>=greatest(s.stop_price,s.target_price) AND b.low<=least(s.stop_price,s.target_price)) both_hit
 FROM signals s JOIN bars_5m b ON b.symbol=s.symbol AND b.source='databento'
 AND b.time=floor(extract(epoch from s.exit_ts)/300)*300
 WHERE s.exit_ts IS NOT NULL AND s.target_price IS NOT NULL AND s.symbol IN ('MES','MNQ')
 AND s.signal_ts>='2026-07-30' AND ((b.high>=greatest(s.stop_price,s.target_price) AND b.low<=least(s.stop_price,s.target_price))
 OR (s.direction='long' AND b.open<s.stop_price) OR (s.direction='short' AND b.open>s.stop_price))
 ORDER BY s.id,b.time), ranked AS (SELECT *,row_number() OVER(PARTITION BY symbol ORDER BY md5(id::text)) rank FROM candidates)
 SELECT * FROM ranked WHERE rank<=50 ORDER BY symbol,rank`));
 const selectionHash=stableHash(selected.rows);console.log({selected:selected.rows.length,selectionHash});
 const results=[];
 for(const s of selected.rows){const start=Math.floor(Number(s.time)/600)*600,end=start+600;
  const request={dataset:"GLBX.MDP3",stype_in:"continuous",symbols:s.symbol+".c.0",start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString()};
  const bars=rows((await purchase({...request,schema:"ohlcv-1s"})).csv).filter(b=>Number(BigInt(b.ts_event))/1e9>=Number(s.time)&&Number(BigInt(b.ts_event))/1e9<Number(s.time)+300);
  const quotes=rows((await purchase({...request,schema:"tbbo"})).csv);
  let first="unresolved";for(const b of bars){const stop=s.direction==='long'?Number(b.low)<=Number(s.stop_price):Number(b.high)>=Number(s.stop_price);const target=s.direction==='long'?Number(b.high)>=Number(s.target_price):Number(b.low)<=Number(s.target_price);if(stop||target){first=stop&&target?"same-second ambiguity":stop?"stop first":"target first";break;}}
  const spreads=quotes.map(q=>Number(q.ask_px_00)-Number(q.bid_px_00)).filter(x=>Number.isFinite(x)&&x>=0&&x<100);
  results.push({signal:s.id,symbol:s.symbol,bar:Number(s.time),bothHit:s.both_hit,first,seconds:bars.length,quoteRecords:quotes.length,meanQuotedSpread:spreads.length?spreads.reduce((a,b)=>a+b,0)/spreads.length:null});
 }
 const report={selectionHash,selected:results.length,results,note:"Deterministically selected ambiguous or gapped exits, not a representative execution sample. TBBO records quotes at trades, not guaranteed fills. Remaining ambiguity stays stop-first. No production cost or fill assumptions relaxed."};
 writeFileSync('docs/research/2026-09-25-execution-audit.json',JSON.stringify(report,null,2));console.log(report);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
