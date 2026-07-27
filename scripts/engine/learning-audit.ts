import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LearningCadence = "daily" | "weekly" | "monthly";
export type LearningRunStatus = "running" | "ok" | "blocked" | "error";

export interface DataQualityReport {
  healthy: boolean;
  checkedRows: number;
  duplicateKeys: number;
  missingKeys: number;
  reasonCodes: string[];
}

export function stableHash(value: unknown): string {
  const normalized = JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export function dataQualityReport(rows: Array<{ dedupe_key?: string | null }>): DataQualityReport {
  const seen = new Set<string>();
  let duplicateKeys = 0;
  let missingKeys = 0;
  for (const row of rows) {
    const key = row.dedupe_key?.trim();
    if (!key) {
      missingKeys++;
      continue;
    }
    if (seen.has(key)) duplicateKeys++;
    seen.add(key);
  }
  const reasonCodes = [
    ...(duplicateKeys ? ["duplicate_signal_keys"] : []),
    ...(missingKeys ? ["missing_signal_keys"] : []),
  ];
  return {
    healthy: reasonCodes.length === 0,
    checkedRows: rows.length,
    duplicateKeys,
    missingKeys,
    reasonCodes,
  };
}

export async function startLearningRun(
  supabase: SupabaseClient,
  cadence: LearningCadence,
  values: {
    codeSha?: string | null;
    dataCutoff?: string | null;
    featureVersion?: string | null;
    datasetHash?: string | null;
    message?: string | null;
  } = {}
): Promise<number> {
  const { data, error } = await supabase
    .from("learning_runs")
    .insert({
      cadence,
      status: "running",
      code_sha: values.codeSha ?? null,
      data_cutoff: values.dataCutoff ?? null,
      feature_version: values.featureVersion ?? null,
      dataset_hash: values.datasetHash ?? null,
      message: values.message ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`learning_runs start: ${error.message}`);
  return Number(data.id);
}

export async function finishLearningRun(
  supabase: SupabaseClient,
  id: number,
  values: {
    status: Exclude<LearningRunStatus, "running">;
    artifactHash?: string | null;
    metrics?: Record<string, unknown>;
    gateResults?: Record<string, unknown>;
    message?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("learning_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: values.status,
      artifact_hash: values.artifactHash ?? null,
      metrics: values.metrics ?? {},
      gate_results: values.gateResults ?? {},
      message: values.message ?? null,
    })
    .eq("id", id);
  if (error) throw new Error(`learning_runs finish: ${error.message}`);
}

export async function recordPromotionDecision(
  supabase: SupabaseClient,
  values: {
    candidateKey: string;
    learningRunId?: number | null;
    decision: "observing" | "canary" | "active" | "rejected" | "rolled_back" | "paused";
    reasonCodes?: string[];
    evidence?: Record<string, unknown>;
    codeSha?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("promotion_decisions").insert({
    candidate_key: values.candidateKey,
    learning_run_id: values.learningRunId ?? null,
    decision: values.decision,
    reason_codes: values.reasonCodes ?? [],
    evidence: values.evidence ?? {},
    code_sha: values.codeSha ?? null,
  });
  if (error) throw new Error(`promotion_decisions insert: ${error.message}`);
}
