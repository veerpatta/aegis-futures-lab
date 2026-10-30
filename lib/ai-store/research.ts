/** Private research records; caller must pass the verified Neon user subject.
 * No browser-facing grants. All values are parameters, and every lookup or
 * result write is scoped to the authenticated account. */
export interface ResearchQuery {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface ResearchRequestInput {
  id: string;
  userId: string;
  question: string;
  snapshot: unknown;
  snapshotHash: string;
  model: string;
  promptVersion: string;
}
export interface ResearchResultInput {
  requestId: string;
  userId: string;
  response: unknown;
  citations: unknown[];
  status: "complete" | "invalid" | "error";
}
export class ResearchStore {
  constructor(private readonly db: ResearchQuery) {}

  async saveRequest(input: ResearchRequestInput): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO public.ai_research_requests
        (id,user_id,question,snapshot,snapshot_hash,model,prompt_version)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [input.id, input.userId, input.question, JSON.stringify(input.snapshot), input.snapshotHash, input.model, input.promptVersion],
    );
    return result.rows.length === 1;
  }

  async saveResult(input: ResearchResultInput): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO public.ai_research_results (request_id,user_id,response,citations,status)
       SELECT r.id,r.user_id,$3::jsonb,$4::jsonb,$5 FROM public.ai_research_requests r
       WHERE r.id = $1 AND r.user_id = $2
       ON CONFLICT (request_id) DO NOTHING RETURNING request_id`,
      [input.requestId, input.userId, JSON.stringify(input.response), JSON.stringify(input.citations), input.status],
    );
    return result.rows.length === 1;
  }

  async getRequest(id: string, userId: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.query(
      `SELECT r.id,r.question,r.snapshot,r.snapshot_hash,r.model,r.prompt_version,r.created_at,
              s.response,s.citations,s.status,s.created_at AS result_created_at
       FROM public.ai_research_requests r
       LEFT JOIN public.ai_research_results s ON s.request_id = r.id AND s.user_id = r.user_id
       WHERE r.id = $1 AND r.user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  }
}
