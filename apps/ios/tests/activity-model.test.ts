import type { ChannelWithRunning, NeedsYou, NeedsYouItem, Thread, ThreadStub } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { activityInbox, type ActivityInput } from '../src/live/activity-model';

const NOW = new Date(2026, 10, 7, 14, 0).getTime();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function thread(id: string, over: Partial<Thread> & { delegating?: boolean } = {}): Thread {
  return {
    id,
    channel_id: 'volero',
    title: id,
    status: 'done',
    role: null,
    branch: null,
    source: 'manual',
    parent_id: null,
    archived: 0,
    last_text: null,
    pinned_at: null,
    done_at: null,
    created_at: at(120),
    updated_at: at(60),
    folder_id: null,
    ...over,
  } as Thread;
}

/** Only the fields the channel and pinned lists send, so a stub never overrides a full row's branch or role. */
function stub(id: string, over: Partial<ThreadStub> = {}): ThreadStub {
  const { channel_id, title, status, created_at, updated_at, folder_id, harness, pinned_at, done_at, parent_id, source } = thread(id, over);
  return { id, channel_id, title, status, created_at, updated_at, folder_id, harness, pinned_at, done_at, parent_id, source };
}

function item(t: Thread, over: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return { thread: t, result: null, blockers: [], at: t.updated_at, ...over };
}

const needs = (...items: NeedsYouItem[]): NeedsYou => ({ items, unread: 0, blocked: 0 });
const result = (status: 'done' | 'failed' | 'stopped') => ({ uid: `r-${status}`, status, event_uid: null, at: at(5) });

function channel(id: string, over: Partial<ChannelWithRunning> = {}): ChannelWithRunning {
  return { id, name: id === 'volero' ? 'Volero' : id, kind: 'client', archived: 0, running: 0, ...over } as ChannelWithRunning;
}

function inbox(over: Partial<ActivityInput> = {}) {
  return activityInbox({ recent: [], needsYou: null, pinned: [], channels: [channel('volero')], now: NOW, ...over });
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('the Activity inbox', () => {
  it('puts each thread on one shelf: done, pinned, working, else waiting, pinned first', () => {
    const a = inbox({
      recent: [
        thread('finished'),
        thread('busy', { status: 'running' }),
        thread('queued', { status: 'queued' }),
        thread('marked', { done_at: at(1) }),
        thread('pin', { pinned_at: at(2), status: 'running' }),
      ],
    });
    expect(ids(a.waiting)).toEqual(['pin', 'finished']);
    expect(a.waiting[0]?.pinned).toBe(true);
    expect(ids(a.working)).toEqual(['busy', 'queued']);
    expect(ids(a.done)).toEqual(['marked']);
  });

  it('leaves out archived threads, team members and delegated threads', () => {
    const conductor = channel('conductor', { handoffs: [{ parent: stub('job'), children: [stub('crew')] }] });
    const a = inbox({
      recent: [thread('job', { channel_id: 'conductor' }), thread('crew'), thread('gone', { archived: 1 }), thread('member', { source: 'team' })],
      channels: [channel('volero'), conductor],
    });
    expect(ids(a.waiting)).toEqual(['job']);
  });

  it('sorts waiting threads by when each came back, from Needs you when it knows', () => {
    const old = thread('old', { updated_at: at(300) });
    const a = inbox({
      recent: [thread('newer', { updated_at: at(30) }), old],
      needsYou: needs(item(old, { at: at(1), result: result('done') })),
    });
    expect(ids(a.waiting)).toEqual(['old', 'newer']);
  });

  it('keeps a running thread that asked a question waiting, labelled Input', () => {
    const ask = thread('ask', { status: 'running' });
    const a = inbox({ recent: [ask], needsYou: needs(item(ask, { blockers: [{ kind: 'question', detail: null, count: 1 }] })) });
    expect(ids(a.working)).toEqual([]);
    expect(a.waiting[0]?.status).toEqual({ glyph: 'needs', label: 'Input' });
    expect(a.mark).toBe('attention');
  });

  it('labels a row by its blocker, then its work, then its unread result, else shows the time', () => {
    const rows = (t: Thread, n?: NeedsYouItem) => inbox({ recent: [t], needsYou: needs(...(n ? [n] : [])) });
    const failed = thread('f', { status: 'failed' });
    expect(rows(failed, item(failed, { result: result('failed') })).waiting[0]?.status).toEqual({ glyph: 'needs', label: 'Failed' });
    const done = thread('d');
    expect(rows(done, item(done, { result: result('done') })).waiting[0]?.status).toEqual({ glyph: 'done', label: 'Finished' });
    const quiet = rows(thread('q', { updated_at: at(180) })).waiting[0];
    expect(quiet?.status).toBeNull();
    expect(quiet?.time).toBe('3h');
    expect(quiet?.glyph).toBe('done');
    const busy = rows(thread('b', { status: 'running' })).working[0];
    expect(busy).toMatchObject({ status: { glyph: 'running', label: 'Working' }, receded: true, canMarkDone: false });
  });

  it('keeps a Conductor job in Working while a thread it delegated works, and counts its delegates', () => {
    const crew = stub('crew', { status: 'running' });
    const conductor = channel('conductor', { handoffs: [{ parent: stub('job'), children: [crew] }] });
    const a = inbox({ recent: [thread('job', { channel_id: 'conductor', delegating: true })], channels: [conductor], needsYou: needs() });
    expect(ids(a.working)).toEqual(['job']);
    expect(a.working[0]?.delegates).toMatchObject({ total: 1, active: 1, state: 'working' });
    expect(a.mark).toBe('delegating');
  });

  it('lists a thread once from every source, the later copy winning', () => {
    const a = inbox({
      recent: [thread('t', { status: 'done', branch: 'omni/t' })],
      channels: [channel('volero', { active: [stub('t', { status: 'running' })] })],
    });
    expect(ids(a.working)).toEqual(['t']);
    expect(a.working[0]?.branch).toBe('omni/t');
  });

  it('sorts done threads by when they were marked done, newest first, timed from then', () => {
    const a = inbox({ recent: [thread('earlier', { done_at: at(90) }), thread('latest', { done_at: at(2) })] });
    expect(a.done.map((r) => [r.id, r.time])).toEqual([
      ['latest', '2m'],
      ['earlier', '2h'],
    ]);
  });

  it('heads the screen with the day and the counts, and says when it has loaded', () => {
    expect(inbox({ recent: null }).loaded).toBe(false);
    const a = inbox({ recent: [thread('w'), thread('r', { status: 'running' })] });
    expect(a.loaded).toBe(true);
    expect(a.subtitle).toBe('Saturday 7 November · 1 waiting · 1 working');
    expect(a.waiting[0]).toMatchObject({ channel: 'Volero', canMarkDone: true });
  });
});
