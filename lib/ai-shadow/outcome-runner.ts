/** Append-only materialization of prospective virtual outcomes. Consumers must
 * exclude outcome-invalidated rows and also join current bar revisions; the
 * latter prevents a correction racing a scheduled invalidation from appearing
 * in an evidence summary. Never reads the historical bar archive. */
import { stableHash } from '@/lib/experiment/hash';
import type { ResearchQuery } from '@/lib/ai-store/research';
import { evaluateShadowOutcome, type ReceivedShadowBar } from './outcome';
import { parseShadowDecision, type ShadowSnapshot } from './study';

const seconds=(v:unknown)=>v instanceof Date ? Math.floor(v.getTime()/1000) : Math.floor(Date.parse(String(v))/1000);
const keyOf=(study:string,key:string,phase:string)=>`${phase}:${stableHash([study,key])}`;

export async function processShadowOutcomes(db:ResearchQuery,studyId:string,now:number):Promise<{closed:number;cancelled:number;waiting:number;invalid:number}> {
  if (!studyId || !Number.isSafeInteger(now)) throw new Error('Invalid shadow outcome batch.');
  const totals={closed:0,cancelled:0,waiting:0,invalid:0};
  // Revisions may arrive after a result. Keep the earlier event untouched and
  // append a distinct invalidation. An evidence query must also check revisions.
  await db.query(`INSERT INTO public.ai_shadow_events(event_key,study_id,opportunity_key,kind,occurred_at,payload)
    SELECT 'outcome-invalidated:' || encode(sha256(convert_to(json_build_array(o.study_id,o.opportunity_key)::text,'UTF8')),'hex'),
      o.study_id,o.opportunity_key,'outcome-invalidated',clock_timestamp(),'{"reason":"source-or-bar-revised"}'::jsonb
    FROM public.ai_shadow_events o JOIN public.ai_shadow_snapshots s ON s.study_id=o.study_id AND s.opportunity_key=o.opportunity_key
    LEFT JOIN public.signals src ON src.dedupe_key=s.opportunity_key
    WHERE o.study_id=$1 AND o.kind='outcome' AND (src.dedupe_key IS NULL OR src.orphaned IS DISTINCT FROM false
      OR src.entry_price::numeric IS DISTINCT FROM (s.payload->>'entry')::numeric
      OR src.stop_price::numeric IS DISTINCT FROM (s.payload->>'stop')::numeric
      OR src.target_price::numeric IS DISTINCT FROM (s.payload->>'target')::numeric OR EXISTS (
      SELECT 1 FROM public.ai_shadow_bar_revisions r WHERE r.study_id=o.study_id AND r.symbol=s.symbol
      AND r.bar_time >= (o.payload->>'firstBar')::bigint AND r.bar_time <= (o.payload->>'lastBar')::bigint))
    ON CONFLICT (event_key) DO NOTHING`,[studyId]);
  const decisions=await db.query(`SELECT s.opportunity_key,s.payload,d.payload AS decision_payload,
      src.orphaned,src.entry_price,src.stop_price,src.target_price
    FROM public.ai_shadow_snapshots s JOIN public.ai_shadow_events d ON d.study_id=s.study_id AND d.opportunity_key=s.opportunity_key AND d.kind='decision'
    LEFT JOIN public.signals src ON src.dedupe_key=s.opportunity_key
    WHERE s.study_id=$1 AND NOT EXISTS (SELECT 1 FROM public.ai_shadow_events o WHERE o.study_id=s.study_id AND o.opportunity_key=s.opportunity_key AND o.kind IN ('outcome','outcome-invalid'))
    ORDER BY d.occurred_at ASC LIMIT 100`,[studyId]);
  for (const row of decisions.rows) {
    const key=typeof row.opportunity_key==='string'?row.opportunity_key:'';
    const snapshot=row.payload as ShadowSnapshot;
    const event=row.decision_payload as {responseAt?:unknown;decision?:unknown}|null;
    const responseAt=event?.responseAt;
    const valid=!!key && !!snapshot && snapshot.key===key && typeof responseAt==='number' && !!parseShadowDecision(event?.decision) &&
      row.orphaned===false && Number(row.entry_price)===snapshot.entry && Number(row.stop_price)===snapshot.stop &&
      (row.target_price===null?snapshot.target===null:Number(row.target_price)===snapshot.target);
    let result:ReturnType<typeof evaluateShadowOutcome>={status:'invalid',reason:'invalid-input'};
    let firstBar=0,lastBar=0;
    if (valid) {
      firstBar=(Math.floor(responseAt!/300)+1)*300;
      const selected=await db.query(`SELECT b.bar_time,b.symbol,b.source,b.open,b.high,b.low,b.close,b.observed_at,
        EXISTS(SELECT 1 FROM public.ai_shadow_bar_revisions r WHERE r.study_id=b.study_id AND r.symbol=b.symbol AND r.bar_time=b.bar_time) AS revised
        FROM public.ai_shadow_bars b WHERE b.study_id=$1 AND b.symbol=$2 AND b.bar_time >= $3 AND b.observed_at <= to_timestamp($4)
        ORDER BY b.bar_time LIMIT 2000`,[studyId,snapshot.symbol,firstBar,now]);
      const bars=selected.rows.map(b=>({time:Number(b.bar_time),symbol:b.symbol,source:b.source,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),observedAt:seconds(b.observed_at)} as ReceivedShadowBar));
      result=evaluateShadowOutcome({snapshot,responseAt:responseAt!,source:'yahoo',bars,now});
      if (result.status==='closed' || result.status==='cancelled') {
        lastBar=result.lastBar;
        if (selected.rows.some(b=>Number(b.bar_time)<=lastBar && b.revised===true)) result={status:'invalid',reason:'invalid-receipt'};
      }
    }
    // A lost bar cannot leave a permanently pending head-of-line item and
    // starve later observations. The immutable decision remains visible.
    if (result.status==='waiting' && now-(responseAt as number) > 48*60*60) result={status:'invalid',reason:'invalid-receipt'};
    if (result.status==='waiting') {totals.waiting++;continue;}
    const phase=result.status==='invalid'?'outcome-invalid':'outcome';
    const payload=result.status==='invalid'?{reason:result.reason}:{status:result.status,firstBar,lastBar,trade:result.trade};
    const insert=await db.query(`INSERT INTO public.ai_shadow_events(event_key,study_id,opportunity_key,kind,occurred_at,payload)
      VALUES($1,$2,$3,$4,clock_timestamp(),$5::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING event_key`,[keyOf(studyId,key,'outcome'),studyId,key,phase,JSON.stringify(payload)]);
    if (insert.rows.length) totals[result.status]++;
  }
  return totals;
}
