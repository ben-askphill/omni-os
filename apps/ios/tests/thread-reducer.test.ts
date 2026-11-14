import type { Artifact, HistoryEvent, PendingMsg, Thread } from '@omni/client-core';
import { LEAD_ID, OPENING_ID } from '@omni/shared/opening.ts';
import { describe, expect, it } from 'vitest';

import { emptyThreadView, reduceThread, withChanges, withDetail, type ThreadView } from '../src/live/thread-reducer';
import { threadRows } from '../src/thread/rows';

const thread = (id: string, over: Partial<Thread> = {}): Thread =>
  ({ id, channel_id: 'c', title: `Thread ${id}`, status: 'running', parent_id: null, created_at: '2026-11-14T10:00:00Z', updated_at: '2026-11-14T10:00:00Z', ...over }) as Thread;
const artifact = (id: number, over: Partial<Artifact> = {}): Artifact => ({
  id,
  thread_id: 'p',
  path: `/tmp/a${id}.html`,
  name: `a${id}.html`,
  kind: 'html',
  size: 10,
  url: null,
  description: null,
  created_at: '2026-11-14T10:00:00Z',
  updated_at: '2026-11-14T10:00:00Z',
  ...over,
});
const row = (id: number, kind: string, payload: unknown): HistoryEvent => ({ id, thread_id: 'p', kind, payload: JSON.stringify(payload), created_at: '2026-11-14T10:00:00Z' });
const pendingRow = (uuid: string, text: string, state: PendingMsg['state'] = 'sent'): PendingMsg => ({ uuid, kind: 'user', text, mode: 'queue', state });

/** The open thread `p`, loaded, with one child `k1` and parent `up`. */
function opened(over: Partial<Parameters<typeof withDetail>[1]> = {}): ThreadView {
  return withDetail(emptyThreadView('p'), {
    thread: thread('p', { parent_id: 'up' }),
    parent: thread('up', { status: 'running' }),
    children: [thread('k1', { parent_id: 'p', title: 'Old title' })],
    artifacts: [artifact(1)],
    events: [],
    pending: [],
    ...over,
  });
}

describe('reduceThread: delegated threads', () => {
  const cases: { name: string; message: unknown; children: [string, string, string][] }[] = [
    {
      name: 'a crew thread created after the parent was opened appears (feed)',
      message: { type: 'thread', thread: thread('k2', { parent_id: 'p', title: 'New crew', status: 'running' }) },
      children: [
        ['k1', 'Old title', 'running'],
        ['k2', 'New crew', 'running'],
      ],
    },
    {
      name: 'an existing child takes its new title and status in place (feed)',
      message: { type: 'thread', thread: thread('k1', { parent_id: 'p', title: 'Renamed', status: 'done' }) },
      children: [['k1', 'Renamed', 'done']],
    },
    {
      name: 'a child update on the stream shape is upserted the same way',
      message: { kind: 'thread', thread: thread('k1', { parent_id: 'p', title: 'Renamed', status: 'failed' }) },
      children: [['k1', 'Renamed', 'failed']],
    },
    {
      name: 'a thread with a different parent is ignored',
      message: { type: 'thread', thread: thread('x', { parent_id: 'other', title: 'Elsewhere' }) },
      children: [['k1', 'Old title', 'running']],
    },
    {
      name: 'a thread with no parent is ignored',
      message: { type: 'thread', thread: thread('x') },
      children: [['k1', 'Old title', 'running']],
    },
  ];
  it.each(cases)('$name', ({ message, children }) => {
    const next = reduceThread(opened(), message);
    expect(next.children.map((c) => [c.id, c.title, c.status])).toEqual(children);
  });

  it('returns the view itself when a message concerns no thread here', () => {
    const view = opened();
    for (const message of [{ type: 'thread', thread: thread('x', { parent_id: 'other' }) }, { type: 'usage' }, null, 'text', { kind: 'thread' }]) {
      expect(reduceThread(view, message)).toBe(view);
    }
  });

  it('keeps the parent current from the feed', () => {
    const next = reduceThread(opened(), { type: 'thread', thread: thread('up', { status: 'done', title: 'Conductor' }) });
    expect(next.parent).toMatchObject({ id: 'up', status: 'done', title: 'Conductor' });
  });
});

describe('reduceThread: artifacts', () => {
  const cases: { name: string; message: unknown; artifacts: [number, string][] }[] = [
    { name: 'a new artifact appears last', message: { kind: 'artifact', artifact: artifact(2, { name: 'report.html' }) }, artifacts: [[1, 'a1.html'], [2, 'report.html']] },
    { name: 'a rewritten artifact replaces its old copy in place', message: { kind: 'artifact', artifact: artifact(1, { name: 'renamed.html' }) }, artifacts: [[1, 'renamed.html']] },
    { name: 'another thread’s artifact is ignored', message: { kind: 'artifact', artifact: artifact(3, { thread_id: 'other' }) }, artifacts: [[1, 'a1.html']] },
    { name: 'a message with no artifact is ignored', message: { kind: 'artifact' }, artifacts: [[1, 'a1.html']] },
  ];
  it.each(cases)('$name', ({ message, artifacts }) => {
    expect(reduceThread(opened(), message).artifacts.map((a) => [a.id, a.name])).toEqual(artifacts);
  });
});

describe('reduceThread: the open thread itself', () => {
  const handoff = { id: 'h1', state: { phase: 'offered' } };
  const cases: { name: string; message: Record<string, unknown>; expected: Partial<ThreadView> }[] = [
    {
      name: 'status, warm process and pending list from the stream',
      message: { kind: 'thread', thread: thread('p', { status: 'done' }), pending: [pendingRow('u9', 'later', 'waiting')], live: true },
      expected: { status: 'ready', live: true, blocked: null, handoff: null, takeover: null },
    },
    {
      name: 'a blocker and a handoff',
      message: { kind: 'thread', thread: thread('p'), pending: [], blocked: 'Running on Studio.', handoff },
      expected: { blocked: 'Running on Studio.', handoff: handoff as never },
    },
  ];
  it.each(cases)('$name', ({ message, expected }) => {
    const next = reduceThread(opened(), message);
    expect(next.thread).toBe(message.thread);
    expect(next).toMatchObject(expected);
    expect(next.pending).toEqual(message.pending);
  });

  it('leaves the feed’s copy of the open thread to the stream', () => {
    const view = opened();
    expect(reduceThread(view, { type: 'thread', thread: thread('p', { status: 'done' }) })).toBe(view);
  });
});

describe('opening message', () => {
  const opening = { text: 'Fix the build please', uuid: 'u1' };
  const firstSend = pendingRow('u1', 'Fix the build please');

  it('draws the first message as a row, takes it out of the pending list, and shows the thinking line', () => {
    const view = opened({ opening, pending: [firstSend] });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ id: OPENING_ID, kind: 'user' });
    expect(JSON.parse(view.rows[0].payload)).toEqual({ text: 'Fix the build please' });
    expect(view.pending).toEqual([]);
    // The server's own lists stay as sent, so a send in flight still settles against them.
    expect(view.held).toEqual({ rows: [], pending: [firstSend] });

    const rows = threadRows({ events: view.rows, spans: [{ from: 0, to: null }], thread: view.thread!, artifacts: [], children: [], atStart: true }).rows;
    expect(rows.map((r) => r.kind)).toEqual(['prompt', 'thinking']);
  });

  const stream: { name: string; message: Record<string, unknown>; rows: number[]; pending: string[] }[] = [
    {
      name: 'the stream brings the opening message while the turn starts',
      message: { kind: 'thread', thread: thread('p'), pending: [firstSend], opening },
      rows: [OPENING_ID],
      pending: [],
    },
    {
      name: 'opening null clears it',
      message: { kind: 'thread', thread: thread('p'), pending: [], opening: null },
      rows: [],
      pending: [],
    },
  ];
  it.each(stream)('$name', ({ message, rows, pending }) => {
    const next = reduceThread(opened(), message);
    expect(next.rows.map((r) => r.id)).toEqual(rows);
    expect(next.pending.map((p) => p.uuid)).toEqual(pending);
  });

  it('keeps the opening message held when a stream message leaves `opening` out', () => {
    const next = reduceThread(opened({ opening, pending: [firstSend] }), { kind: 'thread', thread: thread('p'), pending: [firstSend] });
    expect(next.rows.map((r) => r.id)).toEqual([OPENING_ID]);
    expect(next.pending).toEqual([]);
  });

  it('draws a later turn’s first message after the transcript, as web does', () => {
    const done = [row(1, 'user', { text: 'first' }), row(2, 'result', { ok: true })];
    const next = reduceThread(withChanges(opened(), { rows: done }), { kind: 'thread', thread: thread('p'), pending: [pendingRow('u2', 'second')] });
    expect(next.rows.map((r) => r.id)).toEqual([1, 2, LEAD_ID]);
    expect(next.pending).toEqual([]);
  });

  it('gives way to the transcript once the harness replays the message', () => {
    let view = reduceThread(opened(), { kind: 'thread', thread: thread('p'), pending: [firstSend], opening });
    expect(view.rows.map((r) => r.id)).toEqual([OPENING_ID]);
    view = withChanges(view, { rows: [row(5, 'user', { text: 'Fix the build please' })] });
    view = reduceThread(view, { kind: 'thread', thread: thread('p'), pending: [], opening: null });
    expect(view.rows.map((r) => r.id)).toEqual([5]);
    expect(view.pending).toEqual([]);
  });

  it('keeps the same rows and pending arrays when nothing the join reads changed', () => {
    const view = opened({ opening, pending: [firstSend] });
    const next = withChanges(view, { loadingOlder: true });
    expect(next.rows).toBe(view.rows);
    expect(next.pending).toBe(view.pending);
  });
});
