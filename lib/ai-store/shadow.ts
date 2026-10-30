/** Private, append-only storage for an isolated AI shadow study. No order,
 * account, or learner writes occur here. The caller authenticates scheduling. */
import { stableHash } from '@/lib/experiment/hash';
import { readSourceActivity } from '@/lib/engine/activity';
import type { ShadowEvent, ShadowProcessorStore, ShadowStudy, SourceState } from '@/lib/ai-shadow/processor';
import { captureShadowIdea, type ShadowSnapshot, type ShadowSourceIdea } from '@/lib/ai-shadow/study';
import type { ResearchQuery } from './research';

function millis(value: unknown): number | null {
  const n = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
function level(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
/** The exact immutable preregistration accepted by this processor. A change
 * to any field requires a new study and prospective observation period. */
export const SHADOW_STUDY_CONFIG = Object.freeze({
  source: 'yahoo',
  eligibility: 'first-receipt-fresh-unrevised-open-v1',
  maxIdeaAgeSeconds: 1800,
  maxDataAgeSeconds: 2700,
  barSeconds: 300,
  features: ['symbol','side','strategy','tier','paused','signalTime','riskPoints','rewardRisk','score'],
  simulation: 'one-contract-next-received-bar-v1',
  costVersion: 'cost-realistic-2026-08-17',
  controls: ['take-all','matched-random','no-trade'],
  decisionRule: 'inconclusive-no-automatic-promotion',
});
const eventKey = (studyId: string, key: string, phase: string) => `${phase}:${stableHash([studyId,key])}`;

export class ShadowStore implements ShadowProcessorStore {
  constructor(private readonly db: ResearchQuery) {}

  async claim(studyId: string, key: string, at: number): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO public.ai_shadow_events (event_key,study_id,opportunity_key,kind,occurred_at,payload)
       SELECT $1,s.study_id,s.opportunity_key,'claim',$4::timestamptz,'{}'::jsonb
       FROM public.ai_shadow_snapshots s
       WHERE s.study_id=$2 AND s.opportunity_key=$3 AND s.eligibility='eligible'
       ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [eventKey(studyId,key,'claim'),studyId,key,new Date(at).toISOString()],
    );
    return result.rows.length === 1;
  }

  async sourceState(key: string): Promise<SourceState | null> {
    const result = await this.db.query(
      `SELECT s.status,s.stale_data,s.orphaned,s.suppressed,s.symbol,s.entry_price,s.stop_price,s.target_price,h.message
       FROM public.signals s
       LEFT JOIN LATERAL (SELECT message FROM public.engine_runs ORDER BY ran_at DESC,id DESC LIMIT 1) h ON true
       WHERE s.dedupe_key=$1 AND s.exit_ts IS NULL AND s.exit_price IS NULL AND s.pnl_usd IS NULL`, [key]);
    const row = result.rows[0];
    if (!row || typeof row.status !== 'string' || typeof row.stale_data !== 'boolean' || typeof row.orphaned !== 'boolean' ||
        typeof row.suppressed !== 'boolean' || (row.symbol !== 'MES' && row.symbol !== 'MNQ')) return null;
    const entry=level(row.entry_price), stop=level(row.stop_price), target=row.target_price === null ? null : level(row.target_price);
    if (entry === null || stop === null || (row.target_price !== null && target === null)) return null;
    const activity=readSourceActivity(typeof row.message === 'string' ? row.message : null);
    const dataTime=activity ? millis(activity.marketAsOf[row.symbol]) : null;
    // Errors, missing data, and stale heartbeats do not authorize a provider call.
    const usable=activity && !['component-error','data-unavailable','data-stale'].includes(activity.state);
    return {status:row.status,stale:row.stale_data,orphaned:row.orphaned,suppressed:row.suppressed,
      dataAsOf:usable && dataTime !== null ? Math.floor(dataTime/1000) : null,setupHash:stableHash({entry,stop,target})};
  }

  async append(event: ShadowEvent): Promise<void> {
    const result = await this.db.query(
      `INSERT INTO public.ai_shadow_events (event_key,study_id,opportunity_key,kind,occurred_at,payload)
       SELECT $1,$2,$3,$4,$5::timestamptz,$6::jsonb
       WHERE EXISTS (SELECT 1 FROM public.ai_shadow_events WHERE event_key=$7 AND kind='claim')
       ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [eventKey(event.studyId,event.key,'terminal'),event.studyId,event.key,event.kind,new Date(event.at).toISOString(),JSON.stringify(event.payload),eventKey(event.studyId,event.key,'claim')],
    );
    if (result.rows.length !== 1) throw new Error('Shadow terminal event already exists or claim is missing.');
  }

  /** Retrieve an explicitly registered immutable study, never create one on demand. */
  async getStudy(id: string): Promise<ShadowStudy | null> {
    const result=await this.db.query(`SELECT id,registered_at,model,prompt_version,feature_version,config FROM public.ai_shadow_studies WHERE id=$1`,[id]);
    const row=result.rows[0], t=row ? millis(row.registered_at) : null;
    if (!row || t===null || !row.config || typeof row.config !== 'object' || stableHash(row.config) !== stableHash(SHADOW_STUDY_CONFIG) || typeof row.id!=='string' || typeof row.model!=='string' || typeof row.prompt_version!=='string' || typeof row.feature_version!=='string') return null;
    return {id:row.id,registeredAt:Math.floor(t/1000),model:row.model,promptVersion:row.prompt_version,featureVersion:row.feature_version};
  }

  /** Fetch unclaimed first-receipt eligible snapshots for the registered study.
   * Revalidates the immutable payload; never reconstructs from current outcomes. */
  async pending(study: ShadowStudy, limit: number): Promise<ShadowSourceIdea[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid shadow batch size.');
    const result=await this.db.query(
      `SELECT s.opportunity_key,s.symbol,s.side,s.observed_at,s.source_signal_at,s.data_as_of,s.source_paused,s.source_fresh,s.payload FROM public.ai_shadow_snapshots s
       WHERE s.study_id=$1 AND s.eligibility='eligible'
         AND NOT EXISTS (SELECT 1 FROM public.ai_shadow_events e WHERE e.study_id=s.study_id AND e.opportunity_key=s.opportunity_key AND e.kind='claim')
       ORDER BY s.observed_at ASC LIMIT $2`,[study.id,limit]);
    const ideas:ShadowSourceIdea[]=[];
    for (const row of result.rows) {
      const snap=row.payload as ShadowSnapshot | null;
      if (!snap || typeof snap !== 'object' || !snap.modelInput || typeof snap.modelInput !== 'object' ||
          snap.key!==row.opportunity_key || snap.symbol!==row.symbol || snap.side!==row.side || snap.suppressed!==row.source_paused || row.source_fresh!==true ||
          millis(row.observed_at)===null || Math.floor(millis(row.observed_at)!/1000)!==snap.observedAt ||
          millis(row.source_signal_at)===null || Math.floor(millis(row.source_signal_at)!/1000)!==snap.signalTs ||
          millis(row.data_as_of)===null || Math.floor(millis(row.data_as_of)!/1000)!==snap.dataAsOf) continue;
      const idea:ShadowSourceIdea={key:snap.key,symbol:snap.symbol,side:snap.side,strategy:snap.strategy,tier:snap.tier,status:'triggered',signalTs:snap.signalTs,
        observedAt:snap.observedAt,dataAsOf:snap.dataAsOf,stale:false,orphaned:false,suppressed:snap.suppressed,entry:snap.entry,stop:snap.stop,target:snap.target,
        score:snap.modelInput.score,rr:snap.modelInput.rewardRisk};
      const checked=captureShadowIdea(idea,study.registeredAt);
      if (checked.kind === 'eligible' && stableHash(checked.snapshot) === stableHash(snap)) ideas.push(idea);
    }
    return ideas;
  }
}
