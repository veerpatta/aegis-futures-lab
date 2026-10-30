/** Research-only matched opportunity summary. This queries the current source
 * and revisions as well as append-only invalidations, so corrected evidence is
 * excluded even before a scheduler can append an invalidation event. */
import type { ResearchQuery } from '@/lib/ai-store/research';
import type { ShadowStudy } from './processor';
import { compareShadowResults, parseShadowDecision, type ShadowComparisonRow, type ShadowSnapshot } from './study';
import { tradingDayKey } from '@/lib/time/ny';

const iso=(v:unknown):string|null=>{
  const d=v instanceof Date?v:new Date(String(v));
  return Number.isFinite(d.getTime())?d.toISOString():null;
};
export async function readShadowSummary(db:ResearchQuery,study:ShadowStudy) {
  const result=await db.query(`SELECT s.opportunity_key,s.observed_at,s.eligibility,s.rejection_reason,s.payload,
    d.payload AS decision_payload,o.payload AS outcome_payload,
    i.kind AS invalidation_kind,src.dedupe_key AS source_key,src.orphaned,src.entry_price,src.stop_price,src.target_price,
    EXISTS (SELECT 1 FROM public.ai_shadow_bar_revisions r WHERE r.study_id=s.study_id AND r.symbol=s.symbol
      AND o.kind='outcome' AND r.bar_time >= (o.payload->>'firstBar')::bigint AND r.bar_time <= (o.payload->>'lastBar')::bigint) AS bar_revised
    FROM public.ai_shadow_snapshots s
    LEFT JOIN LATERAL (SELECT payload FROM public.ai_shadow_events WHERE study_id=s.study_id AND opportunity_key=s.opportunity_key AND kind='decision' LIMIT 1) d ON true
    LEFT JOIN LATERAL (SELECT kind,payload FROM public.ai_shadow_events WHERE study_id=s.study_id AND opportunity_key=s.opportunity_key AND kind IN ('outcome','outcome-invalid') LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT kind FROM public.ai_shadow_events WHERE study_id=s.study_id AND opportunity_key=s.opportunity_key AND kind='outcome-invalidated' LIMIT 1) i ON true
    LEFT JOIN public.signals src ON src.dedupe_key=s.opportunity_key WHERE s.study_id=$1 ORDER BY s.observed_at,s.opportunity_key`,[study.id]);
  const rows:ShadowComparisonRow[]=[];
  let rejected=0,invalidated=0,cancelled=0,unresolved=0;
  const times:string[]=[];
  for (const row of result.rows) {
    if (row.eligibility!=='eligible') {rejected++;continue;}
    const observed=iso(row.observed_at), snapshot=row.payload as ShadowSnapshot|null;
    if (!observed || !snapshot || typeof row.opportunity_key!=='string' || snapshot.key!==row.opportunity_key) throw new Error('Invalid shadow snapshot');
    times.push(observed);
    const decisionRow=row.decision_payload as {decision?:unknown;responseAt?:unknown}|null;
    // Paused opportunities remain visible in the captured population, but
    // cannot enter the compared decision or simulated trade population.
    const decision=snapshot.suppressed ? null : parseShadowDecision(decisionRow?.decision)?.decision ?? null;
    const output=row.outcome_payload as {status?:unknown;trade?:{net?:unknown}}|null;
    const sourceOkay=!!row.source_key && row.orphaned===false && Number(row.entry_price)===snapshot.entry && Number(row.stop_price)===snapshot.stop &&
      (row.target_price===null?snapshot.target===null:Number(row.target_price)===snapshot.target);
    const invalid=row.invalidation_kind==='outcome-invalidated' || row.bar_revised===true || (decision!==null && !sourceOkay) || (!!output && output.status!=='closed' && output.status!=='cancelled');
    let net:number|null=null;
    if (invalid) invalidated++;
    else if (decision && output?.status==='cancelled') {cancelled++;net=0;}
    else if (decision && output?.status==='closed' && typeof output.trade?.net==='number' && Number.isFinite(output.trade.net)) net=output.trade.net;
    else if (decision) unresolved++;
    const decisionTime=typeof decisionRow?.responseAt==='number' && Number.isSafeInteger(decisionRow.responseAt) ? decisionRow.responseAt : snapshot.observedAt;
    rows.push({key:snapshot.key,session:tradingDayKey(decisionTime),decision,net});
  }
  times.sort();
  return {status:'available' as const,study:{...study,registeredAt:new Date(study.registeredAt*1000).toISOString()},
    period:{firstObservedAt:times[0]??null,lastObservedAt:times[times.length-1]??null},
    comparison:compareShadowResults(rows,study.id),rejected,invalidated,cancelled,unresolved,
    assumptions:{costVersion:'cost-realistic-2026-08-17',execution:'One-contract virtual execution with modeled fees and adverse slippage',source:'yahoo',seed:'study ID'}};
}
