import { describe, it, expect } from 'vitest';
import { normalizeCursor } from '../server/harness/cursor/normalize.ts';

const call = (tool: string, input: unknown, result?: unknown) =>
  normalizeCursor({ type: 'tool_call', subtype: 'completed', toolCallId: 'tc', tool, input, result }).records;

describe('cursor transcript tool mapping', () => {
  it('read/write/edit render as Read/Write/Edit', () => {
    expect(call('read', { path: 'a.ts' })[0].payload).toMatchObject({ name: 'Read', input: { file_path: 'a.ts' } });
    expect(call('write', { path: 'b.ts', content: 'x' })[0].payload).toMatchObject({ name: 'Write', input: { file_path: 'b.ts', content: 'x' } });
    expect(call('edit', { path: 'c.ts', oldString: 'a', newString: 'b' })[0].payload).toMatchObject({ name: 'Edit', input: { file_path: 'c.ts', old_string: 'a', new_string: 'b' } });
  });

  it('a multi-edit renders as MultiEdit', () => {
    const rec = call('edit', { path: 'c.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] })[0];
    expect(rec.payload).toMatchObject({ name: 'MultiEdit' });
    expect((rec.payload as any).input.edits).toHaveLength(2);
  });

  it('grep/glob/ls render as Grep/Glob/LS', () => {
    expect(call('grep', { pattern: 'foo' })[0].payload).toMatchObject({ name: 'Grep', input: { pattern: 'foo' } });
    expect(call('glob', { pattern: '*.ts' })[0].payload).toMatchObject({ name: 'Glob', input: { pattern: '*.ts' } });
    expect(call('ls', { path: 'src' })[0].payload).toMatchObject({ name: 'LS', input: { path: 'src' } });
  });

  it('mcp calls render as mcp__server__tool with a result', () => {
    const recs = call('mcp', { server: 'omni', tool: 'list_channels', arguments: { a: 1 } }, { result: 'ok' });
    expect((recs[0].payload as any).name).toBe('mcp__omni__list_channels');
    expect(recs[1]).toMatchObject({ kind: 'tool_result', payload: { is_error: false } });
  });

  it('to-dos render as TodoWrite with statuses mapped', () => {
    const rec = call('todos', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'running' }] })[0];
    expect((rec.payload as any).name).toBe('TodoWrite');
    expect((rec.payload as any).input.todos).toEqual([
      { content: 'A', status: 'completed' },
      { content: 'B', status: 'in_progress' },
    ]);
  });

  it('unknown tool kinds pass through under their own name with their raw input', () => {
    const rec = call('somethingNew', { foo: 'bar' })[0];
    expect(rec.payload).toMatchObject({ name: 'somethingNew', input: { foo: 'bar' } });
  });
});
