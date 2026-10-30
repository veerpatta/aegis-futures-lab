/** Pure rules for a separate delayed-price AI shadow study. This module does
 * not read or write an account, call a model, or register a study. The caller
 * must persist the first actual receipt and the study's immutable rules. */
import { matchedRandomPercentile, sessionBootstrapMean } from '@/lib/experiment/stats';
import { seedOf } from '@/lib/experiment/hash';

export const SHADOW_BAR_SECONDS = 300;
export const SHADOW_MAX_IDEA_AGE_SECONDS = 1800;
export const SHADOW_MAX_DATA_AGE_SECONDS = 2700;

export interface ShadowSourceIdea {
  key: string; symbol: 'MES' | 'MNQ'; side: 'LONG' | 'SHORT'; strategy: string; tier: 'A' | 'B';
  status: string; signalTs: number; observedAt: number; dataAsOf: number | null;
  stale: boolean; orphaned: boolean; suppressed: boolean;
  entry: number; stop: number; target: number | null; score: number | null; rr: number | null;
}
export interface ShadowSnapshot {
  key: string; symbol: 'MES' | 'MNQ'; side: 'LONG' | 'SHORT'; strategy: string; tier: 'A' | 'B';
  signalTs: number; observedAt: number; dataAsOf: number; suppressed: boolean;
  /** These levels are for local simulation only, never the model input. */
  entry: number; stop: number; target: number | null;
  modelInput: { symbol: 'MES' | 'MNQ'; side: 'LONG' | 'SHORT'; strategy: string; tier: 'A' | 'B';
    paused: boolean; signalTime: string; riskPoints: number; rewardRisk: number | null; score: number | null };
}
export type CaptureReason = 'invalid' | 'before-study' | 'already-closed' | 'revised' | 'stale' | 'late' | 'missing-data';
export type CaptureResult = {kind:'eligible'; reason:null; snapshot:ShadowSnapshot} | {kind:'rejected'; reason:CaptureReason; snapshot:null};
const rejected = (reason:CaptureReason):CaptureResult => ({kind:'rejected',reason,snapshot:null});
const finite = (v:unknown):v is number => typeof v === 'number' && Number.isFinite(v);

/** Evaluate a producer's first real receipt; never infer a receipt by replaying
 * an old signal. Caller must use a unique (study,key) constraint and freeze it. */
export function captureShadowIdea(row:ShadowSourceIdea, studyStartedAt:number):CaptureResult {
  if (!row || !Number.isSafeInteger(studyStartedAt) || !Number.isSafeInteger(row.signalTs) || row.signalTs < 0 || row.signalTs > 8640000000000 || !Number.isSafeInteger(row.observedAt) ||
      typeof row.key !== 'string' || !row.key || row.key.length > 256 || typeof row.strategy !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(row.strategy) ||
      !['MES','MNQ'].includes(row.symbol) || !['LONG','SHORT'].includes(row.side) || !['A','B'].includes(row.tier) ||
      typeof row.stale !== 'boolean' || typeof row.orphaned !== 'boolean' || typeof row.suppressed !== 'boolean') return rejected('invalid');
  if (row.observedAt < studyStartedAt) return rejected('before-study');
  if (row.orphaned) return rejected('revised');
  if (row.stale) return rejected('stale');
  if (!['pending','triggered'].includes(row.status)) return rejected('already-closed');
  if (!finite(row.dataAsOf) || row.dataAsOf > row.observedAt || !finite(row.entry) || !finite(row.stop) || row.entry <= 0 || row.stop <= 0 ||
      (row.target !== null && (!finite(row.target) || row.target <= 0)) ||
      (row.score !== null && !finite(row.score)) || (row.rr !== null && !finite(row.rr))) return rejected('missing-data');
  const availableAt = row.signalTs + SHADOW_BAR_SECONDS;
  if (availableAt > row.observedAt || availableAt > row.dataAsOf) return rejected('missing-data');
  if (row.observedAt - availableAt > SHADOW_MAX_IDEA_AGE_SECONDS) return rejected('late');
  if (row.observedAt - row.dataAsOf > SHADOW_MAX_DATA_AGE_SECONDS) return rejected('stale');
  if (row.entry === row.stop || (row.side === 'LONG' ? row.stop >= row.entry : row.stop <= row.entry) ||
      (row.target !== null && (row.side === 'LONG' ? row.target <= row.entry : row.target >= row.entry))) return rejected('invalid');
  const modelInput:ShadowSnapshot['modelInput'] = { symbol:row.symbol, side:row.side, strategy:row.strategy, tier:row.tier,
    paused:row.suppressed, signalTime:new Date(row.signalTs*1000).toISOString(),
    riskPoints: Math.round(Math.abs(row.entry-row.stop)*10000)/10000, rewardRisk:row.rr, score:row.score };
  return {kind:'eligible',reason:null,snapshot:{key:row.key,symbol:row.symbol,side:row.side,strategy:row.strategy,tier:row.tier,
    signalTs:row.signalTs,observedAt:row.observedAt,dataAsOf:row.dataAsOf,suppressed:row.suppressed,
    entry:row.entry,stop:row.stop,target:row.target,modelInput}};
}

export type ShadowAction = 'take'|'skip'|'abstain';
export interface ShadowDecision { decision:ShadowAction; rationale:string }
/** Refuse extra fields, non-string rationale and instructions masquerading as
 * an action. The rationale is display-only and must be escaped by the UI. */
export function parseShadowDecision(value:unknown):ShadowDecision|null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj=value as Record<string,unknown>;
  if (Object.keys(obj).some(k=>k!=='decision' && k!=='rationale') ||
      !['take','skip','abstain'].includes(String(obj.decision)) || typeof obj.rationale !== 'string' ||
      !obj.rationale.trim() || obj.rationale.length > 1200) return null;
  return {decision:obj.decision as ShadowAction,rationale:obj.rationale.trim()};
}

/** Both bar opening and actual receipt must follow the response. Using the
 * delayed bar's market timestamp as its receipt time would introduce hindsight. */
export function nextShadowBar<T extends {time:number; observedAt:number}>(bars:readonly T[],responseAt:number,now:number):T|null {
  if (!finite(responseAt) || !finite(now) || now < responseAt) return null;
  return [...bars].filter(b => finite(b.time) && finite(b.observedAt) && b.time > responseAt &&
    b.observedAt >= b.time + SHADOW_BAR_SECONDS && b.observedAt <= now)
    .sort((a,b)=>a.time-b.time)[0] ?? null;
}

export interface ShadowComparisonRow { key:string; session:string; decision:ShadowAction|null; net:number|null }
/** Per-opportunity comparison, not a portfolio or promotion verdict.
 * Unscored and unresolved rows are removed identically from every control. */
export function compareShadowResults(rows:readonly ShadowComparisonRow[],seed:string,iterations=1000) {
  if (!seed || !Number.isInteger(iterations) || iterations < 1 || iterations > 10000) throw new Error('Invalid random comparison configuration');
  const seen=new Set<string>();
  for (const r of rows) {
    if (!r.key || seen.has(r.key)) throw new Error('Duplicate or missing opportunity key');
    seen.add(r.key);
    if (!r.session || (r.decision !== null && !['take','skip','abstain'].includes(r.decision)) || (r.net !== null && !finite(r.net))) throw new Error('Invalid shadow comparison row');
  }
  const scored=[...rows].sort((a,b)=>a.session.localeCompare(b.session)||a.key.localeCompare(b.key)).filter(r=>r.decision!==null);
  const comparable=scored.filter((r):r is ShadowComparisonRow & {decision:ShadowAction;net:number} => r.net!==null && r.decision!==null);
  const taken=comparable.filter(r=>r.decision==='take');
  const paired=comparable.map(r=>({session:r.session,value:r.net,take:r.decision==='take'}));
  const deltas=comparable.map(r=>({session:r.session,value:(r.decision==='take'?r.net:0)-r.net}));
  const interval=new Set(deltas.map(x=>x.session)).size > 1 ? sessionBootstrapMean(deltas,iterations,seedOf(seed,'bootstrap'),0.05) : null;
  return {eligible:rows.length,scored:scored.length,resolved:comparable.length,abstained:scored.filter(r=>r.decision==='abstain').length,
    taken:taken.length,modelNet:taken.reduce((s,r)=>s+r.net,0),takeAllNet:comparable.reduce((s,r)=>s+r.net,0),noTradeNet:0,
    randomN:taken.length,randomPercentile:taken.length ? matchedRandomPercentile(paired,iterations,seedOf(seed,'random')) : null,
    deltaPerIdea: interval && Number.isFinite(interval.lo) && Number.isFinite(interval.hi) ? interval : null,
    verdict:'inconclusive' as const};
}
