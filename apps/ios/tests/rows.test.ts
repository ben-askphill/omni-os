import type { Artifact, HistoryEvent, Thread } from '@omni/client-core';
import type { Span } from '@omni/shared/history.ts';
import corpusJson from '@omni/test-fixtures/transcript/corpus.json';
import type { ToolCall } from '@omni/shared/transcript-fold.ts';
import { describe, expect, it } from 'vitest';

import clipped from './fixtures/rich-clipped.json';
import kinds from './fixtures/rich-kinds.json';
import question from './fixtures/rich-question.json';
import running from './fixtures/rich-running.json';
import { CLOSED, ITEM_ROWS, threadRows, type RowKind, type RowsInput, type ThreadRow } from '../src/thread/rows';

interface Case {
  name: string;
  events: { id?: number; kind: string; payload: string; created_at: string }[];
  spans?: Span[];
  status?: string;
}

const corpus = corpusJson as unknown as { cases: Case[] };
const local = [kinds, clipped, question, running] as unknown as Case[];

const thread = (status = 'done', extra: Partial<Thread> = {}) =>
  ({ id: 't', status, harness: 'claude-code', cwd: '/work/volero', parent_id: null, task_id: null, channel_id: 'c', created_at: '2026-11-02T09:00:00Z', ...extra }) as unknown as Thread;

function input(c: Case, extra: Partial<RowsInput> = {}): RowsInput {
  const events = c.events.map((e, i) => ({ id: e.id ?? i + 1, thread_id: 't', kind: e.kind, payload: e.payload, created_at: e.created_at })) as HistoryEvent[];
  return { events, spans: c.spans, thread: thread(c.status ?? 'done'), artifacts: [], children: [], atStart: true, ...extra };
}

const walk = (calls: ToolCall[], fn: (c: ToolCall) => void) => {
  for (const c of calls) {
    fn(c);
    walk(c.children, fn);
  }
};

function allOpen(c: Case): { disclosure: NonNullable<RowsInput['disclosure']> } {
  const { view } = threadRows(input(c));
  const calls = new Set<string>();
  for (const t of view.turns) for (const it of t.items) if (it.type === 'tools') walk(it.calls, (call) => calls.add(call.id));
  return { disclosure: { turns: new Set(view.turns.map((t) => t.key)), calls } };
}

const of = (rows: ThreadRow[], kind: RowKind) => rows.filter((r) => r.kind === kind);

describe('threadRows covers every item the shared fold produces', () => {
  for (const c of [...corpus.cases, ...local]) {
    it(c.name, () => {
      const { rows, view } = threadRows(input(c, allOpen(c)));
      const keys = rows.map((r) => r.key);
      expect(new Set(keys).size, 'row keys are unique').toBe(keys.length);

      for (const [i, t] of view.turns.entries()) {
        expect(of(rows, 'prompt').filter((r) => t.prompts.some((p) => r.kind === 'prompt' && r.p === p))).toHaveLength(t.prompts.length);
        for (const r of t.reports) expect(of(rows, 'report').some((x) => x.kind === 'report' && x.r === r)).toBe(true);
        for (const q of t.questions) expect(of(rows, 'question').some((x) => x.kind === 'question' && x.q === q)).toBe(true);
        if (t.error) expect(of(rows, 'error').some((x) => x.kind === 'error' && x.text === t.error)).toBe(true);
        if (t.cloud) expect(of(rows, 'cloud').some((x) => x.kind === 'cloud' && x.p === t.cloud)).toBe(true);
        if (t.prose) expect(of(rows, 'prose').some((x) => x.kind === 'prose' && x.text === t.prose)).toBe(true);
        for (const s of t.switches) expect(of(rows, 'switch').some((x) => x.kind === 'switch' && x.it === s)).toBe(true);
        for (const a of t.artifacts) expect(of(rows, 'artifact').some((x) => x.kind === 'artifact' && x.a === a)).toBe(true);
        const live = i === view.turns.length - 1 && (t.status === 'running' || t.status === 'queued');
        if (!live && (t.result || t.error || t.status !== 'done')) expect(of(rows, 'outcome').some((x) => x.kind === 'outcome' && x.status === t.status), `turn ${i} outcome`).toBe(true);
        if (t.steps > 0) expect(of(rows, 'steps').some((x) => x.kind === 'steps' && x.turn === t.key && x.steps === t.steps)).toBe(true);

        const callIds: string[] = [];
        for (const it of t.items) if (it.type === 'tools') walk(it.calls, (call) => callIds.push(call.id));
        const drawn = of(rows, 'call').map((x) => (x.kind === 'call' ? x.call.id : ''));
        for (const id of callIds) expect(drawn, `call ${id}`).toContain(id);

        const texts = t.items.filter((it) => it.type === 'text');
        for (const it of texts.slice(0, -1)) if (it.type === 'text') expect(of(rows, 'note').some((x) => x.kind === 'note' && x.text === it.p.text)).toBe(true);
        for (const it of t.items) if (it.type === 'mod') expect(of(rows, 'mod').some((x) => x.kind === 'mod' && x.lines === it.lines)).toBe(true);
      }
    });
  }

  it('places every folded item kind on a row kind', () => {
    const placed = new Set<RowKind>(Object.values(ITEM_ROWS).flat());
    const seen = new Set<RowKind>();
    for (const c of [...corpus.cases, ...local]) for (const r of threadRows(input(c, allOpen(c))).rows) seen.add(r.kind);
    for (const kind of placed) expect(seen.has(kind), `no case draws a ${kind} row`).toBe(true);
  });
});

describe('threadRows', () => {
  const rich = local.find((c) => c.name === 'rich-kinds')!;

  it('keeps a step list closed until its turn is opened', () => {
    const closed = threadRows(input(rich)).rows;
    expect(of(closed, 'call')).toHaveLength(0);
    const first = of(closed, 'steps')[0];
    if (first.kind !== 'steps') throw new Error('no steps row');
    const open = threadRows(input(rich, { disclosure: { turns: new Set([first.turn]), calls: new Set() } })).rows;
    expect(of(open, 'call').length).toBeGreaterThan(0);
    expect(of(open, 'call').every((r) => r.kind === 'call' && !r.open)).toBe(true);
  });

  it('nests a sub-agent call under its parent, one level in', () => {
    const rows = threadRows(input(rich, allOpen(rich))).rows;
    const depth = (id: string) => rows.find((r) => r.kind === 'call' && r.call.id === id);
    expect(depth('task1')).toMatchObject({ depth: 0 });
    expect(depth('grep1')).toMatchObject({ depth: 1 });
  });

  it('opens a call on its own', () => {
    const base = allOpen(rich);
    const rows = threadRows(input(rich, { disclosure: { turns: base.disclosure.turns, calls: new Set(['bash1']) } })).rows;
    expect(rows.filter((r) => r.kind === 'call' && r.open).map((r) => r.kind === 'call' && r.call.id)).toEqual(['bash1']);
  });

  it('leaves the turn answer out of the steps and reads the earlier text as notes', () => {
    const rows = threadRows(input(rich, allOpen(rich))).rows;
    const notes = of(rows, 'note').map((r) => (r.kind === 'note' ? r.text : ''));
    expect(notes).toContain("I'll look at the rate table first, then run the tests.");
    expect(notes.some((n) => n.startsWith('## Checkout funnel'))).toBe(false);
  });

  it('shows the live turn with its status line, plan and steps so far', () => {
    const live = local.find((c) => c.name === 'rich-running')!;
    const rows = threadRows(input(live)).rows;
    expect(of(rows, 'now')).toHaveLength(1);
    expect(of(rows, 'steps')[0]).toMatchObject({ live: true, steps: 2 });
    expect(of(rows, 'outcome')).toHaveLength(0);
  });

  it('hides a row outside the spans: it informs the fold and never shows', () => {
    const gap = corpus.cases.find((c) => c.name === 'span-gap')!;
    const shown = new Set(gap.spans!.flatMap((s) => Array.from({ length: (s.to ?? gap.events.length) - s.from + 1 }, (_, i) => s.from + i)));
    const { rows } = threadRows(input(gap));
    const prompts = of(rows, 'prompt');
    expect(prompts.length).toBeGreaterThan(0);
    for (const r of prompts) if (r.kind === 'prompt') expect(shown.has(Number(r.key.slice(1)))).toBe(true);
  });

  it('captions a delegated thread, a steered message and a dropped one', () => {
    const { rows } = threadRows(input(rich, { thread: thread('done', { parent_id: 'p', task_id: 'T-7' } as Partial<Thread>) }));
    const captions = of(rows, 'prompt').map((r) => (r.kind === 'prompt' ? r.caption : null));
    expect(captions[0]).toBe('Delegated by the Conductor · T-7');
    expect(captions).toContain('Sent while it ran');
    expect(captions).toContain('Not delivered · The machine was offline');
  });

  it('reuses every unchanged row when one more event arrives', () => {
    const base = input(rich);
    const first = threadRows(base).rows;
    const more: Case = { ...rich, events: [...rich.events, { kind: 'assistant_text', payload: '{"text":"One more thing."}', created_at: '2026-11-02T10:00:00.000Z' }] };
    const next = threadRows(input(more), first).rows;
    const same = next.filter((r, i) => first[i] === r).length;
    expect(same).toBeGreaterThanOrEqual(first.length - 3);
    expect(next.length).toBeGreaterThan(first.length - 1);
  });

  it('keeps the quiet Conductor line for a Conductor answer', () => {
    const { rows } = threadRows(input(rich, { conductor: true }));
    expect(of(rows, 'conductor').length).toBeGreaterThan(0);
  });

  it('does not rebuild a row that did not change when a call opens', () => {
    const a = threadRows(input(rich, { disclosure: CLOSED })).rows;
    const b = threadRows(input(rich, { disclosure: CLOSED }), a).rows;
    expect(b.every((r, i) => r === a[i])).toBe(true);
  });

  it('draws an artifact the thread made as a row', () => {
    const art = { id: 9, name: 'funnel.html', path: 'funnel.html', kind: 'html', updated_at: '2026-11-02T09:01:00.000Z' } as unknown as Artifact;
    const { rows } = threadRows(input(rich, { artifacts: [art] }));
    expect(of(rows, 'artifact')).toHaveLength(1);
  });
});
