import { describe, it, expect } from 'vitest';
import { normalizeCursor } from '../server/harness/cursor/normalize.ts';

describe('cursor normalizer', () => {
  it('turns system init into an init record and reads the chat id', () => {
    const p = normalizeCursor({ type: 'system', subtype: 'init', session_id: 'chat_1', model: 'auto', cwd: '/w', apiKeySource: 'login' });
    expect(p.sessionId).toBe('chat_1');
    expect(p.records[0]).toMatchObject({ kind: 'init', payload: { model: 'auto', cwd: '/w' } });
  });

  it('drops the user echo and thinking', () => {
    expect(normalizeCursor({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }).records).toEqual([]);
    expect(normalizeCursor({ type: 'thinking', text: 'hmm' }).records).toEqual([]);
  });

  it('renders assistant text', () => {
    const p = normalizeCursor({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello there' }] } });
    expect(p.records).toEqual([{ kind: 'assistant_text', payload: { text: 'hello there' } }]);
  });

  it('renders a completed shell tool_call as a Bash row with its output', () => {
    const p = normalizeCursor({ type: 'tool_call', subtype: 'completed', toolCallId: 'tc_1', tool: 'shell', input: { command: 'ls' }, result: { output: 'a\nb', exitCode: 0 } });
    expect(p.records.map((r) => r.kind)).toEqual(['tool_use', 'tool_result']);
    expect(p.records[0].payload).toMatchObject({ name: 'Bash', input: { command: 'ls' } });
    expect((p.records[1].payload as any).is_error).toBe(false);
  });

  it('ignores started tool_call events (only completed render)', () => {
    expect(normalizeCursor({ type: 'tool_call', subtype: 'started', toolCallId: 'tc_1', tool: 'shell' }).records).toEqual([]);
  });

  it('reads the terminal result', () => {
    const p = normalizeCursor({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'chat_1' });
    expect(p.result).toEqual({ ok: true, text: 'done' });
    expect(p.sessionId).toBe('chat_1');
  });
});
