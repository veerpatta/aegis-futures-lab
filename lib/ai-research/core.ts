export interface Evidence { id: string; label: string; text: string }
export interface ResearchAnswer { answer: string; citations: { id: string; label: string }[] }

/** Only explicitly selected, bounded fields can cross the provider boundary. */
export function evidenceForPrompt(rows: readonly unknown[]): Evidence[] {
  return rows.slice(0, 25).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.text !== 'string') return [];
    return [{ id: r.id.slice(0, 120), label: r.label.slice(0, 160), text: r.text.slice(0, 1000) }];
  });
}

export function validateResearchAnswer(raw: unknown, evidence: readonly Evidence[]): ResearchAnswer {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid research response');
  const r = raw as Record<string, unknown>;
  if (typeof r.answer !== 'string' || !r.answer.trim() || r.answer.length > 12000 || !Array.isArray(r.citations) || r.citations.length > 25) throw new Error('Invalid research response');
  const byId = new Map(evidence.map(e => [e.id, e]));
  const citations: ResearchAnswer['citations'] = [];
  for (const id of r.citations) {
    if (typeof id !== 'string' || !byId.has(id)) throw new Error('Invalid evidence citation');
    if (!citations.some(c => c.id === id)) citations.push({ id, label: byId.get(id)!.label });
  }
  return { answer: r.answer.trim(), citations };
}
