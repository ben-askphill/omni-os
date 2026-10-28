import { describe, expect, it, vi } from 'vitest';

// Guard: the sidebar's lists are pure. They may not open data/omni.db.
vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by sidebar-lists tests');
});

import type { ThreadStub } from '../src/api.ts';
import { RECENT_THREADS, recentThreadGroups, recentThreads, runningThreadGroups, runningThreads } from '../src/sidebar-lists.ts';

const t = (id: string, over: Partial<ThreadStub> = {}): ThreadStub => ({
  id,
  channel_id: 'c',
  title: id,
  status: 'done',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});
const ids = (list: ThreadStub[]) => list.map((x) => x.id);

describe('runningThreads', () => {
  it('lists the busy threads of every channel, newest first', () => {
    const channels = [
      { active: [t('a', { status: 'running', created_at: '2026-10-02' })] },
      { active: [t('b', { status: 'queued', created_at: '2026-10-03' }), t('c', { status: 'running', created_at: '2026-10-01' })] },
      { active: [] },
    ];
    expect(ids(runningThreads(channels))).toEqual(['b', 'a', 'c']);
  });

  it('is empty when nothing runs, which hides the section', () => {
    expect(runningThreads([{ active: [] }, {}, { recent: [t('done')] }])).toEqual([]);
  });

  it('never takes a thread from the recent lists, only from what runs', () => {
    expect(ids(runningThreads([{ active: [t('run', { status: 'running' })], recent: [t('run'), t('old')] }]))).toEqual(['run']);
  });

  it('breaks a tie on start time by id, so the order holds between reloads', () => {
    const at = '2026-10-05T00:00:00.000Z';
    expect(ids(runningThreads([{ active: [t('y', { created_at: at }), t('x', { created_at: at })] }]))).toEqual(['x', 'y']);
  });

  it("shows the open thread's fresher copy without adding it", () => {
    const rows = runningThreads([{ active: [t('a', { status: 'running' })] }], t('a', { title: 'Renamed', status: 'running' }));
    expect(rows.map((x) => x.title)).toEqual(['Renamed']);
    expect(runningThreads([{ active: [] }], t('open', { status: 'running' }))).toEqual([]);
  });
});

describe('recentThreads', () => {
  it('takes the 5 latest by activity across channels, whatever their status', () => {
    const channels = [
      { recent: [t('a', { updated_at: '2026-10-09' }), t('b', { updated_at: '2026-10-03' }), t('c', { updated_at: '2026-10-01' })] },
      { recent: [t('d', { updated_at: '2026-10-08', status: 'running' }), t('e', { updated_at: '2026-10-06', status: 'failed' })] },
      { recent: [t('f', { updated_at: '2026-10-07' }), t('g', { updated_at: '2026-10-02' })] },
    ];
    expect(RECENT_THREADS).toBe(5);
    expect(ids(recentThreads(channels))).toEqual(['a', 'd', 'f', 'e', 'b']);
  });

  it('orders by last activity, not by when the thread started', () => {
    const channels = [{ recent: [t('old-but-busy', { created_at: '2026-09-01', updated_at: '2026-10-10' }), t('new-but-idle', { created_at: '2026-10-05', updated_at: '2026-10-05' })] }];
    expect(ids(recentThreads(channels))).toEqual(['old-but-busy', 'new-but-idle']);
  });

  it('breaks a tie on activity by the newer thread, then the lower id', () => {
    const at = '2026-10-05T00:00:00.000Z';
    const channels = [{ recent: [t('b', { updated_at: at }), t('a', { updated_at: at }), t('n', { updated_at: at, created_at: '2026-10-04' })] }];
    expect(ids(recentThreads(channels))).toEqual(['n', 'a', 'b']);
  });

  it('keeps running threads in, and lists a thread once', () => {
    const run = t('run', { status: 'running', updated_at: '2026-10-10' });
    expect(ids(recentThreads([{ active: [run], recent: [run, t('x')] }, { recent: [run] }]))).toEqual(['run', 'x']);
  });

  it('is empty only when there are no threads at all', () => {
    expect(recentThreads([])).toEqual([]);
    expect(recentThreads([{ recent: [] }, {}])).toEqual([]);
    expect(ids(recentThreads([{ recent: [t('one')] }]))).toEqual(['one']);
  });

  it('falls back to the start time for a stub from a server that sends no updated_at', () => {
    const channels = [{ recent: [t('a', { updated_at: undefined, created_at: '2026-10-01' }), t('b', { updated_at: undefined, created_at: '2026-10-02' })] }];
    expect(ids(recentThreads(channels))).toEqual(['b', 'a']);
  });

  it("shows the open thread's fresher copy in its own place", () => {
    const channels = [{ recent: [t('a', { updated_at: '2026-10-09' }), t('b', { updated_at: '2026-10-08' })] }];
    expect(recentThreads(channels, t('b', { title: 'Renamed', status: 'running' })).map((x) => [x.id, x.title, x.status])).toEqual([
      ['a', 'a', 'done'],
      ['b', 'Renamed', 'running'],
    ]);
  });
});

describe('Conductor handoff rows', () => {
  const parent = t('job', { channel_id: 'conductor', title: 'Plan Q4 launch', source: 'conductor' });
  const child = t('copy', { channel_id: 'marketing', title: 'Draft landing page', parent_id: 'job', source: 'conductor', status: 'running' });
  const group = { parent, children: [child] };

  it('keeps a running parent visible and nests its active child under it', () => {
    const rows = runningThreadGroups([{ id: 'conductor', active: [], handoffs: [group] }, { id: 'marketing', active: [child] }]);
    expect(rows.map((r) => [r.thread.id, r.children.map((c) => c.id)])).toEqual([['job', ['copy']]]);
  });

  it('uses a child activity to bring its parent into Recent threads', () => {
    const rows = recentThreadGroups([{ id: 'conductor', recent: [], handoffs: [group] }, { id: 'marketing', recent: [child] }]);
    expect(rows.map((r) => [r.thread.id, r.children.map((c) => c.id)])).toEqual([['job', ['copy']]]);
  });

  it('leaves non-Conductor child threads in their existing top-level rows', () => {
    const ordinary = t('ordinary-child', { parent_id: 'job', source: 'manual', status: 'running' });
    const rows = runningThreadGroups([{ id: 'conductor', active: [], handoffs: [group] }, { id: 'other', active: [ordinary] }]);
    expect(rows.map((r) => r.thread.id)).toEqual(['ordinary-child']);
  });
});
