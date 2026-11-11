import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Thread } from '../src/api.ts';
import { ThreadQuickCard } from '../src/components/thread/ThreadQuickCard.tsx';

const thread = (over: Partial<Thread> = {}) =>
  ({
    id: 't1',
    channel_id: 'omni',
    title: 'Lead',
    status: 'running',
    harness: 'cursor',
    session_id: 's1',
    cwd: '/home/ben/omni-os/data/worktrees/t1',
    branch: 'omni/t1',
    source: 'manual',
    created_at: '2026-10-28T09:00:00.000Z',
    updated_at: '2026-10-28T09:00:00.000Z',
    ...over,
  }) as Thread;

describe('the thread quick card', () => {
  it('lists machine, checkout, harness, branch work and a door into the inspector', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadQuickCard, {
        thread: thread(),
        init: { model: 'composer' },
        warm: true,
        slotBusy: true,
        agents: [],
        parent: null,
        children: [],
        prs: undefined,
        step: null,
        artifactCount: 2,
        machineName: 'BenBook',
        cwd: '/home/ben/omni-os/data/worktrees/t1',
        onOpen: () => {},
        onOpenThread: () => {},
        onJump: () => {},
      }),
    );
    expect(html).toContain('Thread quick actions');
    expect(html).toContain('BenBook');
    expect(html).toContain('omni/t1');
    expect(html).toContain('All details');
    expect(html).toContain('2 artifacts');
  });

  it('mutes branch rows on a thread with no branch', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadQuickCard, {
        thread: thread({ branch: null }),
        init: null,
        warm: undefined,
        slotBusy: false,
        agents: [],
        parent: null,
        children: [],
        prs: undefined,
        step: null,
        artifactCount: 0,
        machineName: undefined,
        cwd: '/w',
        onOpen: () => {},
        onOpenThread: () => {},
        onJump: () => {},
      }),
    );
    expect(html).toContain('No branch');
  });

  const base = {
    init: null,
    warm: true,
    slotBusy: true,
    prs: undefined,
    step: null,
    artifactCount: 0,
    machineName: 'BenBook',
    cwd: '/w',
    onOpen: () => {},
    onOpenThread: () => {},
    onJump: () => {},
  };

  it('leaves Actions and Changes out, and shows no lineage while nothing runs', () => {
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, thread: thread(), agents: [], parent: null, children: [] }));
    expect(html).not.toContain('Channel actions');
    expect(html).not.toContain('aria-label="Changes"');
    expect(html).not.toContain('Lineage');
  });

  it('draws the lineage at the bottom while agents run: parent, this thread, then what runs under it', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadQuickCard, {
        ...base,
        thread: thread({ title: 'Builder' }),
        parent: thread({ id: 'p', title: 'Conductor', status: 'running' }),
        children: [thread({ id: 'c1', title: 'Delegated fix', status: 'running' }), thread({ id: 'c2', title: 'Finished one', status: 'done' })],
        agents: [{ task_id: 'a1', thread_id: 't1', subagent: true, description: 'Find the cart code', subagent_type: 'Explore', started_at: '2026-10-28T09:00:00.000Z', event_id: 7 } as never],
      }),
    );
    expect(html).toContain('Lineage');
    expect(html).toContain('2 running');
    const order = ['All details', 'Conductor', 'Builder', 'Delegated fix', 'Find the cart code'].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('Finished one');
  });
});
