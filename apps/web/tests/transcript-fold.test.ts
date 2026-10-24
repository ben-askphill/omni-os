import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import type { Span } from '@omni/shared/history.ts';
import type { HandoverP, RunName, SwitchP } from '@omni/shared/run-switch.ts';
import { buildItems, buildTasks, type SwitchItem, type TranscriptEvent } from '../src/transcript/fold.ts';
import { projectFold } from './transcript-snapshot.ts';

// One corpus for the Web UI fold and the Mac transcript. Swift reads the same file from the repo.

const corpus = JSON.parse(readFileSync(fixture('transcript', 'corpus.json'), 'utf8')) as {
  cases: { name: string; events: TranscriptEvent[]; spans?: Span[]; items: unknown; plan: unknown }[];
};

const REQUIRED = [
  'grouping',
  'result-before-call',
  'zero-turn-success',
  'plan-placement',
  'self-parent',
  'undecodable-tool-use',
  'first-string-field',
  'mod-logs',
  'cloud-agent',
  'run-switch',
  'span-floor-break',
  'span-gap',
];

describe('transcript fold', () => {
  it('imports no react', () => {
    const src = readFileSync(new URL('../src/transcript/fold.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]react['"]/);
    expect(src).not.toMatch(/\breact\b/);
  });

  it('covers the shared cases', () => {
    expect(corpus.cases.map((c) => c.name).sort()).toEqual([...REQUIRED].sort());
  });

  it.each(REQUIRED)('%s matches the corpus', (name) => {
    const found = corpus.cases.find((c) => c.name === name);
    expect(found, name).toBeTruthy();
    expect(projectFold(found!.events, found!.spans)).toEqual({ items: found!.items, plan: found!.plan });
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

  describe('run switches', () => {
    const claude: RunName = { harness: 'claude', model: '', effort: '', harnessName: 'Claude Code', modelLabel: 'default model' };
    const codex: RunName = { harness: 'codex', model: '', effort: '', harnessName: 'Codex', modelLabel: 'default model' };
    const done: HandoverP = { to: codex, session: 'fresh', entries: 3, omitted: 0, chars: 400 };
    const ev = (kind: string, p: unknown): [string, unknown] => [kind, p];
    const fold = (rows: [string, unknown][]) =>
      buildItems(rows.map(([kind, p], i) => ({ id: i + 1, kind, payload: JSON.stringify(p), created_at: '2026-10-23T09:00:00.000Z' }))).items;
    const switches = (rows: [string, unknown][]) =>
      fold(rows)
        .filter((it): it is SwitchItem => it.type === 'switch')
        .map((it) => ({ key: it.key, mode: it.p.mode, done: it.done, superseded: it.superseded }));
    const sw = (from: RunName, to: RunName, mode: SwitchP['mode']): SwitchP => ({ from, to, mode });

    it('fills the pending handover when the next session picks it up', () => {
      expect(switches([ev('switch', sw(claude, codex, 'handover')), ev('user', { text: 'go' }), ev('handover', done)])).toEqual([
        { key: 1, mode: 'handover', done, superseded: false },
      ]);
    });

    it('keeps a handover pending across a model change on the same harness', () => {
      const faster = { ...codex, effort: 'low' };
      expect(switches([ev('switch', sw(claude, codex, 'handover')), ev('switch', sw(codex, faster, 'settings')), ev('handover', done)])).toEqual([
        { key: 1, mode: 'handover', done, superseded: false },
        { key: 2, mode: 'settings', done: null, superseded: false },
      ]);
    });

    it('replaces a pending handover with a later handover or a switch back', () => {
      const cursor = { ...codex, harness: 'cursor', harnessName: 'Cursor Agent' };
      expect(
        switches([
          ev('switch', sw(claude, codex, 'handover')),
          ev('switch', sw(codex, cursor, 'handover')),
          ev('switch', sw(cursor, claude, 'back')),
          ev('handover', done),
        ]),
      ).toEqual([
        { key: 1, mode: 'handover', done: null, superseded: true },
        { key: 2, mode: 'handover', done: null, superseded: true },
        { key: 3, mode: 'back', done: null, superseded: false },
      ]);
    });

    it('adds no row for a handover and drops one with nothing pending', () => {
      const items = fold([ev('user', { text: 'hi' }), ev('handover', done)]);
      expect(items.map((it) => it.type)).toEqual(['user']);
    });

    it('ends a group of calls', () => {
      const call = (id: string) => ev('tool_use', { id, name: 'Bash', input: { command: 'ls' }, parent: null });
      const items = fold([call('a'), ev('switch', sw(claude, codex, 'handover')), call('b')]);
      expect(items.map((it) => it.type)).toEqual(['tools', 'switch', 'tools']);
    });
  });
});
