import { describe, expect, it } from 'vitest';
import { callOpenAiResearch } from '@/lib/ai-research/provider';

describe('OpenAI research request', () => {
  it('sends only the question and supplied bounded evidence, returning usage and validated output', async () => {
    let sent: Record<string, unknown> | null = null;
    const transport: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ answer: 'The check is paused.', citations: ['run:1'] }) }] }], usage: { input_tokens: 200, output_tokens: 30 } }), { status: 200 });
    };
    const out = await callOpenAiResearch({ key: 'test-key', question: 'Why paused?', evidence: [{ id: 'run:1', label: 'Check', text: 'paused' }] }, transport);
    expect(out.value.answer).toBe('The check is paused.');
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 30 });
    expect(JSON.stringify(sent)).toContain('run:1');
    expect(JSON.stringify(sent)).not.toContain('test-key');
    expect((sent as unknown as { max_output_tokens: number }).max_output_tokens).toBe(4000);
  });
  it('refuses fabricated evidence and reports provider failure without leaking its body', async () => {
    const bad: typeof fetch = async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ answer: 'Wrong', citations: ['fake'] }) }] }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
    await expect(callOpenAiResearch({ key: 'test', question: 'q', evidence: [] }, bad)).rejects.toThrow(/citation/i);
    const failure: typeof fetch = async () => new Response('private provider error text', { status: 429 });
    await expect(callOpenAiResearch({ key: 'test', question: 'q', evidence: [] }, failure)).rejects.toThrow('OpenAI request failed (429)');
  });
});
