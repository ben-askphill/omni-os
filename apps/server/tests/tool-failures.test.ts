import { describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import type { Live } from '../runner/state.ts';
import { normalizeItem } from '../harness/codex/normalize.ts';
import { normalizeCursor } from '../harness/cursor/normalize.ts';

const h = await startRunner();
const { toolFailures, observeToolResult, classifyFailure, safeGuidance } = await import('../tool-failures.ts');
const { onRecord } = await import('../runner/records.ts');
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { app } = await import('../app.ts');
const send = (method: string, path: string, body?: unknown) => app.request(`/api/tool-failures${path}`, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

describe('tool failure capture and triage', () => {
  it('captures real CLI failures automatically and leaves successful calls out', async () => {
    const t = await h.start('RICH');
    await h.untilResults(t.id, 1);
    const groups = toolFailures.groups() as any[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ tool: 'Bash', harness: 'claude-code', occurrences: 1, status: 'open' });
    const [failure] = toolFailures.occurrences(groups[0].group_id) as any[];
    expect(failure).toMatchObject({ thread_id: t.id, channel_id: 'scratch', session_id: h.thread(t.id).session_id });
    expect(failure.event_id).toBeGreaterThan(0);
    expect(new Date(failure.created_at).toISOString()).toBe(failure.created_at);
    expect(h.byKind(t.id, 'tool_result').find((e) => e.id === failure.event_id)?.p.is_error).toBe(true);
  });

  it('deduplicates replay and manual fallback, groups recurrence, records remediation and reopens fixed groups', async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const ctx = { thread_id: t.id, channel_id: 'scratch', session_id: h.thread(t.id).session_id, harness: 'claude-code' };
    const first = toolFailures.record({ ...ctx, call_id: 'same-call', tool: 'Read', category: 'not_found' })!;
    const manual = await send('POST', '', { thread_id: t.id, call_id: 'same-call', tool: 'Read', category: 'not_found' });
    expect(await manual.json()).toMatchObject({ id: first.id, added: false });
    const res = await send('PATCH', `/${first.group_id}`, { status: 'fixed', guidance: 'Check the path before calling Read.' });
    expect(res.status).toBe(200);
    toolFailures.record({ ...ctx, call_id: 'same-call', tool: 'Read', category: 'not_found' });
    expect((toolFailures.groups('fixed') as any[]).some((g) => g.group_id === first.group_id)).toBe(true);
    const second = toolFailures.record({ ...ctx, call_id: 'retry-call', tool: 'Read', category: 'not_found' })!;
    expect((toolFailures.groups('open') as any[]).find((g) => g.group_id === first.group_id)).toMatchObject({ occurrences: 2, guidance: 'Check the path before calling Read.' });
    expect((await send('PATCH', `/occurrences/${second.id}`, { retry_of: first.id, recovery: 'not_recovered' })).status).toBe(200);
    const rows = await (await send('GET', `/${first.group_id}/occurrences`)).json() as any[];
    expect(rows[0]).toMatchObject({ retry_of: first.id, recovery: 'not_recovered' });
    expect(await (await send('GET', `/${first.group_id}/occurrences?before=${rows[0].cursor}`)).json()).toHaveLength(1);
    expect((await send('PATCH', `/${first.group_id}`, { status: 'replacement', guidance: 'Use Glob to find the path first.' })).status).toBe(200);
    expect(await (await send('GET', '?status=replacement')).json()).toEqual([expect.objectContaining({ group_id: first.group_id })]);
  });

  it('stores safe categories only, with no raw arguments, output, credentials or private data', async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const live = { threadId: t.id, channelId: 'scratch', sessionId: h.thread(t.id).session_id, turn: true } as Live;
    const secret = 'sk-test-private-customer-payload';
    onRecord(live, { kind: 'tool_use', payload: { id: 'secret-call', name: 'mcp__test__read', input: { api_key: secret, customer: 'PRIVATE_CUSTOMER_RECORD' }, parent: 'parent-call' } });
    onRecord(live, { kind: 'tool_result', payload: { tool_use_id: 'secret-call', text: `401 Unauthorized Bearer ${secret} PRIVATE_CUSTOMER_RECORD person@example.com`, is_error: true, truncated: false } });
    const group = (toolFailures.groups() as any[]).find((g) => g.tool === 'mcp__test__read');
    const rows = toolFailures.occurrences(group.group_id);
    expect(rows).toEqual([expect.objectContaining({ category: 'authentication', detail: 'Authentication failed.', parent_call_id: 'parent-call' })]);
    const persisted = JSON.stringify({ group, rows });
    for (const value of [secret, 'PRIVATE_CUSTOMER_RECORD', 'person@example.com', 'api_key', 'input']) expect(persisted).not.toContain(value);
    onRecord(live, { kind: 'tool_result', payload: { tool_use_id: 'secret-call', text: 'success', is_error: false, truncated: false } });
    expect(toolFailures.occurrences(group.group_id)).toEqual(rows); // no inferred recovery
    expect(safeGuidance('Bearer abc password="private" https://user:pass@host/path?token=sensitive person@example.com sk-test-key')).not.toMatch(/abc|private|user:pass|sensitive|person@example|sk-test/);
  });

  it('does not recurse, and a failed logger does not interrupt tool result delivery', () => {
    expect(toolFailures.record({ thread_id: 't', channel_id: 'c', harness: 'codex', session_id: 's', call_id: 'a', tool: 'mcp__omni__tool_failures', category: 'unknown' })).toBeNull();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const record = vi.spyOn(toolFailures, 'record').mockImplementation(() => { throw new Error('SECRET DATABASE ERROR'); });
    expect(() => observeToolResult({ thread_id: 't', channel_id: 'c', harness: 'codex', session_id: 's' },
      { tool_use_id: 'a', text: 'SECRET OUTPUT', is_error: true, truncated: false }, null)).not.toThrow();
    expect(log.mock.calls).toEqual([['[tool-failures] capture failed; tool result delivery continues']]);
    record.mockRestore(); log.mockRestore();
  });

  it('rejects raw payloads and invalid triage without accepting supplied identity', async () => {
    expect((await send('POST', '', { thread_id: 'missing', call_id: 'x', tool: 'Read', category: 'unknown' })).status).toBe(404);
    expect((await send('POST', '', { thread_id: 'x', call_id: 'x', tool: 'Read', category: 'unknown', arguments: { secret: 'hidden' } })).status).toBe(400);
    expect((await send('GET', '?status=disabled')).status).toBe(400);
    expect((await send('PATCH', `/${'a'.repeat(64)}`, { status: 'fixed' })).status).toBe(404);
    const unauthorized = await app.request('/api/tool-failures', { headers: { authorization: '' } });
    expect(unauthorized.status).toBe(401);
  });

  it('keeps distinct nested failures under one wrapper and deduplicates their own reports', async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const body = { thread_id: t.id, tool: 'nested_read', category: 'timeout', parent_call_id: 'wrapper-1' };
    const first = await (await send('POST', '', { ...body, call_id: 'inner-1' })).json() as any;
    await send('POST', '', { ...body, call_id: 'inner-2' });
    const replay = await (await send('POST', '', { ...body, call_id: 'inner-1' })).json() as any;
    expect(replay).toMatchObject({ id: first.id, added: false });
    const rows = toolFailures.occurrences(first.group_id) as any[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.call_id).sort()).toEqual(['inner-1', 'inner-2']);
    expect(rows.every((r) => r.parent_call_id === 'wrapper-1')).toBe(true);
  });

  it('includes the global policy in generated prompts for every harness and agent source', async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    for (const harness of ['claude-code', 'codex', 'cursor', 'hermes']) {
      for (const source of ['manual', 'crew', 'team', 'automation'] as const) {
        const prompt = buildSystemPrompt({ ...h.thread(t.id), harness, source } as any, h.db.channels.get('scratch')!);
        expect(prompt).toContain('Omni records tool failures reported by your harness automatically.');
        expect(prompt).toContain('POST /api/tool-failures');
      }
    }
  });
});

describe('adapter failure signals', () => {
  it('keeps Codex MCP application errors even when transport succeeds', () => {
    const records = normalizeItem({ type: 'mcpToolCall', id: 'm', server: 'test', tool: 'fetch', status: 'completed', result: { isError: true, content: [{ type: 'text', text: '429 rate limit' }] } });
    expect(records[1]).toMatchObject({ kind: 'tool_result', payload: { is_error: true } });
    expect(normalizeItem({ type: 'commandExecution', id: 'cmd', exitCode: 2 })[1]).toMatchObject({ payload: { is_error: true, text: 'Exit code 2\n' } });
    expect(normalizeItem({ type: 'dynamicToolCall', id: 'd', success: false })[1]).toMatchObject({ kind: 'tool_result', payload: { is_error: true } });
    for (const tool of ['fetch_orders', 'fetch_products']) {
      expect(normalizeItem({ type: 'dynamicToolCall', id: tool, tool, success: false })[0]).toMatchObject({ kind: 'tool_use', payload: { name: tool } });
    }
  });
  it('keeps Cursor failures across shell, built-in and MCP tools', () => {
    for (const tool of ['read', 'edit', 'mcp', 'custom']) {
      const records = normalizeCursor({ type: 'tool_call', subtype: 'completed', toolCallId: 'a', tool, result: { error: 'permission denied' } }).records;
      expect(records.at(-1)).toMatchObject({ kind: 'tool_result', payload: { is_error: true } });
    }
    expect(normalizeCursor({ type: 'tool_call', subtype: 'failed', toolCallId: 'a', tool: 'read' }).records.at(-1)).toMatchObject({ payload: { is_error: true } });
    expect(normalizeCursor({ type: 'tool_call', subtype: 'completed', toolCallId: 'a', tool: 'mcp', result: { result: { isError: true, content: [] } } }).records.at(-1)).toMatchObject({ payload: { is_error: true } });
  });
  it('does not turn Cursor success with an explicit false error into a failure', () => {
    for (const tool of ['read', 'mcp', 'custom', 'shell']) {
      const records = normalizeCursor({ type: 'tool_call', subtype: 'completed', toolCallId: 'ok', tool, result: { success: true, error: false, result: { content: [] }, exitCode: 0 } }).records;
      expect(records.some((r) => r.kind === 'tool_result' && r.payload.is_error)).toBe(false);
    }
  });
  it('classifies a shell result by its exit code, never by words in the command output', () => {
    for (const [text, category] of [
      ['Exit code 1\n× times out waiting for the card\nError: timed out after 25000ms', 'command_exit'],
      ['Exit code 1\n× says unavailable for a thread that is gone\nECONNREFUSED', 'command_exit'],
      ['Exit code 1\nls: x: No such file or directory', 'command_exit'],
      ['Exit code 2\n429 rate limit, 401 unauthorized, invalid argument', 'command_exit'],
      ['Exit code 124\n', 'timeout'], ['Exit code 126\n', 'permission'], ['Exit code 127\nzsh: command not found: timeout', 'not_found'],
    ]) expect(classifyFailure(text)).toBe(category);
    expect(classifyFailure("The user doesn't want to proceed with this tool use. The tool use was rejected.")).toBe('permission');
  });
  it('classifies known signals and safely falls back for arbitrary payloads', () => {
    for (const [text, category] of [['401', 'authentication'], ['EACCES', 'permission'], ['429', 'rate_limit'], ['ETIMEDOUT', 'timeout'], ['ECONNREFUSED', 'unavailable'], ['invalid argument', 'invalid_input'], ['ENOENT', 'not_found'], ['Exit code 1', 'command_exit'], ['PRIVATE PAYLOAD', 'unknown']]) expect(classifyFailure(text)).toBe(category);
  });
  it('classifies a shell failure by its exit code, never by words in the command output', () => {
    for (const [text, category] of [
      ['Exit code 1\n✓ retries after a timeout\n× returns 404 when the service is unavailable', 'command_exit'],
      ['Exit code 1\nnpm ERR! 429 rate limit\npermission denied: invalid input', 'command_exit'],
      ['Exit code 127\n(eval):1: command not found: timeout', 'not_found'],
      ['Exit code 1\n(eval):5: command not found: timeout\nexit 127', 'not_found'],
      ['Exit code 124\n', 'timeout'],
      ["The user doesn't want to proceed with this tool use. The tool use was rejected.", 'permission'],
      ['Error: Access denied: path is not within any of the configured workspace roots.', 'permission'],
    ]) expect(classifyFailure(text)).toBe(category);
  });
});
