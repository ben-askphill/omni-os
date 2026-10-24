import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import { LONG_THREAD } from '@omni/test-fixtures/long-thread.ts';
import { ALL, applyPage, earlierCursor, HISTORY_BUDGET, laterCursor, openHistory, revealCursor, spanIndex, TURN_END, type History, type HistoryBudget, type HistoryRow, type Span } from '@omni/shared/history.ts';
import { buildItems, type Item, type TranscriptEvent } from '../src/transcript/fold.ts';
import { historyServer, longRows } from './history-sim.ts';
import { projectFold } from './transcript-snapshot.ts';

// The fold over held spans (#223): the same rules as Transcript.swift, checked on the shared corpus and on real pages
// of the long fixture against the fold of the whole thread.

type Case = { name: string; events: TranscriptEvent[]; spans?: Span[]; items: unknown; plan: unknown };
const CORPUS = fixture('transcript', 'corpus.json');
const read = () => JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: Case[] };

const AT = '2026-09-28T07:57:15.000Z';
const ev = (id: number, kind: string, p: unknown): TranscriptEvent => ({ id, thread_id: 't', kind, payload: JSON.stringify(p), created_at: AT });
const call = (id: number, tid: string, name: string, input: unknown, parent: string | null = null) => ev(id, 'tool_use', { id: tid, name, input, parent });
const out = (id: number, tid: string, text = 'ok') => ev(id, 'tool_result', { tool_use_id: tid, text, is_error: false, truncated: false });
const result = (id: number) => ev(id, 'result', { ok: true, subtype: 'success', turns: 3 });

/** Inputs of the span cases. Their items and plan are recorded into the corpus with OMNI_RECORD_TRANSCRIPT_CORPUS=1. */
const SPAN_CASES: { name: string; events: TranscriptEvent[]; spans: Span[] }[] = [
  {
    // A head that starts mid-turn: its first call would join the anchor's group without the break at the edge, and
    // the background agent's call nests under its anchor and stays hidden.
    name: 'span-floor-break',
    spans: [{ from: 20, to: null }],
    events: [
      ev(10, 'init', { model: 'm', cwd: '/x', tools: 1, mcp: [] }),
      call(12, 'bg', 'Agent', { description: 'Watch the build', subagent_type: 'general-purpose', run_in_background: true }),
      call(20, 'c1', 'Bash', { command: 'tail build.log' }, 'bg'),
      out(21, 'c1'),
      call(22, 'c2', 'Grep', { pattern: 'error' }),
      out(23, 'c2'),
      call(24, 'p', 'TodoWrite', { todos: [{ content: 'Fix the build', activeForm: 'Fixing the build', status: 'in_progress' }] }),
      out(25, 'p'),
      ev(26, 'assistant_text', { text: 'Found it.' }),
      result(27),
    ],
  },
  {
    // An island and the head with a gap between: mod runs and groups do not join across it, the island's plan is
    // not shown (the gap may hold a newer one), and its question reads answered from the answer held as an anchor.
    name: 'span-gap',
    spans: [
      { from: 5, to: 12 },
      { from: 20, to: null },
    ],
    events: [
      ev(5, 'user', { text: 'Plan it' }),
      call(6, 't1', 'TodoWrite', { todos: [{ content: 'Old step', status: 'pending' }] }),
      out(7, 't1'),
      ev(8, 'question', { id: 'q1', questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: 'Ship now' }, { label: 'No', description: 'Wait' }], multiSelect: false }] }),
      ev(9, 'mod', { plugin: 'lint', text: 'island line' }),
      ev(15, 'question_answer', { id: 'q1', state: 'answered', answers: [{ selected: ['Yes'], other: null }], via: 'tool' }),
      ev(20, 'mod', { plugin: 'lint', text: 'head line' }),
      call(21, 'h1', 'Read', { file_path: '/x/b.ts' }),
      out(22, 'h1'),
      ev(23, 'assistant_text', { text: 'Done.' }),
      result(24),
    ],
  },
];

describe('fold with spans', () => {
  it('records the span cases in the shared corpus', () => {
    const corpus = read();
    const recorded = SPAN_CASES.map((c) => ({ name: c.name, events: c.events, spans: c.spans, ...projectFold(c.events, c.spans) }));
    if (process.env.OMNI_RECORD_TRANSCRIPT_CORPUS) {
      const kept = corpus.cases.filter((c) => !SPAN_CASES.some((s) => s.name === c.name));
      writeFileSync(CORPUS, `${JSON.stringify({ cases: [...kept, ...recorded] }, null, 2)}\n`);
    }
    for (const r of recorded) expect(read().cases.find((c) => c.name === r.name), `${r.name}: record it with OMNI_RECORD_TRANSCRIPT_CORPUS=1`).toEqual(JSON.parse(JSON.stringify(r)));
  });

  it('breaks the group at a span edge and hides what nests into an anchor', () => {
    const c = SPAN_CASES[0];
    const { items, plan } = buildItems(c.events, c.spans);
    expect(items.map((it) => [it.type, it.key])).toEqual([
      ['tools', 22],
      ['text', 26],
      ['result', 27],
    ]);
    const tools = items[0] as Extract<Item, { type: 'tools' }>;
    expect(tools.calls.map((x) => x.id)).toEqual(['c2', 'p']);
    expect(plan?.after).toBe(22);
  });

  it('keeps each span to itself and settles a question from an anchor', () => {
    const c = SPAN_CASES[1];
    const { items, plan } = buildItems(c.events, c.spans);
    expect(items.map((it) => (it.type === 'mod' ? [it.key, it.lines.map((l) => l.text)] : [it.key, it.type]))).toEqual([
      [5, 'user'],
      [6, 'tools'],
      [8, 'question'],
      [9, ['island line']],
      [20, ['head line']],
      [21, 'tools'],
      [23, 'text'],
      [24, 'result'],
    ]);
    expect(items.find((it) => it.type === 'question')).toMatchObject({ q: { state: 'answered' } });
    expect(plan).toBeNull();
  });

  it('folds every corpus case the same with the whole thread as one span', () => {
    for (const c of read().cases) {
      if (c.spans) continue;
      expect(buildItems(c.events, [ALL]), c.name).toEqual(buildItems(c.events));
    }
  });

  it('carries the clip marker to the items and calls that show it', () => {
    const clipped = { bytes: 4_000_000 };
    const events = [
      { ...ev(1, 'user', { text: 'Pasted…' }), clipped },
      { ...call(2, 'w', 'Write', { file_path: '/x', content: 'abc…' }), clipped },
      { ...out(3, 'w', 'Wrote…'), clipped },
    ];
    const { items } = buildItems(events);
    expect(items[0]).toMatchObject({ type: 'user', clipped });
    const c = (items[1] as Extract<Item, { type: 'tools' }>).calls[0];
    expect(c).toMatchObject({ event: 2, clipped, result: { event: 3, clipped } });
  });
});

// ---------- the long fixture, paged ----------

const ROWS = longRows();

/** What the whole thread's fold shows inside the held spans: the items a window must equal. */
function expected(full: ReturnType<typeof buildItems>, h: History, partial: Set<number>) {
  const items = full.items.filter((it) => spanIndex(h.spans, it.key) >= 0);
  return { items, plan: full.plan && spanIndex(h.spans, full.plan.after) === h.spans.length - 1 ? full.plan : null, partial };
}

/** A span that starts mid-turn: its first group began below it, so the window shows that group's rest on its own. */
function partialStarts(h: History, rows: HistoryRow[]) {
  const out = new Set<number>();
  for (const s of h.spans) {
    const before = rows.findLast((r) => r.id < s.from);
    if (s.from > 0 && before && before.kind !== TURN_END) out.add(s.from);
  }
  return out;
}

function checkWindow(h: History, rows: HistoryRow[], full: ReturnType<typeof buildItems>, label: string) {
  const got = buildItems(h.rows as TranscriptEvent[], h.spans);
  const want = expected(full, h, partialStarts(h, rows));
  let items = got.items;
  for (const from of want.partial) {
    const first = items.find((it) => it.key >= from);
    if (first?.type === 'tools' && !want.items.some((it) => it.key === first.key)) items = items.filter((it) => it !== first);
  }
  expect(items, label).toEqual(want.items);
  expect(got.plan, label).toEqual(want.plan);
}

function pageToStart(budget: HistoryBudget) {
  const server = historyServer(ROWS, budget);
  const full = buildItems(server.rows);
  const head = server.head();
  let h: History = openHistory(head.events, head.head);
  const states = [h];
  for (let c = earlierCursor(h); c; c = earlierCursor(h)) {
    h = applyPage(h, server.page(c));
    states.push(h);
  }
  return { server, full, states };
}

describe('fold parity on the long fixture', () => {
  it('equals the whole fold at every page edge from the head to the start', () => {
    const { server, full, states } = pageToStart(HISTORY_BUDGET);
    expect(states.length).toBeGreaterThan(5);
    expect(states[states.length - 1].spans).toEqual([ALL]);
    states.forEach((h, i) => checkWindow(h, server.rows, full, `page ${i}`));
  });

  it('equals it with pages smaller than a turn, partial pages included', () => {
    const { server, full, states } = pageToStart({ ...HISTORY_BUDGET, rows: 40 });
    expect(states.some((h) => partialStarts(h, server.rows).size > 0)).toBe(true);
    states.forEach((h, i) => checkWindow(h, server.rows, full, `small page ${i}`));
  });

  it('hides a background agent\'s calls under its parent anchor', () => {
    const { server, full, states } = pageToStart({ ...HISTORY_BUDGET, rows: 40 });
    const bg = server.rows.find((r) => r.kind === 'tool_use' && r.payload.includes(`"id":"${LONG_THREAD.backgroundCall}"`))!;
    const child = server.rows.find((r) => r.kind === 'tool_use' && r.payload.includes(`"parent":"${LONG_THREAD.backgroundCall}"`))!;
    const h = states.find((s) => spanIndex(s.spans, child.id) >= 0 && spanIndex(s.spans, bg.id) < 0)!;
    expect(h.rows.some((r) => r.id === bg.id), 'the parent call came as an anchor').toBe(true);
    const shown = buildItems(h.rows as TranscriptEvent[], h.spans).items.flatMap((it) => (it.type === 'tools' ? it.calls : []));
    expect(shown.some((c) => c.parent === LONG_THREAD.backgroundCall)).toBe(false);
    checkWindow(h, server.rows, full, 'background agent');
  });

  it('equals it on a revealed island and while its gap fills from both sides', () => {
    const server = historyServer(ROWS);
    const full = buildItems(server.rows);
    const needle = server.rows.find((r) => r.kind === 'user' && r.payload.includes(LONG_THREAD.oldNeedle))!;
    const head = server.head();
    let h: History = openHistory(head.events, head.head);
    const c = revealCursor(h, needle.id)!;
    h = applyPage(h, server.page(c));
    expect(spanIndex(h.spans, needle.id)).toBe(0);
    expect(h.spans).toHaveLength(2);
    checkWindow(h, server.rows, full, 'island');
    for (let step = 0; h.spans.length > 1; step++) {
      const next = step % 2 ? earlierCursor(h, 1) : laterCursor(h, 0);
      h = applyPage(h, server.page(next!));
      checkWindow(h, server.rows, full, `gap step ${step}`);
    }
  });
});

describe('fold work on open', () => {
  it('folds a head page instead of the whole thread', () => {
    const server = historyServer(ROWS);
    const head = server.head();
    const time = (rows: HistoryRow[], spans?: Span[]) => {
      const t = performance.now();
      const { items } = buildItems(rows as TranscriptEvent[], spans);
      return { items: items.length, ms: performance.now() - t };
    };
    const full = time(server.rows);
    const open = time(head.events, [{ from: head.head.from, to: null }]);
    const baseline = {
      fixture: 'longThread()',
      budget: HISTORY_BUDGET,
      full: { rows: server.rows.length, items: full.items },
      head: { rows: head.events.length, anchors: head.anchors, items: open.items },
    };
    console.log(`fold on open: whole thread ${full.ms.toFixed(1)} ms, head page ${open.ms.toFixed(1)} ms`);
    const path = fixture('history', 'fold-baseline.json');
    if (process.env.OMNI_RECORD_HISTORY_BASELINE) writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
    expect(existsSync(path), 'record it with OMNI_RECORD_HISTORY_BASELINE=1').toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(baseline);
    expect(head.events.length).toBeLessThan(server.rows.length / 5);
  });
});
