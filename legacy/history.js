const SYMBOLS={MES:'MES=F',MNQ:'MNQ=F'};

function nySession(time){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(time*1000)).reduce((a,p)=>(a[p.type]=p.value,a),{});
  const minutes=(Number(parts.hour)%24)*60+Number(parts.minute);
  return !['Sat','Sun'].includes(parts.weekday)&&minutes>=570&&minutes<930;
}

module.exports=async function handler(req,res){
  const requestUrl=new URL(req.url||'/',`https://${req.headers?.host||'localhost'}`);
  const symbol=String(requestUrl.searchParams.get('symbol')||'MES').toUpperCase();
  if(!SYMBOLS[symbol])return res.status(400).json({error:'Supported symbols: MES, MNQ'});
  try{
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOLS[symbol])}?interval=5m&range=60d&includePrePost=true&events=div%2Csplits`;
    const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AegisResearch/1.0','Accept':'application/json'}});
    if(!response.ok)throw new Error('Upstream response '+response.status);
    const json=await response.json(),result=json?.chart?.result?.[0];
    if(!result)throw new Error(json?.chart?.error?.description||'No chart result');
    const quote=result.indicators?.quote?.[0]||{};
    const completedBefore=Math.floor(Date.now()/300000)*300-300;
    const bars=(result.timestamp||[]).map((time,i)=>({time,open:quote.open?.[i],high:quote.high?.[i],low:quote.low?.[i],close:quote.close?.[i],volume:quote.volume?.[i]||0})).filter(b=>b.time%300===0&&b.time<=completedBefore&&[b.open,b.high,b.low,b.close].every(Number.isFinite)&&nySession(b.time));
    if(!bars.length)throw new Error('No valid New York-session candles');
    res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin','*');
    return res.status(200).json({symbol,vendorSymbol:SYMBOLS[symbol],mode:'HISTORICAL_DELAYED',delayed:true,source:'Free delayed Yahoo 5-minute adapter',session:'09:30–15:30 America/New_York',range:'60 calendar days',interval:'5m',fetchedAt:new Date().toISOString(),firstTimestamp:new Date(bars[0].time*1000).toISOString(),lastTimestamp:new Date(bars.at(-1).time*1000).toISOString(),bars});
  }catch(error){return res.status(502).json({error:'Free historical feed unavailable',detail:error.message,symbol})}
};
