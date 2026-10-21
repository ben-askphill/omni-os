import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contextApprox, contextSummary, fromCursorTurn } from '@omni/shared/context-meter.ts';
import { CursorCallCounter, normalizeCursor } from '../harness/cursor/normalize.ts';

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

describe('cursor turn usage', () => {
  const stream = (name: string) =>
    readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => normalizeCursor(JSON.parse(l)));
  const turn = (name: string) => {
    const counter = new CursorCallCounter();
    const parsed = stream(name);
    for (const p of parsed) counter.note(p);
    return { calls: counter.calls, usage: parsed.find((p) => p.result)?.usage };
  };

  it("reads the result's usage, camelCase as cursor-agent sends it", () => {
    const p = normalizeCursor({ type: 'result', subtype: 'success', session_id: 's', usage: { inputTokens: 74, outputTokens: 17, cacheReadTokens: 27_264, cacheWriteTokens: 0 } });
    expect(p.usage).toEqual({ inputTokens: 74, outputTokens: 17, cacheReadTokens: 27_264, cacheWriteTokens: 0 });
  });

  it('has no usage when the result carries none, or a shape without input tokens', () => {
    expect(normalizeCursor({ type: 'result', subtype: 'success' }).usage).toBeUndefined();
    expect(normalizeCursor({ type: 'result', subtype: 'success', usage: { input_tokens: 5 } }).usage).toBeUndefined();
    expect(normalizeCursor({ type: 'result', subtype: 'success', usage: 'lots' }).usage).toBeUndefined();
    // Missing counts other than input read as zero.
    expect(normalizeCursor({ type: 'result', usage: { inputTokens: 9 } }).usage).toEqual({ inputTokens: 9, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it('counts one model call for a plain reply: nothing is tagged', () => {
    const t = turn('cursor-stream-reply.jsonl');
    expect(t.calls).toBe(1);
    expect(t.usage).toEqual({ inputTokens: 22_876, outputTokens: 11, cacheReadTokens: 3968, cacheWriteTokens: 0 });
  });

  it('counts each tagged call plus the untagged final reply in a turn with tools', () => {
    // Five calls ran tools (model_call_id ...-0 to -4), then one wrote the answer.
    expect(turn('cursor-stream-tools.jsonl').calls).toBe(6);
  });

  it('a tool call that ends the turn adds no reply call', () => {
    const c = new CursorCallCounter();
    c.note(normalizeCursor({ type: 'tool_call', subtype: 'started', model_call_id: 'r-0-a' }));
    c.note(normalizeCursor({ type: 'tool_call', subtype: 'completed', model_call_id: 'r-0-a' }));
    c.note(normalizeCursor({ type: 'tool_call', subtype: 'started', model_call_id: 'r-1-b' }));
    expect(c.calls).toBe(2);
  });
});

describe('fromCursorTurn', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const one = { inputTokens: 22_876, outputTokens: 11, cacheReadTokens: 3968, cacheWriteTokens: 100 };

  it('is exact for one call: input plus cache read and write', () => {
    expect(fromCursorTurn(one, 1, 'Auto', 200_000, null, now)).toEqual({
      used: 26_944,
      max: 200_000,
      model: 'Auto',
      source: 'cursor',
      calls: 1,
      updated_at: now.toISOString(),
    });
  });

  it('averages over the calls when Cursor summed several, marked as an estimate', () => {
    // The tools turn: 23,082 + 133,120 over six calls, about 26K a call, not 156K.
    const c = fromCursorTurn({ inputTokens: 23_082, outputTokens: 959, cacheReadTokens: 133_120, cacheWriteTokens: 0 }, 6, 'Auto', 200_000, null, now);
    expect(c).toMatchObject({ used: 26_034, source: 'cursor-estimate', calls: 6 });
    expect(contextApprox(c)).toBe(true);
    expect(contextSummary(c)).toBe('~26K / 200K tokens (~13%)');
  });

  it('never estimates below the last exact reading', () => {
    const prev = fromCursorTurn(one, 1, 'Auto', 200_000, null, now);
    const c = fromCursorTurn({ inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 30_000, cacheWriteTokens: 0 }, 4, 'Auto', 200_000, prev, now);
    expect(c.used).toBe(26_944);
    expect(c.source).toBe('cursor-estimate');
  });

  it('marks only Cursor readings as estimates', () => {
    expect(contextApprox({ source: 'codex' })).toBe(false);
    expect(contextSummary({ used: 1000, max: 10_000, source: 'claude-cli' })).toBe('1K / 10K tokens (10%)');
  });
});
