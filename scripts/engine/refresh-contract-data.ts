import {purchase,metadata} from "./databento-purchase";
import {bars5mFromOhlcv1mCsv} from "@/lib/data/databento";
import {transaction} from "@/lib/neon/server";
import {nyMeta} from "@/lib/time/ny";
import {holidayFor} from "@/lib/market/holidays";
async function main(){
 const range=await metadata("metadata.get_dataset_range",{dataset:"GLBX.MDP3"});
 const available=Date.parse(range.schemas?.["ohlcv-1m"]?.end??range.end);if(!Number.isFinite(available))throw new Error("Availability unknown");
 const cutoff=Math.floor((available-600000)/86400000)*86400000;
 const requested=process.env.DATA_CUTOFF?Date.parse(process.env.DATA_CUTOFF):cutoff;
 const end=Math.min(cutoff,requested);if(!Number.isFinite(end))throw new Error("Invalid cutoff");
 let count=0;const gaps:string[]=[];
 for(const symbol of ["MES","MNQ"] as const)for(let day=Date.parse("2026-07-30T00:00:00Z");day<end;day+=86400000){
  const utc=new Date(day).getUTCDay();if(utc===6||utc===0)continue;
  const from=new Date(day).toISOString(),to=new Date(day+86400000+600000).toISOString();
  const request={dataset:"GLBX.MDP3",schema:"ohlcv-1m",stype_in:"continuous",symbols:symbol+".c.0",start:from,end:to};
  const got=await purchase(request);
  const previous=await transaction(c=>c.query("SELECT status FROM private_research.data_purchases WHERE id=$1",[got.id]));if(previous.rows[0]?.status==="imported")continue;
  const bars=bars5mFromOhlcv1mCsv(got.csv,{rawPrices:false},request.symbols).filter(b=>b.time>=day/1000&&b.time<(day+86400000)/1000);
  if(!bars.length&&holidayFor(nyMeta(day/1000+43200).dateKey)?.kind!=="closed")gaps.push(symbol+":"+from);
  await transaction(async c=>{
   await c.query(`INSERT INTO public.bars_5m(symbol,source,time,open,high,low,close,volume)
    SELECT $1,'databento',x.time,x.open,x.high,x.low,x.close,x.volume FROM jsonb_to_recordset($2::jsonb) AS x(time bigint,open double precision,high double precision,low double precision,close double precision,volume double precision)
    ON CONFLICT(symbol,source,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume`,[symbol,JSON.stringify(bars)]);
   await c.query("UPDATE private_research.data_purchases SET status='imported',report=$2 WHERE id=$1",[got.id,JSON.stringify({bars:bars.length,first:bars[0]?.time,last:bars.at(-1)?.time})]);
  });count+=bars.length;
 }
 const budget=await transaction(c=>c.query("SELECT sum(quoted_usd) quoted,sum(reserved_usd) reserved,count(*) requests FROM private_research.data_purchases"));
 console.log(JSON.stringify({end:new Date(end).toISOString(),rows:count,emptyWeekdays:gaps,budget:budget.rows[0],balanceSource:"User-attested $102.76, September 25; estimates are not provider billing"}));if(gaps.length)throw new Error("Unexpected empty weekdays require review");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
