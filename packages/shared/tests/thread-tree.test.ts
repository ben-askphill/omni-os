import { describe, expect, it } from 'vitest';
import {
  buildTree,
  doneNeedsConfirm,
  FINISHED_SHOWN,
  keptChoice,
  NO_FLAGS,
  showsAgents,
  spansChannels,
  treeFlags,
  treeIndex,
  treeOpen,
  treePhase,
  treePrefKey,
  treeRows,
  treeTally,
  treeThreads,
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

  it('lists every thread under it at any depth in the order they were handed out, for the channel stack', () => {
    const nodes = buildTree('job', index, flags);
    expect(treeThreads(nodes).map((x) => x.id)).toEqual(['asks', 'broke', 'works', 'done', 'lead', 'm1', 'm2', 'm3', 'm4', 'm5']);
    expect(treeThreads([])).toEqual([]);
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

  it('keeps what Ben chose while the phase lasts, and forgets it when the job moves on, so the next run opens', () => {
    const closedWhileRunning: SavedOpen = { open: false, phase: 'running' };
    expect(treeOpen('running', keptChoice(closedWhileRunning, 'running'))).toBe(false);
    // It finished: the choice goes with the run it was made in, and the tree closes by itself.
    const afterFinish = keptChoice(closedWhileRunning, 'finished');
    expect(afterFinish).toBeNull();
    expect(treeOpen('finished', afterFinish)).toBe(false);
    // The job runs again: nothing saved holds it closed, so it opens by itself.
    expect(treeOpen('running', keptChoice(afterFinish, 'running'))).toBe(true);
    // The same the other way: opened by hand after it finished, it closes by itself after the next run.
    const openedAfter: SavedOpen = { open: true, phase: 'finished' };
    expect(treeOpen('finished', keptChoice(openedAfter, 'finished'))).toBe(true);
    expect(keptChoice(openedAfter, 'running')).toBeNull();
    expect(treeOpen('finished', keptChoice(keptChoice(openedAfter, 'running'), 'finished'))).toBe(false);
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

  it('keeps a failed thread as a row in a closed tree after Ben read it, until it is marked done', () => {
    // Read: Needs you no longer names it, but its status is still failed.
    const read = treeIndex([{ parent: { id: 'j' }, children: [t('ok', 'done'), t('bad', 'failed')] }]);
    const nodes = buildTree('j', read, NO_FLAGS);
    expect(nodes[0]).toMatchObject({ state: 'failed', flagged: true });
    expect(treeRows(nodes, false).rows.map((x) => x.thread.id)).toEqual(['bad']);
    // The tally and the Done question count it, so the closed tree shows it.
    expect(treeTally(nodes).failed).toBe(1);
    expect(doneNeedsConfirm(nodes)).toBe(true);
    // Marked done, it settles and folds away.
    const settled = buildTree('j', treeIndex([{ parent: { id: 'j' }, children: [t('ok', 'done'), t('bad', 'failed', { done_at: '2026-11-15T21:00:00Z' })] }]), NO_FLAGS);
    expect(treeRows(settled, false).rows).toEqual([]);
  });

  it('shows sub-agents only under a job at work', () => {
    expect(showsAgents({ status: 'done', delegating: true }, 'running')).toBe(true);
    expect(showsAgents({ status: 'running' }, 'finished')).toBe(false);
    // A thread on its own: while it works. A sub-agent a failed turn left behind does not count.
    expect(showsAgents({ status: 'running' })).toBe(true);
    expect(showsAgents({ status: 'failed' })).toBe(false);
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

describe("a finished job's row on the Inbox", () => {
  // The Conductor job from the Finished shelf: its turn ended, and so did all three threads it delegated.
  const finishedJob = t('finished-job', 'done', { channel_id: 'conductor' });
  const handedOut = [t('note', 'done'), t('facts', 'done'), t('card', 'done')];
  const source = treeIndex([{ parent: finishedJob, children: handedOut }]);
  const nodes = buildTree('finished-job', source, NO_FLAGS);
  const phase = treePhase(finishedJob, nodes);

  it('has a tree, and a thread that delegated nothing has none', () => {
    expect(nodes.map((x) => x.thread.id)).toEqual(['card', 'facts', 'note']);
    // No tree, no toggle: the row shows only its own line.
    expect(buildTree('plain', source, NO_FLAGS)).toEqual([]);
  });

  it('starts closed, with only the tally showing what sits under it', () => {
    expect(phase).toBe('finished');
    expect(treeOpen(phase, null)).toBe(false);
    expect(treeRows(nodes, false)).toMatchObject({ rows: [] });
    expect(treeTally(nodes)).toEqual({ needs: 0, failed: 0, running: 0, done: 3 });
  });

  it("opens on Ben's toggle to every thread under it, each with its done mark, and closes again", () => {
    const opened: SavedOpen = { open: true, phase };
    expect(treeOpen(phase, keptChoice(opened, phase))).toBe(true);
    const shown = treeRows(nodes, true);
    expect(shown.rows.map((x) => [x.thread.id, x.state])).toEqual([
      ['card', 'done'],
      ['facts', 'done'],
      ['note', 'done'],
    ]);
    expect(shown.more).toEqual([]);
    expect(treeOpen(phase, keptChoice({ open: false, phase }, phase))).toBe(false);
  });

  it('stays open while it is finished, and closes by itself after it runs again', () => {
    const opened: SavedOpen = { open: true, phase: 'finished' };
    // A reload or another render in the same phase keeps it open.
    expect(treeOpen('finished', keptChoice(opened, 'finished'))).toBe(true);
    // Ben sends it a follow-up: the next run opens on its own, then it finishes closed.
    const rerun = keptChoice(opened, 'running');
    expect(treeOpen('running', rerun)).toBe(true);
    expect(treeOpen('finished', keptChoice(rerun, 'finished'))).toBe(false);
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
