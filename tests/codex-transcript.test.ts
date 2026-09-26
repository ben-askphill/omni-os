import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeItem, normalizePlan, diffToEdits } from '../server/harness/codex/normalize.ts';
import type { CodexItem, PlanUpdate } from '../server/harness/codex/protocol.ts';

// item/completed notifications in codex-cli 0.157's shapes, plus a checklist update.
const lines = readFileSync(join(import.meta.dirname, 'fixtures', 'codex-rich.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { method: string; params: any });
const items = lines.filter((l) => l.method === 'item/completed').map((l) => l.params.item as CodexItem);
const byId = (id: string) => items.find((i) => i.id === id)!;

describe('codex transcript normalizer', () => {
  it('renders a new file as a Write row with its content', () => {
    const [use, res] = normalizeItem(byId('f1'));
    expect(use).toMatchObject({
      kind: 'tool_use',
      payload: { id: 'f1', name: 'Write', input: { file_path: '/tmp/work/src/a.txt', content: 'hello\nworld\n' } },
    });
    expect(res).toMatchObject({ kind: 'tool_result', payload: { tool_use_id: 'f1', is_error: false } });
  });

  it('renders a changed file as a MultiEdit with one edit per hunk', () => {
    const [rec] = normalizeItem(byId('f2'));
    expect((rec.payload as any).name).toBe('MultiEdit');
    expect((rec.payload as any).input.edits).toEqual([
      { old_string: 'foo\nbar', new_string: 'foo\nbaz' },
      { old_string: 'qux\na', new_string: 'qux\nb' },
    ]);
  });

  it('renders a deleted file as a visible entry', () => {
    const [rec] = normalizeItem(byId('f3'));
    expect(rec).toMatchObject({ kind: 'tool_use', payload: { name: 'Delete', input: { file_path: '/tmp/work/src/c.txt' } } });
  });

  it('renders each file of a multi-file patch as its own row, a rename under its new name', () => {
    const uses = normalizeItem(byId('f4')).filter((r) => r.kind === 'tool_use');
    expect(uses.map((r) => (r.payload as any).id)).toEqual(['f4:0', 'f4:1']);
    expect(uses[0].payload).toMatchObject({
      name: 'Edit',
      input: { file_path: '/tmp/work/src/new.ts', old_string: 'export const a = 1;', new_string: 'export const a = 2;' },
    });
    expect(uses[1].payload).toMatchObject({ name: 'Write', input: { file_path: '/tmp/work/src/d.txt', content: 'new file\n' } });
  });

  it('marks a declined patch as an error result', () => {
    const [, res] = normalizeItem(byId('f5'));
    expect(res.payload).toMatchObject({ is_error: true, text: 'Patch declined.' });
  });

  it('renders an MCP call as mcp__server__tool with its text content', () => {
    const recs = normalizeItem(byId('m1'));
    expect((recs[0].payload as any).name).toBe('mcp__omni__list_channels');
    expect((recs[0].payload as any).input).toEqual({ archived: false });
    expect(recs[1]).toMatchObject({ kind: 'tool_result', payload: { is_error: false, text: '[{"id":"inbox"}]' } });
  });

  it('renders an MCP error as an error result', () => {
    const recs = normalizeItem(byId('m2'));
    expect(recs[1].payload).toMatchObject({ is_error: true, text: 'upstream 500' });
  });

  it('shows an MCP result with only structured content as its JSON', () => {
    const recs = normalizeItem(byId('m3'));
    expect(JSON.parse((recs[1].payload as any).text)).toEqual({ id: 't1', status: 'done' });
  });

  it('renders a web search as a finished WebSearch row, though Codex sends no results', () => {
    const recs = normalizeItem(byId('w1'));
    expect(recs[0].payload).toMatchObject({ name: 'WebSearch', input: { query: 'omni os agent' } });
    expect(recs[1]).toMatchObject({ kind: 'tool_result', payload: { tool_use_id: 'w1', is_error: false } });
  });

  it('shows the page an open-page search visits', () => {
    const [use] = normalizeItem(byId('w2'));
    expect((use.payload as any).input).toEqual({ query: 'https://example.com/docs' });
  });

  it("shows plan mode's proposed plan as assistant text", () => {
    expect(normalizeItem(byId('p1'))).toEqual([{ kind: 'assistant_text', payload: { text: '1. Scaffold\n2. Wire adapter\n3. Test' } }]);
  });

  it('drives the checklist from turn/plan/updated, mapping statuses to TodoWrite', () => {
    const update = lines.find((l) => l.method === 'turn/plan/updated')!.params as PlanUpdate;
    const [use, res] = normalizePlan(update, 'plan-1');
    expect(use.payload).toMatchObject({ id: 'plan-1', name: 'TodoWrite' });
    expect((use.payload as any).input.todos).toEqual([
      { content: 'Scaffold', status: 'completed' },
      { content: 'Wire adapter', status: 'in_progress' },
      { content: 'Test', status: 'pending' },
    ]);
    expect(res).toMatchObject({ kind: 'tool_result', payload: { tool_use_id: 'plan-1' } });
  });

  it('single-hunk diff becomes an Edit', () => {
    const recs = normalizeItem({
      id: 'x',
      type: 'fileChange',
      status: 'completed',
      changes: [{ path: '/f', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' }],
    } as CodexItem);
    expect((recs[0].payload as any).name).toBe('Edit');
    expect((recs[0].payload as any).input).toMatchObject({ old_string: 'a', new_string: 'b' });
  });

  it('diffToEdits ignores a ---/+++ preamble and "no newline" markers', () => {
    expect(diffToEdits('--- a\n+++ b\n@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y\n')).toEqual([{ old_string: 'x', new_string: 'y' }]);
  });
});
