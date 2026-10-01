import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTasks, type TranscriptEvent } from '../web/src/transcript/fold.ts';
import { projectFold } from './transcript-snapshot.ts';

// One corpus for the Web UI fold and the Mac transcript. Swift reads the same file from the repo.

const corpus = JSON.parse(readFileSync(new URL('./fixtures/transcript/corpus.json', import.meta.url), 'utf8')) as {
  cases: { name: string; events: TranscriptEvent[]; items: unknown; plan: unknown }[];
};

const REQUIRED = [
  'grouping',
  'result-before-call',
  'zero-turn-success',
  'plan-placement',
  'self-parent',
  'undecodable-tool-use',
  'first-string-field',
];

describe('transcript fold', () => {
  it('imports no react', () => {
    const src = readFileSync(new URL('../web/src/transcript/fold.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]react['"]/);
    expect(src).not.toMatch(/\breact\b/);
  });

  it('covers the shared cases', () => {
    expect(corpus.cases.map((c) => c.name).sort()).toEqual([...REQUIRED].sort());
  });

  it.each(REQUIRED)('%s matches the corpus', (name) => {
    const found = corpus.cases.find((c) => c.name === name);
    expect(found, name).toBeTruthy();
    expect(projectFold(found!.events)).toEqual({ items: found!.items, plan: found!.plan });
  });

  it('drops a call that names itself as its parent', () => {
    const found = corpus.cases.find((c) => c.name === 'self-parent')!;
    const folded = projectFold(found.events);
    const calls = folded.items.flatMap((it) => (it.type === 'tools' ? it.calls : []));
    expect(calls.map((c) => c.id)).toEqual(['ok']);
    expect(JSON.stringify(folded)).not.toContain('"me"');
  });

  it('shows a tool_use whose payload does not decode', () => {
    const found = corpus.cases.find((c) => c.name === 'undecodable-tool-use')!;
    const folded = projectFold(found.events);
    const group = folded.items.find((it) => it.type === 'tools');
    expect(group?.calls.map((c) => c.name)).toEqual(['tool', 'tool']);
    expect(group?.total).toBe(2);
  });

  it('uses JavaScript key order for the first string field', () => {
    const found = corpus.cases.find((c) => c.name === 'first-string-field')!;
    const folded = projectFold(found.events);
    const group = folded.items.find((it) => it.type === 'tools');
    // "2" is an integer key, so it precedes "b" even though it is written second. "alpha" is empty.
    expect(group?.calls.map((c) => c.summary)).toEqual(['two', 'second']);
  });

  it('folds task rows onto the agent call', () => {
    const events: TranscriptEvent[] = [
      { id: 1, thread_id: 't', kind: 'task', payload: JSON.stringify({ task_id: 't1', event: 'started', tool_use_id: 'agent', background: true }), created_at: '2026-09-28T07:57:15.000Z' },
      { id: 2, thread_id: 't', kind: 'task', payload: JSON.stringify({ task_id: 't1', event: 'progress', tool_uses: 3 }), created_at: '2026-09-28T07:57:15.000Z' },
      { id: 3, thread_id: 't', kind: 'task', payload: JSON.stringify({ task_id: 't1', event: 'ended', status: 'completed', tool_uses: 4 }), created_at: '2026-09-28T07:57:15.000Z' },
    ];
    const tasks = buildTasks(events);
    expect(tasks.get('agent')).toMatchObject({ running: false, background: true, status: 'completed', tool_uses: 4, started: events[0].created_at });
  });
});
