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
        channel: { id: 'omni', name: 'omni-os' } as never,
        init: { model: 'composer' },
        warm: true,
        slotBusy: true,
        agents: [],
        prs: undefined,
        changes: { files: [{}, {}], add: 3, del: 1 },
        step: null,
        artifactCount: 2,
        machineName: 'BenBook',
        cwd: '/home/ben/omni-os/data/worktrees/t1',
        onOpen: () => {},
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
        channel: undefined,
        init: null,
        warm: undefined,
        slotBusy: false,
        agents: [],
        prs: undefined,
        changes: null,
        step: null,
        artifactCount: 0,
        machineName: undefined,
        cwd: '/w',
        onOpen: () => {},
      }),
    );
    expect(html).toContain('No branch');
  });
});
