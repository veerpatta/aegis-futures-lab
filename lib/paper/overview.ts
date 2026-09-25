export interface Account { equity:number; peak:number; daily_pnl:number; open_risk:number; locked:boolean; day_key:string; updated_at:string; }
export interface Release { candidate_key:string; status:"active"|"probation"|"paused"; reason:string; activated_at:string; }
export interface Position { id:string; symbol:string; side:string; qty:number; entry:number; stop:number; target:number; risk:number; pnl:number|null; mark:number; opened_at:string; closed_at:string|null; reason:string; }
export interface Candidate { candidate_key:string; historical:Record<string,unknown>|null; confirmation:Record<string,unknown>|null; forward_closed:number; forward_days:number; forward_net:number; weekly_passes:number; }
export interface Activity { id:string; at:string; kind:string; status:string; detail:string; candidate_key?:string|null; }
export interface BotOverview { account:Account|null; release:Release|null; positions:Position[]; learning:{status:string; finished_at:string|null; started_at:string}|null; model:{status:string; train_n:number; oos_brier:number|null; baseline_brier:number|null}|null; }
export function botState(data:BotOverview|null, failed=false) {
  if(!data?.account || failed) return {label:"Status unavailable",tone:"amber" as const,reason:"Account status could not be verified. Check the last update before using these figures.",next:"Retry the account update."};
  if(data.account.locked) return {label:"Paused",tone:"red" as const,reason:"The account reached its drawdown limit. New practice trades are locked.",next:"Review the losses and risk limits. An explicit account reset is required."};
  const r=data.release;
  if(r?.status==="paused") return {label:"Paused",tone:"amber" as const,reason:r.reason,next:"Review the pause reason and latest checks on Bot."};
  if(r?.status==="active"||r?.status==="probation") return {label:r.status==="probation"?"Paper probation":"Paper active",tone:"green" as const,reason:r.status==="probation"?"A qualified strategy is practising with reduced risk.":"A qualified strategy is trading the practice account.",next:"Inspect the latest trade, then record your own decision in Journal."};
  return {label:"Researching",tone:"amber" as const,reason:"No strategy has passed every requirement for this practice account.",next:"Check the research progress on Bot. You can keep practising in Journal."};
}
const names:Record<string,string>={"zone-rejection-v2":"Zone rejection confirmation","rsi-context-v2":"RSI with market context","vwap-pullback-v1":"Trend pullback to VWAP","opening-continuation-v1":"Opening continuation","overnight-rejection-v1":"Failed overnight breakout"};
export function candidateName(key:string) {const parts=key.split(":");return `${names[parts.length>1?parts[1]:parts[0]]??"Research strategy"}${parts.length>2?` · ${parts[2]}`:""}`;}
export function freshTraining(run:BotOverview["learning"],now=Date.now()) {return !!run?.finished_at && run.status==="ok" && now-Date.parse(run.finished_at)<4*86400000;}
