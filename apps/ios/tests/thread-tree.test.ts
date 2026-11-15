import type { ChannelWithRunning, NeedsYou, NeedsYouItem, Thread, ThreadStub } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { agentsByThread, doneQuestion, jobTree, tallyLabel, tallyOf, treeIsOpen, treePhases, treeSource } from '../src/live/thread-tree';

const T = '2026-11-15T20:00:00.000Z';
const stub = (id: string, over: Partial<ThreadStub> = {}): ThreadStub =>
  ({ id, channel_id: 'volero', title: id, status: 'done', created_at: T, updated_at: T, folder_id: null, harness: 'claude-code', pinned_at: null, done_at: null, parent_id: null, source: 'conductor', limit_state: null, ...over }) as ThreadStub;
const conductor = (parent: ThreadStub, children: ThreadStub[]): ChannelWithRunning =>
  ({ id: 'conductor', name: 'Conductor', kind: 'system', archived: 0, running: 0, handoffs: [{ parent, children }] }) as ChannelWithRunning;
const needs = (...items: NeedsYouItem[]): NeedsYou => ({ items, unread: 0, blocked: 0 });
const item = (id: string, over: Partial<NeedsYouItem> = {}): NeedsYouItem => ({ thread: { id } as Thread, result: null, blockers: [], at: T, ...over });

describe('the thread tree on Activity', () => {
  it('opens while the job runs and closes once it finished, unless Ben chose otherwise in this phase', () => {
    const job = stub('job', { channel_id: 'conductor' });
    const running = jobTree(job, treeSource([conductor(job, [stub('a', { status: 'running' })])], null))!;
    expect(running.phase).toBe('running');
    expect(treeIsOpen(running, null)).toBe(true);
    expect(treeIsOpen(running, { open: false, phase: 'running' })).toBe(false);
    // A choice made while it ran ends when it finishes.
    const finished = jobTree(job, treeSource([conductor(job, [stub('a')])], null))!;
    expect(treeIsOpen(finished, null)).toBe(false);
    expect(treeIsOpen(finished, { open: false, phase: 'running' })).toBe(false);
    expect(treeIsOpen(finished, { open: true, phase: 'finished' })).toBe(true);
  });

  it('names each parent its phase, for dropping choices made in the other one', () => {
    const job = stub('job', { channel_id: 'conductor' });
    const list = [conductor(job, [stub('a', { status: 'queued' })])];
    expect([...treePhases(list, treeSource(list, null))]).toEqual([['job', 'running']]);
  });

  it('says the tally in words, and tallies the rows behind "n more"', () => {
    const job = stub('job', { channel_id: 'conductor' });
    const tree = jobTree(job, treeSource([conductor(job, [stub('a', { status: 'running' }), stub('b'), stub('c', { status: 'failed' })])], null))!;
    expect(tallyLabel(tree.tally)).toBe('1 failed, 1 running, 1 done');
    expect(tallyOf(tree.nodes)).toEqual({ needs: 0, failed: 1, running: 1, done: 1 });
    expect(tree.spans).toBe(false);
  });

  it('counts sub-agents by thread and leaves background shells out', () => {
    const k = (thread_id: string, subagent: boolean) => ({ thread_id, channel_id: 'c', task_id: `${thread_id}${subagent}`, description: '', subagent, background: true, started_at: T });
    expect([...agentsByThread([k('a', true), k('a', false), k('b', true)])]).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });
});

describe('the Done question', () => {
  const job = stub('job', { channel_id: 'conductor', title: 'Ship the tree' });

  it('asks while a thread under the job runs, failed or waits on Ben, naming the job and what is unfinished', () => {
    const list = [conductor(job, [stub('a', { status: 'running' }), stub('b', { status: 'failed' }), stub('c')])];
    const q = doneQuestion({ id: 'job', title: '' }, list, needs(item('job', { blockers: [{ kind: 'question', detail: null, count: 1, from: ['c'] }] })));
    expect(q?.title).toBe('Mark as done?');
    expect(q?.message).toBe('Under Ship the tree, 1 still runs, 1 waits on you, 1 failed. Done takes it out of Activity and Needs you until something new happens in it.');
  });

  it('does not ask once everything under the job finished, or for a thread with nothing under it', () => {
    expect(doneQuestion(job, [conductor(job, [stub('a'), stub('b', { status: 'failed', done_at: T })])], null)).toBeNull();
    expect(doneQuestion(stub('solo'), [conductor(job, [stub('a', { status: 'running' })])], null)).toBeNull();
  });
});
