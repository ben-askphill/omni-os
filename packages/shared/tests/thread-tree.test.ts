import { describe, expect, it } from 'vitest';
import {
  buildTree,
  doneNeedsConfirm,
  FINISHED_SHOWN,
  spansChannels,
  treeFlags,
  treeIndex,
  treeOpen,
  treePhase,
  treePrefKey,
  treeRows,
  treeTally,
  unfinishedLabel,
  type SavedOpen,
  type TreeThread,
} from '../thread-tree.ts';

let n = 0;
const t = (id: string, status: string, extra: Partial<TreeThread> = {}): TreeThread => ({
  id, channel_id: 'omni-os', title: id, status, created_at: `2026-11-15T20:${String(10 + n++).padStart(2, '0')}:00Z`, ...extra,
});

const job = t('job', 'done', { channel_id: 'conductor', delegating: true });
const asks = t('asks', 'running');
const broke = t('broke', 'failed');
const works = t('works', 'running');
const done = t('done', 'done');
const lead = t('lead', 'done', { channel_id: 'volero', delegating: true });
const member = (id: string, status: string) => t(id, status, { channel_id: 'volero' });
const members = [member('m1', 'running'), member('m2', 'done'), member('m3', 'done'), member('m4', 'done'), member('m5', 'done')];

const index = treeIndex([
  { parent: job, children: [done, works, broke, asks, lead] },
  { parent: { id: 'lead' }, children: members },
]);
const flags = treeFlags([
  { thread: job, result: null, blockers: [{ kind: 'question', from: ['asks'] }, { kind: 'child_failed', from: ['broke'] }] },
  { thread: { id: 'broke' }, result: { status: 'failed' }, blockers: [] },
]);

describe('the tree under a job', () => {
  it('flags what waits on Ben and what failed, from the blockers that name them, and sorts those first', () => {
    const nodes = buildTree('job', index, flags);
    expect(nodes.map((x) => [x.thread.id, x.state, x.flagged])).toEqual([
      ['asks', 'needs', true],
      ['broke', 'failed', true],
      // The lead still works through its running member, though its own turn ended.
      ['lead', 'running', false],
      ['works', 'running', false],
      ['done', 'done', false],
    ]);
    // Team members sit under their lead, one level down.
    expect(nodes.find((x) => x.thread.id === 'lead')!.children.map((x) => x.thread.id)).toEqual(['m1', 'm5', 'm4', 'm3', 'm2']);
    expect(treeTally(nodes)).toEqual({ needs: 1, failed: 1, running: 2, done: 1 });
  });

  it('reads a thread marked done as done, whatever it waits on', () => {
    const nodes = buildTree('x', treeIndex([{ parent: { id: 'x' }, children: [{ ...asks, done_at: '2026-11-15T21:00:00Z' }] }]), flags);
    expect(nodes[0]).toMatchObject({ state: 'done', flagged: false });
  });

  it('stops at a thread it already passed', () => {
    const loop = treeIndex([{ parent: { id: 'a' }, children: [t('b', 'done')] }, { parent: { id: 'b' }, children: [t('a', 'done')] }]);
    expect(buildTree('a', loop).map((x) => x.children.length)).toEqual([0]);
  });
});

describe('opening and closing by itself', () => {
  const running = buildTree('job', index, flags);
  const finishedIndex = treeIndex([{ parent: { id: 'job2' }, children: [t('a', 'done'), t('b', 'failed')] }]);
  const finished = buildTree('job2', finishedIndex, { needs: new Set(), failed: new Set(['b']) });

  it('is open while anything under the job runs, and closed once all of it finished', () => {
    expect(treePhase({ status: 'done', delegating: true }, running)).toBe('running');
    expect(treePhase({ status: 'done' }, finished)).toBe('finished');
    // The job's own turn counts too.
    expect(treePhase({ status: 'running' }, finished)).toBe('running');
    expect(treeOpen('running', null)).toBe(true);
    expect(treeOpen('finished', null)).toBe(false);
  });

  it('keeps what Ben chose until the phase changes', () => {
    const closedWhileRunning: SavedOpen = { open: false, phase: 'running' };
    expect(treeOpen('running', closedWhileRunning)).toBe(false);
    expect(treeOpen('finished', closedWhileRunning)).toBe(false);
    const openedAfter: SavedOpen = { open: true, phase: 'finished' };
    expect(treeOpen('finished', openedAfter)).toBe(true);
    // The job runs again: it opens by itself, and finishing again closes it.
    expect(treeOpen('running', openedAfter)).toBe(true);
    expect(treeOpen('finished', { open: true, phase: 'running' })).toBe(false);
  });

  it('keeps a failed or waiting row showing while closed, behind it the rest', () => {
    const closed = treeRows(running, false);
    expect(closed.rows.map((x) => x.thread.id)).toEqual(['asks', 'broke']);
    expect(closed.more.map((x) => x.thread.id)).toEqual(['lead', 'works', 'done']);
    expect(treeRows(finished, false).rows.map((x) => x.thread.id)).toEqual(['b']);
    // A member that failed keeps its lead's row in a closed tree.
    const deep = treeIndex([{ parent: { id: 'j' }, children: [t('l', 'done')] }, { parent: { id: 'l' }, children: [t('m', 'failed'), t('k', 'done')] }]);
    const nodes = buildTree('j', deep, { needs: new Set(), failed: new Set(['m']) });
    expect(treeRows(nodes, false).rows.map((x) => x.thread.id)).toEqual(['l']);
    expect(treeRows(nodes[0].children, false).rows.map((x) => x.thread.id)).toEqual(['m']);
  });

  it('folds finished rows past the first few into "n more done" while open', () => {
    const many = treeIndex([{ parent: { id: 'big' }, children: Array.from({ length: 6 }, (_, i) => t(`d${i}`, 'done')).concat(t('r', 'running')) }]);
    const nodes = buildTree('big', many);
    const open = treeRows(nodes, true);
    expect(open.rows).toHaveLength(1 + FINISHED_SHOWN);
    expect(open.rows[0].thread.id).toBe('r');
    expect(open.more).toHaveLength(6 - FINISHED_SHOWN);
    expect(treeRows(nodes, true, true).more).toEqual([]);
  });

  it('keeps each view\'s choice apart', () => {
    expect(treePrefKey('sidebar', 'job')).not.toBe(treePrefKey('inbox', 'job'));
    const store = new Map<string, SavedOpen>();
    store.set(treePrefKey('sidebar', 'job'), { open: false, phase: 'running' });
    expect(treeOpen('running', store.get(treePrefKey('sidebar', 'job')))).toBe(false);
    expect(treeOpen('running', store.get(treePrefKey('inbox', 'job')))).toBe(true);
  });
});

describe('marking the job done', () => {
  it('asks first while anything under it runs, failed or waits on Ben', () => {
    expect(doneNeedsConfirm(buildTree('job', index, flags))).toBe(true);
    expect(unfinishedLabel(buildTree('job', index, flags))).toBe('3 still run, 1 waits on you, 1 failed');
    const failedOnly = treeIndex([{ parent: { id: 'j' }, children: [t('a', 'done'), t('b', 'failed')] }]);
    expect(doneNeedsConfirm(buildTree('j', failedOnly))).toBe(true);
  });

  it('is one click once everything under it finished', () => {
    const settled = treeIndex([{ parent: { id: 'j' }, children: [t('a', 'done'), t('b', 'done'), t('c', 'failed', { done_at: '2026-11-15T21:00:00Z' })] }]);
    expect(doneNeedsConfirm(buildTree('j', settled))).toBe(false);
    expect(doneNeedsConfirm([])).toBe(false);
  });
});

describe('row meta', () => {
  it('shows channels only when a job spans more than one', () => {
    expect(spansChannels(buildTree('job', index, flags))).toBe(true);
    expect(spansChannels(buildTree('lead', index, flags))).toBe(false);
  });
});
