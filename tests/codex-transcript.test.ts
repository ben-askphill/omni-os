import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeItem, diffToEdits } from '../server/harness/codex/normalize.ts';
import type { CodexItem } from '../server/harness/codex/protocol.ts';

const items = readFileSync(join(import.meta.dirname, 'fixtures', 'codex-rich.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l).params.item as CodexItem);
const byId = (id: string) => items.find((i) => i.id === id)!;

describe('codex transcript normalizer', () => {
  it('renders a new file as a Write row', () => {
    const [rec] = normalizeItem(byId('f1'));
    expect(rec).toMatchObject({ kind: 'tool_use', payload: { name: 'Write', input: { file_path: 'src/a.txt', content: 'hello\nworld' } } });
  });

  it('renders a changed file as a MultiEdit with one edit per hunk', () => {
    const [rec] = normalizeItem(byId('f2'));
    expect((rec.payload as any).name).toBe('MultiEdit');
    const edits = (rec.payload as any).input.edits;
    expect(edits).toHaveLength(2);
    expect(edits[0]).toEqual({ old_string: 'foo\nbar', new_string: 'foo\nbaz' });
    expect(edits[1]).toEqual({ old_string: 'qux\na', new_string: 'qux\nb' });
  });

  it('renders a deleted file as a visible entry', () => {
    const [rec] = normalizeItem(byId('f3'));
    expect(rec).toMatchObject({ kind: 'tool_use', payload: { name: 'Delete', input: { file_path: 'src/c.txt' } } });
  });

  it('renders an MCP call as mcp__server__tool with its result', () => {
    const recs = normalizeItem(byId('m1'));
    expect((recs[0].payload as any).name).toBe('mcp__omni__list_channels');
    expect((recs[0].payload as any).input).toEqual({ archived: false });
    expect(recs[1]).toMatchObject({ kind: 'tool_result', payload: { is_error: false } });
  });

  it('renders an MCP error as an error result', () => {
    const recs = normalizeItem(byId('m2'));
    expect((recs[1].payload as any).is_error).toBe(true);
    expect((recs[1].payload as any).text).toContain('upstream 500');
  });

  it('renders a web search as a WebSearch row', () => {
    const recs = normalizeItem(byId('w1'));
    expect((recs[0].payload as any).name).toBe('WebSearch');
    expect((recs[0].payload as any).input).toEqual({ query: 'omni os agent' });
  });

  it('drives the checklist from a plan, mapping statuses to TodoWrite', () => {
    const [rec] = normalizeItem(byId('p1'));
    expect((rec.payload as any).name).toBe('TodoWrite');
    expect((rec.payload as any).input.todos).toEqual([
      { content: 'Scaffold', status: 'completed' },
      { content: 'Wire adapter', status: 'in_progress' },
      { content: 'Test', status: 'pending' },
    ]);
  });

  it('single-hunk diff becomes an Edit', () => {
    const recs = normalizeItem({ id: 'x', type: 'fileChange', path: 'f', kind: 'update', diff: '@@ -1 +1 @@\n-a\n+b' } as CodexItem);
    expect((recs[0].payload as any).name).toBe('Edit');
    expect((recs[0].payload as any).input).toMatchObject({ old_string: 'a', new_string: 'b' });
  });

  it('diffToEdits ignores the ---/+++ preamble', () => {
    expect(diffToEdits('--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y')).toEqual([{ old_string: 'x', new_string: 'y' }]);
  });
});
