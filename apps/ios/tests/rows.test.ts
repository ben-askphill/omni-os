import type { Artifact, HistoryEvent, Thread } from '@omni/client-core';
import type { Span } from '@omni/shared/history.ts';
import corpusJson from '@omni/test-fixtures/transcript/corpus.json';
import type { ToolCall } from '@omni/shared/transcript-fold.ts';
import { describe, expect, it } from 'vitest';

import clipped from './fixtures/rich-clipped.json';
import group from './fixtures/rich-group.json';
import kinds from './fixtures/rich-kinds.json';
import question from './fixtures/rich-question.json';
import running from './fixtures/rich-running.json';
import { CLOSED, ITEM_ROWS, threadRows, type RowKind, type RowsInput, type ThreadRow } from '../src/thread/rows';

interface Case {
  name: string;
  events: { id?: number; kind: string; payload: string; created_at: string; agent?: string }[];
  spans?: Span[];
  status?: string;
}

const corpus = corpusJson as unknown as { cases: Case[] };
const local = [kinds, clipped, question, running, group] as unknown as Case[];

const thread = (status = 'done', extra: Partial<Thread> = {}) =>
  ({ id: 't', status, harness: 'claude-code', cwd: '/work/volero', parent_id: null, task_id: null, channel_id: 'c', created_at: '2026-11-02T09:00:00Z', ...extra }) as unknown as Thread;

function input(c: Case, extra: Partial<RowsInput> = {}): RowsInput {
  const events = c.events.map((e, i) => ({ id: e.id ?? i + 1, thread_id: 't', kind: e.kind, payload: e.payload, created_at: e.created_at, agent: e.agent ?? null })) as HistoryEvent[];
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
        for (const r of t.risks ?? []) expect(of(rows, 'merge_risk').some((x) => x.kind === 'merge_risk' && x.p === r.p)).toBe(true);
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

const rich = local.find((c) => c.name === 'rich-kinds')!;

describe('threadRows', () => {

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

  it('shows the live turn with its thinking line, its plain steps and its actions so far', () => {
    const live = local.find((c) => c.name === 'rich-running')!;
    const rows = threadRows(input(live)).rows;
    expect(of(rows, 'thinking')).toHaveLength(1);
    expect(of(rows, 'now')).toHaveLength(0);
    const [progress] = of(rows, 'progress');
    expect(progress).toBeTruthy();
    expect(progress.kind === 'progress' && progress.steps.some((s) => s.state === 'active')).toBe(true);
    // Plain words only: no tool names in the step list.
    expect(JSON.stringify(progress)).not.toMatch(/Bash|Read|Edit|TodoWrite|mcp__/);
    expect(of(rows, 'steps')[0]).toMatchObject({ live: true, steps: 2 });
    expect(of(rows, 'outcome')).toHaveLength(0);
  });

  it("labels the thinking line with the agent's status since Ben's last message, else Thinking, timed from the turn", () => {
    const live = local.find((c) => c.name === 'rich-running')!;
    const plain = of(threadRows(input(live)).rows, 'thinking')[0];
    const turn = live.events.findLast((e) => e.kind === 'user')!;
    expect(plain).toMatchObject({ label: 'Thinking', since: turn.created_at });
    const status = { kind: 'status', payload: JSON.stringify({ text: 'Compacting the conversation' }), created_at: '2026-11-02T09:09:00Z' };
    const compacting = of(threadRows(input({ ...live, events: [...live.events, status] })).rows, 'thinking')[0];
    expect(compacting).toMatchObject({ label: 'Compacting the conversation' });
  });

  it('drops the thinking line while a question waits on Ben', () => {
    const asking = local.find((c) => c.name === 'rich-question')!;
    const rows = threadRows(input({ ...asking, status: 'running' })).rows;
    expect(of(rows, 'question')).toHaveLength(1);
    expect(of(rows, 'thinking')).toHaveLength(0);
  });

  it('waits for a slot instead of thinking while the turn is queued', () => {
    const live = local.find((c) => c.name === 'rich-running')!;
    const rows = threadRows(input({ ...live, status: 'queued' })).rows;
    expect(of(rows, 'thinking')).toHaveLength(0);
    expect(of(rows, 'now')[0]).toMatchObject({ now: { verb: 'Waiting for a free slot' } });
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

  it('uses the agent avatar on the first reply in #conductor, including older threads', () => {
    const conductorChannel = { name: 'Conductor', icon: 'icon:play', avatar_bg: '#1e1e1e' };
    const channel_id = 'conductor';
    const current = threadRows(input(rich, { thread: thread('done', { channel_id, role: 'conductor' }), conductor: true, conductorChannel }));
    const older = threadRows(input(rich, { thread: thread('done', { channel_id }), conductor: true, conductorChannel }));
    expect(of(current.rows, 'author')[0]).toMatchObject({ agent: 'conductor', look: null });
    expect(of(older.rows, 'conductor')[0]).toMatchObject({ agent: 'conductor', look: null });
  });

  it("draws the Conductor line with the Omni mark while the Conductor has no look of its own", () => {
    for (const conductorChannel of [undefined, null, { name: 'Conductor', icon: null, avatar_bg: null }, { name: 'Conductor', icon: 'icon:not-a-glyph' }]) {
      const { rows } = threadRows(input(rich, { conductor: true, conductorChannel }));
      expect(of(rows, 'conductor').length).toBeGreaterThan(0);
      for (const r of of(rows, 'conductor')) expect(r).toMatchObject({ look: null });
    }
  });

  it("draws the Conductor line with the icon and background saved for it", () => {
    const saved = threadRows(input(rich, { conductor: true, conductorChannel: { name: 'Conductor', icon: '🎼', avatar_bg: '#283c62' } })).rows;
    for (const r of of(saved, 'conductor')) expect(r).toMatchObject({ look: { name: 'Conductor', icon: '🎼', avatar_bg: '#283c62' } });
    const bgOnly = threadRows(input(rich, { conductor: true, conductorChannel: { name: 'Conductor', icon: null, avatar_bg: '#283c62' } })).rows;
    for (const r of of(bgOnly, 'conductor')) expect(r).toMatchObject({ look: { icon: null, avatar_bg: '#283c62' } });
  });

  it('redraws the Conductor line when its look changes, and only that row', () => {
    const plain = threadRows(input(rich, { conductor: true })).rows;
    const saved = threadRows(input(rich, { conductor: true, conductorChannel: { name: 'Conductor', icon: 'icon:target', avatar_bg: null } }), plain).rows;
    for (const [i, r] of saved.entries()) expect(r === plain[i]).toBe(r.kind !== 'conductor');
  });

  it('does not rebuild a row that did not change when a call opens', () => {
    const a = threadRows(input(rich, { disclosure: CLOSED })).rows;
    const b = threadRows(input(rich, { disclosure: CLOSED }), a).rows;
    expect(b.every((r, i) => r === a[i])).toBe(true);
  });

});

/** A group thread's rows (ADR 0019), each with the agent that wrote it, one second apart. */
const groupEvents = (rows: { kind: string; payload: object; agent?: string | null }[]) =>
  rows.map((r, i) => ({ id: i + 1, thread_id: 't', kind: r.kind, payload: JSON.stringify(r.payload), created_at: `2026-11-20T12:00:${String(i).padStart(2, '0')}Z`, agent: r.agent ?? null })) as unknown as HistoryEvent[];
const groupRows = (rows: Parameters<typeof groupEvents>[0], extra: Partial<RowsInput> = {}) =>
  threadRows({ events: groupEvents(rows), thread: thread('done', { role: 'builder' }), artifacts: [], children: [], atStart: true, ...extra }).rows;
const ok = { ok: true, subtype: 'success', turns: 1, duration_ms: 2000 };

describe('threadRows in a group thread', () => {
  it("opens a reply with its author's line, and sets the reply beside the avatar", () => {
    const rows = groupRows([
      { kind: 'user', payload: { text: 'fix it', source: 'ben' } },
      { kind: 'assistant_text', payload: { text: 'Fixed.' }, agent: 'builder' },
      { kind: 'result', payload: ok, agent: 'builder' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['prompt', 'author', 'outcome', 'prose']);
    expect(rows[1]).toMatchObject({ kind: 'author', agent: 'builder', at: '2026-11-20T12:00:01Z' });
    expect(rows.slice(2).every((r) => r.inset)).toBe(true);
    expect(rows[0].inset).toBeFalsy();
  });

  it("reads a reply from before Omni recorded authors as the lead's, and draws no author line in a thread with no agent", () => {
    const old = [
      { kind: 'user', payload: { text: 'fix it', source: 'ben' } },
      { kind: 'assistant_text', payload: { text: 'Fixed.' } },
    ];
    expect(groupRows(old).find((r) => r.kind === 'author')).toMatchObject({ agent: 'builder' });
    expect(groupRows(old, { thread: thread('done') }).some((r) => r.kind === 'author')).toBe(false);
  });

  it('writes a quiet line when an agent joins or leaves, under the turn it followed', () => {
    const rows = groupRows([
      { kind: 'user', payload: { text: 'hi', source: 'ben' } },
      { kind: 'assistant_text', payload: { text: 'Hello.' }, agent: 'builder' },
      { kind: 'result', payload: ok, agent: 'builder' },
      { kind: 'member', payload: { event: 'joined', agent: 'designer', name: 'Designer' } },
      { kind: 'member', payload: { event: 'left', agent: 'designer', name: 'Designer' } },
    ]);
    expect(rows.filter((r) => r.kind === 'member').map((r) => r.kind === 'member' && [r.text, !!r.inset])).toEqual([
      ['Designer joined', false],
      ['Designer left', false],
    ]);
  });

  it("puts the merge-risk gate's rating under the turn it followed, as its own row outside the reply", () => {
    const rated = { repo: 'o/omni', pr: 914, url: 'https://github.com/o/omni/pull/914', head: '56597d6e01', level: 'medium', label: 'needs-ben', bullets: ['- **Impact:** 👀 touches `apps/server/sync/`'] };
    const rows = groupRows([
      { kind: 'user', payload: { text: 'Open the PR', source: 'ben' } },
      { kind: 'assistant_text', payload: { text: 'Opened #914.' }, agent: 'builder' },
      { kind: 'result', payload: ok, agent: 'builder' },
      { kind: 'merge_risk', payload: rated },
    ]);
    expect(rows.at(-1)).toEqual({ kind: 'merge_risk', key: 'mr4', p: rated });
    expect(rows.filter((r) => r.kind === 'merge_risk')).toHaveLength(1);
  });

  it('splits a message two agents answer into a tab per agent, the flag above, and shows the first lane with its files', () => {
    const { rows } = threadRows(input(group));
    const at = rows.findIndex((r) => r.kind === 'lanes');
    const lanes = rows[at];
    if (lanes.kind !== 'lanes') throw new Error('no lanes row');
    expect(lanes.tabs).toEqual([
      { agent: 'designer', status: 'done', hit: true },
      { agent: 'builder', status: 'done', hit: true },
    ]);
    expect(lanes.picked).toBe('designer');
    expect(rows[at - 1]).toMatchObject({ kind: 'collision', c: { label: 'sections/hero.liquid', agents: ['builder', 'designer'], cleared: null } });
    const lane = rows.slice(at + 1, rows.findIndex((r, i) => i > at && !r.inset && r.kind !== 'author' && r.kind !== 'files'));
    expect(lane[0]).toMatchObject({ kind: 'author', agent: 'designer' });
    expect(lane.filter((r) => r.kind === 'prose').map((r) => r.kind === 'prose' && r.text)).toEqual(['Spacing fixed on the hero.']);
    expect(lane.at(-1)).toMatchObject({ kind: 'files', files: [{ path: 'sections/hero.liquid', label: 'sections/hero.liquid', flagged: true }] });
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('shows the lane picked on its tab, and only that one', () => {
    const first = threadRows(input(group)).rows.find((r) => r.kind === 'lanes');
    if (first?.kind !== 'lanes') throw new Error('no lanes row');
    const { rows } = threadRows(input(group, { disclosure: { ...CLOSED, lanes: new Map([[first.turn, 'builder']]) } }));
    expect(rows.find((r) => r.kind === 'lanes')).toMatchObject({ picked: 'builder' });
    const prose = rows.filter((r) => r.kind === 'prose').map((r) => r.kind === 'prose' && r.text);
    expect(prose).toContain('Hero copy is tighter now.');
    expect(prose).not.toContain('Spacing fixed on the hero.');
  });

  it("keeps a running lane's thinking line on its own latest line", () => {
    const rows = groupRows(
      [
        { kind: 'user', payload: { text: 'go', source: 'ben', to: ['builder', 'designer'] } },
        { kind: 'assistant_text', payload: { text: 'Builder done.' }, agent: 'builder' },
        { kind: 'result', payload: ok, agent: 'builder' },
        { kind: 'tool_use', payload: { id: 'x', name: 'Read', input: { file_path: '/work/volero/a.ts' } }, agent: 'designer' },
      ],
      { thread: thread('running', { role: 'builder' }), disclosure: { ...CLOSED, lanes: new Map([[1, 'designer']]) } },
    );
    expect(rows.find((r) => r.kind === 'lanes')).toMatchObject({ tabs: [{ agent: 'builder', status: 'done' }, { agent: 'designer', status: 'running' }] });
    expect(rows.find((r) => r.kind === 'thinking')).toMatchObject({ inset: true, label: expect.stringContaining('a.ts') });
  });

  it('draws each agent a message went to on its To line, unless its text names the agent inline', () => {
    const mention = (id: string, agent: string, name: string) => ({ kind: 'agent_mention', v: 1, id, body: { agent, name } });
    const diff = { kind: 'diff_selection', v: 1, id: 'd1', body: { path: 'a.ts', side: 'new', start: 1, end: 2, text: 'x' } };
    const rows = groupRows([
      { kind: 'user', payload: { text: 'have a look', source: 'ben', to: ['designer'], context: [mention('m1', 'designer', 'Designer'), diff] } },
      { kind: 'user', payload: { text: '@Designer have a look', source: 'ben', to: ['designer'], context: [mention('m2', 'designer', 'Designer')] } },
    ]);
    const prompts = rows.filter((r) => r.kind === 'prompt');
    expect(prompts.map((r) => r.kind === 'prompt' && r.to)).toEqual([[{ agent: 'designer', name: 'Designer' }], []]);
    expect(prompts.map((r) => r.kind === 'prompt' && (r.chips as { id: string }[]).map((c) => c.id))).toEqual([['d1'], []]);
  });

  it("captions a team lead's message with its name, and names the members it went to", () => {
    const { rows } = threadRows(input(group, { thread: thread('done', { role: 'builder' }), agents: [{ id: 'builder', name: 'Builder' }, { id: 'designer', name: 'Designer' }] }));
    const lead = rows.find((r) => r.kind === 'prompt' && r.p.source === 'lead');
    expect(lead).toMatchObject({ caption: 'Builder', to: [{ agent: 'designer', name: 'Designer' }] });
    const wake = groupRows([{ kind: 'user', payload: { text: 'All members finished.', source: 'team' } }]);
    expect(wake[0]).toMatchObject({ kind: 'prompt', caption: 'Team' });
  });

  it("closes a remote agent's reply with the lock line while its channel keeps its work closed", () => {
    const reply = [
      { kind: 'user', payload: { text: 'review it', source: 'ben' } },
      { kind: 'assistant_text', payload: { text: 'Looks fine from here.' }, agent: 'hermes' },
      { kind: 'result', payload: ok, agent: 'hermes' },
    ];
    const agents = [{ id: 'hermes', name: 'Hermes', server: { harness: 'hermes' } }, { id: 'builder', name: 'Builder' }];
    const remote = { thread: thread('done', { role: 'hermes', harness: 'hermes' }), agents };
    const closed = groupRows(reply, { ...remote, channel: { name: 'acme', remote_work: 0 } });
    expect(closed.at(-1)).toMatchObject({ kind: 'lock', channel: 'acme', inset: true });
    expect(groupRows(reply, { ...remote, channel: { name: 'acme', remote_work: 1 } }).some((r) => r.kind === 'lock')).toBe(false);
    expect(groupRows(reply, { thread: thread('done', { role: 'hermes' }), agents: [{ id: 'hermes', name: 'Hermes' }] }).some((r) => r.kind === 'lock')).toBe(false);
  });

  it('draws an artifact the thread made as a row', () => {
    const art = { id: 9, name: 'funnel.html', path: 'funnel.html', kind: 'html', updated_at: '2026-11-02T09:01:00.000Z' } as unknown as Artifact;
    const { rows } = threadRows(input(rich, { artifacts: [art] }));
    expect(of(rows, 'artifact')).toHaveLength(1);
  });
});
