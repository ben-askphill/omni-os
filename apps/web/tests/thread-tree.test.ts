// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by thread tree tests');
});

// The store as the confirmation reads it: the lists, and setDone as a spy.
const app = vi.hoisted(() => ({ channels: [] as unknown[], needsYou: null as unknown, setDone: null as unknown as (id: string, on: boolean) => Promise<unknown> }));
vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useApp: () => app,
}));

import { buildTree, doneNeedsConfirm, treeOpen, treePrefKey, treeRows, type SavedOpen } from '@omni/shared/thread-tree.ts';
import { asksForYou } from '@omni/shared/status.ts';
import type { ChannelWithRunning, NeedsYou, NeedsYouItem, Thread, ThreadStub } from '../src/api.ts';
import { inboxLayout } from '../src/inbox.ts';
import { reasonOf } from '../src/needs-you.ts';
import { readPref, writePref } from '../src/store.tsx';
import { treeSource } from '../src/thread-tree.ts';
import { DoneConfirmProvider, useMarkDone } from '../src/done-confirm.tsx';

// The thread tree as the Web UI reads it (apps/web/src/thread-tree.ts, apps/web/src/done-confirm.tsx): the channel
// listing's handoffs and teams and Needs you's blockers in, the tree under a job out.

const s = (id: string, channel_id: string, status: string, over: Partial<ThreadStub> = {}): ThreadStub => ({
  id, channel_id, title: id, status: status as ThreadStub['status'], created_at: '2026-11-15T20:00:00.000Z', updated_at: '2026-11-15T20:00:00.000Z', ...over,
});
const channel = (id: string, over: Partial<ChannelWithRunning> = {}) => ({ id, name: id, running: 0, ...over }) as ChannelWithRunning;

const job = s('job', 'conductor', 'done', { delegating: true });
const asks = s('asks', 'omni-os', 'running', { harness: 'cursor', model: 'composer-2' });
const broke = s('broke', 'omni-os', 'failed');
const lead = s('lead', 'volero', 'done', { delegating: true, parent_id: 'job' });
const members = [s('m1', 'volero', 'running', { source: 'team' }), s('m2', 'volero', 'done', { source: 'team' })];
const channels = [
  channel('conductor', { handoffs: [{ parent: job, children: [asks, broke, lead] }] }),
  channel('volero', { teams: [{ parent: lead, children: members }] }),
];
const item = (thread: ThreadStub, blockers: NeedsYouItem['blockers'], result: NeedsYouItem['result'] = null): NeedsYouItem => ({
  thread: thread as unknown as Thread,
  result,
  blockers,
  at: '2026-11-15T20:05:00.000Z',
});
const jobWaits = item(job, [
  { kind: 'question', detail: 'Which market first?', count: 1, from: ['asks'] },
  { kind: 'child_failed', detail: 'broke', count: 1, from: ['broke'] },
]);
const needsYou = (items: NeedsYouItem[]): NeedsYou => ({ items, unread: 0, blocked: items.length });

describe('a failed child moves its job to Needs you', () => {
  it('reads a child_failed blocker as Ben having to act, so the job leaves Working for Needs you', () => {
    const failedOnly = item(job, [{ kind: 'child_failed', detail: 'broke', count: 1, from: ['broke'] }]);
    expect(reasonOf(failedOnly)).toMatchObject({ glyph: 'failed', label: 'A delegated thread failed', detail: 'broke' });
    expect(asksForYou(reasonOf(failedOnly).glyph)).toBe(true);
    // The job still works through its other children, but what holds it up wins: it waits in the inbox.
    const layout = inboxLayout({ threads: [job], needs: [failedOnly], delegated: new Set(), open: null });
    expect(layout.inbox.map((t) => t.id)).toEqual(['job']);
    expect(layout.working).toEqual([]);
  });

  it('shows the failed child as a row under the closed tree, with the one that asked', () => {
    const { index, flags } = treeSource(channels, needsYou([jobWaits]));
    const nodes = buildTree('job', index, flags);
    expect(nodes.map((n) => [n.thread.id, n.state])).toEqual([
      ['asks', 'needs'],
      ['broke', 'failed'],
      ['lead', 'running'],
    ]);
    expect(treeRows(nodes, false).rows.map((n) => n.thread.id)).toEqual(['asks', 'broke']);
    // The team's members sit under their lead, from the lead channel's `teams`.
    expect(nodes[2].children.map((n) => n.thread.id)).toEqual(['m1', 'm2']);
  });
});

describe('the Done confirmation', () => {
  it('asks while anything under the job runs, failed or waits on Ben', () => {
    const { index, flags } = treeSource(channels, needsYou([jobWaits]));
    expect(doneNeedsConfirm(buildTree('job', index, flags))).toBe(true);
  });

  it('is one click when everything under the job finished, or for a thread with nothing under it', () => {
    const settled = [channel('conductor', { handoffs: [{ parent: job, children: [s('a', 'omni-os', 'done'), s('b', 'omni-os', 'done')] }] })];
    const { index, flags } = treeSource(settled, needsYou([]));
    expect(doneNeedsConfirm(buildTree('job', index, flags))).toBe(false);
    expect(doneNeedsConfirm(buildTree('lonely', index, flags))).toBe(false);
  });
});

describe('the Done confirmation, rendered', () => {
  let root: Root;
  let host: HTMLDivElement;
  let mark: ReturnType<typeof useMarkDone>;
  const Grab = () => {
    const m = useMarkDone();
    useEffect(() => void (mark = m), [m]);
    return null;
  };
  // The lists as they are when it renders, as the store re-renders it on every change.
  const mount = async (lists: ChannelWithRunning[], items: NeedsYouItem[]) => {
    app.channels = lists;
    app.needsYou = needsYou(items);
    await act(async () => root.render(createElement(DoneConfirmProvider, null, createElement(Grab))));
  };
  beforeEach(() => {
    app.setDone = vi.fn(async (id: string) => ({ id }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const dialog = () => document.querySelector('[role="dialog"]');
  const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

  it('asks before marking a job done with work still going under it, and marks it only on confirm', async () => {
    await mount(channels, [jobWaits]);
    let result: unknown;
    await act(async () => void mark(job, true).then((r) => (result = r)));
    expect(dialog()?.textContent).toContain('2 still run, 1 waits on you, 1 failed');
    expect(app.setDone).not.toHaveBeenCalled();
    await act(async () => button('Mark as done').click());
    expect(app.setDone).toHaveBeenCalledWith('job', true);
    expect(result).toEqual({ id: 'job' });
    expect(dialog()).toBeNull();
  });

  it('leaves the job as it was when Ben cancels', async () => {
    await mount(channels, [jobWaits]);
    let result: unknown = 'pending';
    await act(async () => void mark(job, true).then((r) => (result = r)));
    await act(async () => button('Cancel').click());
    expect(result).toBeNull();
    expect(app.setDone).not.toHaveBeenCalled();
  });

  it('marks done in one click once everything under it finished, and never asks to undo', async () => {
    await mount([channel('conductor', { handoffs: [{ parent: job, children: [s('a', 'omni-os', 'done')] }] })], []);
    await act(async () => void mark(job, true));
    expect(dialog()).toBeNull();
    expect(app.setDone).toHaveBeenCalledWith('job', true);
    await mount(channels, [jobWaits]);
    await act(async () => void mark(job, false));
    expect(app.setDone).toHaveBeenLastCalledWith('job', false);
  });
});

describe('open state per view', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the sidebar\'s choice and the Inbox\'s apart on this device', () => {
    writePref(treePrefKey('sidebar', 'job'), { open: false, phase: 'running' } satisfies SavedOpen);
    const sidebar = readPref<SavedOpen | null>(treePrefKey('sidebar', 'job'), null);
    const inbox = readPref<SavedOpen | null>(treePrefKey('inbox', 'job'), null);
    expect(treeOpen('running', sidebar)).toBe(false);
    expect(treeOpen('running', inbox)).toBe(true);
    expect(Object.keys(localStorage)).toEqual(['omni.tree.sidebar.job']);
  });
});
