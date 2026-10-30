import { describe, expect, it } from 'vitest';
import { validateResearchAnswer, evidenceForPrompt } from '@/lib/ai-research/core';

describe('evidence grounded AI research', () => {
  it('accepts only references to records supplied in the snapshot', () => {
    const evidence = [{ id: 'run:12', label: 'Source check', text: 'Prices delayed' }];
    expect(validateResearchAnswer({ answer: 'The latest source check is delayed.', citations: ['run:12'] }, evidence)).toEqual({ answer: 'The latest source check is delayed.', citations: [{ id: 'run:12', label: 'Source check' }] });
    expect(() => validateResearchAnswer({ answer: 'Made up.', citations: ['run:13'] }, evidence)).toThrow(/citation/i);
  });
  it('refuses invalid or empty output and does not manufacture references', () => {
    expect(() => validateResearchAnswer({ answer: '', citations: [] }, [])).toThrow();
    expect(() => validateResearchAnswer({ answer: 'Hello', citations: ['unknown'] }, [])).toThrow();
    expect(validateResearchAnswer({ answer: 'Not enough evidence.', citations: [] }, [])).toEqual({ answer: 'Not enough evidence.', citations: [] });
  });
  it('bounds evidence and strips fields other than id, label and text', () => {
    const result = evidenceForPrompt([{ id: 'run:1', label: 'Run', text: 'ok', secret: 'do-not-send' }]);
    expect(result).toEqual([{ id: 'run:1', label: 'Run', text: 'ok' }]);
    expect(JSON.stringify(result)).not.toContain('do-not-send');
  });
});
