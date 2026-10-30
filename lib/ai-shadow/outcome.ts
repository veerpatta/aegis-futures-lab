/** Prospective, one-contract virtual outcomes. Receipt records must come from
 * the first live feed receipt, persisted immutably; an archive's market time is
 * not evidence of when Aegis observed a bar. No account or order is touched. */
import type { Bar } from '@/lib/types';
import { newSimTrade, simulate } from '@/lib/experiment/execution';
import { EXP_RISK } from '@/lib/experiment/policy';
import type { SimTrade } from '@/lib/experiment/types';
import { tradingDayKey } from '@/lib/time/ny';
import { SHADOW_BAR_SECONDS, type ShadowSnapshot } from './study';

export interface ReceivedShadowBar extends Bar {
  symbol:'MES'|'MNQ'; source:'yahoo'|'databento';
  /** Actual persisted first receipt, unix seconds, not the market timestamp. */
  observedAt:number;
}
export type ShadowOutcome =
  | {status:'waiting';reason:'first-bar-unavailable'|'missing-bar'|'trade-open'}
  | {status:'invalid';reason:'invalid-receipt'|'duplicate-bar'|'invalid-input'}
  | {status:'cancelled'|'closed';trade:SimTrade;lastBar:number};

/** The first bar must begin strictly after the model's actual response and all
 * bars must be contiguous. Missing bars never become profitable hindsight.
 * Input receipt records must be immutable and selected from the study's fixed
 * source. Cancelled hypothetical entries remain separate from realized P&L. */
export function evaluateShadowOutcome(input:{snapshot:ShadowSnapshot;responseAt:number;source:ReceivedShadowBar['source'];bars:readonly ReceivedShadowBar[];now:number}):ShadowOutcome {
  const {snapshot,responseAt,source,bars,now}=input;
  if (!snapshot || snapshot.suppressed || !Number.isSafeInteger(responseAt) || !Number.isSafeInteger(now) || responseAt < snapshot.observedAt || now < responseAt || !['yahoo','databento'].includes(source)) return {status:'invalid',reason:'invalid-input'};
  const seen=new Set<number>();
  const available:ReceivedShadowBar[]=[];
  for (const b of bars) {
    if (!Number.isSafeInteger(b.time) || b.time%SHADOW_BAR_SECONDS!==0 || !Number.isSafeInteger(b.observedAt) || b.observedAt < b.time+SHADOW_BAR_SECONDS || b.symbol!==snapshot.symbol || b.source!==source ||
      ![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0) || b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close,b.high)) return {status:'invalid',reason:'invalid-receipt'};
    if (seen.has(b.time)) return {status:'invalid',reason:'duplicate-bar'};
    seen.add(b.time);
    if (b.time>responseAt && b.observedAt<=now) available.push(b);
  }
  available.sort((a,b)=>a.time-b.time);
  const first=(Math.floor(responseAt/SHADOW_BAR_SECONDS)+1)*SHADOW_BAR_SECONDS;
  if (!available.length || available[0].time!==first) return {status:'waiting',reason:'first-bar-unavailable'};
  let trade=newSimTrade({symbol:snapshot.symbol,side:snapshot.side,qty:1,stop:snapshot.stop,target:snapshot.target,decidedAt:responseAt+1,sessionKey:tradingDayKey(responseAt)});
  for (let i=0;i<available.length;i++) {
    if (available[i].time!==first+i*SHADOW_BAR_SECONDS) return {status:'waiting',reason:'missing-bar'};
    trade=simulate(trade,[available[i]],{maxRisk:EXP_RISK.riskPerTrade});
    if (trade.status==='closed' || trade.status==='cancelled') return {status:trade.status,trade,lastBar:available[i].time};
  }
  return {status:'waiting',reason:'trade-open'};
}
