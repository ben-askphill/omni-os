import type { ChannelWithRunning, HarnessUsage, NeedsYou, NeedsYouItem, PinnedThread, Thread, ThreadStub } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { activitySections, type ActivityInput } from '../src/live/activity-model';

// Local-time constructors, so the day boundary is the device's midnight in whatever zone the test runs.
const NOW = new Date(2026, 10, 2, 14, 0).getTime();
const local = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();
const EARLIER_TODAY = local(2026, 10, 2, 9, 0);

function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    channel_id: 'volero',
    title: id,
    status: 'done',
    role: null,
    source: 'manual',
    parent_id: null,
    archived: 0,
    last_text: null,
    created_at: EARLIER_TODAY,
    updated_at: EARLIER_TODAY,
    folder_id: null,
    ...over,
  } as Thread;
}

const stub = (id: string, over: Partial<ThreadStub> = {}): ThreadStub => thread(id, over);

function item(t: Thread, over: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return { thread: t, result: null, blockers: [], at: EARLIER_TODAY, ...over };
}

const inbox = (...items: NeedsYouItem[]): NeedsYou => ({ items, unread: 0, blocked: 0 });

function channel(id: string, over: Partial<ChannelWithRunning> = {}): ChannelWithRunning {
  return { id, name: id === 'volero' ? 'Volero' : id, kind: 'client', archived: 0, running: 0, ...over } as ChannelWithRunning;
}

function sections(over: Partial<ActivityInput> = {}) {
  return activitySections({ recent: [], needsYou: null, pinned: [], channels: [channel('volero')], usage: {}, now: NOW, ...over });
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const tree = (groups: { row: { id: string }; children: { id: string }[] }[]) => groups.map((g) => [g.row.id, ids(g.children)]);

describe('Needs you', () => {
  it('puts what waits on a decision before results to read, each in the inbox order', () => {
    const s = sections({
      needsYou: inbox(
        item(thread('read-1'), { result: { uid: 'r1', status: 'done', event_uid: null, at: EARLIER_TODAY } }),
        item(thread('ask'), { blockers: [{ kind: 'question', detail: 'Which branch?', count: 1 }] }),
        item(thread('read-2'), { result: { uid: 'r2', status: 'stopped', event_uid: null, at: EARLIER_TODAY } }),
        item(thread('broke'), { result: { uid: 'r3', status: 'failed', event_uid: null, at: EARLIER_TODAY } }),
      ),
    });
    expect(s.needs.map((n) => [n.id, n.glyph, n.label])).toEqual([
      ['ask', 'needs', 'Waiting on your answer'],
      ['broke', 'needs', 'Failed'],
      ['read-1', 'done', 'Finished'],
      ['read-2', 'settled', 'Stopped'],
    ]);
  });

  it('labels each blocker, counting questions and messages', () => {
    const blocked = (kind: NeedsYouItem['blockers'][number]['kind'], extra: Partial<NeedsYouItem['blockers'][number]> = {}) =>
      item(thread(kind, { last_text: '  last\n words ' }), { blockers: [{ kind, detail: 'why', count: 2, ...extra }] });
    const s = sections({
      needsYou: inbox(
        blocked('question'),
        blocked('setup'),
        blocked('uncertain'),
        blocked('recovered'),
        blocked('limited', { resets_at: local(2026, 10, 2, 17, 30), scheduled: true }),
      ),
    });
    expect(s.needs.map((n) => [n.kind, n.label, n.detail])).toEqual([
      ['question', '2 questions wait on your answer', 'why'],
      ['setup', 'Worktree could not be prepared', 'why'],
      ['uncertain', '2 messages may not have been sent', 'last words'],
      ['recovered', '2 messages wait for Resume', 'last words'],
      ['limited', 'Usage limit reached', 'Resumes at 17:30'],
    ]);
  });

  it('says when a limit resets tomorrow, on the other machine, or that it gave no time', () => {
    const limited = (id: string, extra: Partial<NeedsYouItem['blockers'][number]>) =>
      item(thread(id), { blockers: [{ kind: 'limited', detail: null, count: 1, ...extra }] });
    const s = sections({
      needsYou: inbox(limited('tomorrow', { resets_at: local(2026, 10, 3, 8, 5), elsewhere: true }), limited('unknown', { resets_at: null })),
    });
    expect(s.needs.map((n) => [n.label, n.detail])).toEqual([
      ['Usage limit reached on your other machine', 'Resets at tomorrow 08:05'],
      ['Usage limit reached', 'No reset time given'],
    ]);
  });

  it('heads each row with its channel, role and whether the Conductor sent it', () => {
    const s = sections({
      needsYou: inbox(item(thread('job', { role: 'builder', source: 'conductor' })), item(thread('plain', { channel_id: 'gone' }))),
    });
    expect(s.needs.map((n) => n.meta)).toEqual(['#Volero · builder · via Conductor', '#gone']);
  });

  it('gives each row the buttons phone web does, two at most', () => {
    const blocked = (kind: NeedsYouItem['blockers'][number]['kind'], over: Partial<Thread> = {}, count = 1) =>
      item(thread(kind, over), { blockers: [{ kind, detail: null, count }] });
    const labels = (i: NeedsYouItem) => sections({ needsYou: inbox(i) }).needs[0]!.buttons.map((b) => b.label);
    expect(labels(blocked('question'))).toEqual(['Answer', 'Mark done']);
    expect(labels(blocked('setup'))).toEqual(['Retry', 'Mark done']);
    expect(labels(blocked('recovered', {}, 3))).toEqual(['Resume 3', 'Mark done']);
    expect(labels(blocked('uncertain'))).toEqual(['Review', 'Mark done']);
    expect(labels(blocked('limited', { limit_state: 'limited', limit_resets_at: local(2026, 10, 2, 17, 30) } as Partial<Thread>))).toEqual(['Resume at reset', 'Resume now']);
    expect(labels(item(thread('r'), { result: { uid: 'u1', status: 'done', event_uid: null, at: EARLIER_TODAY } }))).toEqual(['Open', 'Mark read']);
  });

  it('offers no Mark done on a thread that is still running', () => {
    const running = item(thread('busy', { status: 'running' }), { blockers: [{ kind: 'question', detail: null, count: 1 }] });
    expect(sections({ needsYou: inbox(running) }).needs[0]!.buttons.map((b) => b.label)).toEqual(['Answer']);
  });
});

describe('Running and Done today', () => {
  it('lists what runs or waits for a slot, leaving out what Needs you shows, team members and archived threads', () => {
    const s = sections({
      recent: [
        thread('run', { status: 'running' }),
        thread('queue', { status: 'queued' }),
        thread('asks', { status: 'running' }),
        thread('member', { status: 'running', source: 'team' }),
        thread('shelved', { status: 'running', archived: 1 }),
      ],
      needsYou: inbox(item(thread('asks'), { blockers: [{ kind: 'question', detail: null, count: 1 }] })),
    });
    expect(tree(s.running)).toEqual([
      ['run', []],
      ['queue', []],
    ]);
    expect(s.running[0]?.row).toMatchObject({ channel: 'Volero', statusLabel: 'Running', busy: true });
  });

  it('lists what finished since local midnight, done, failed or stopped only', () => {
    const s = sections({
      recent: [
        thread('done', { status: 'done' }),
        thread('failed', { status: 'failed' }),
        thread('stopped', { status: 'stopped' }),
        thread('imported', { status: 'imported' }),
        thread('yesterday', { status: 'done', updated_at: local(2026, 10, 1, 23, 59) }),
        thread('midnight', { status: 'done', updated_at: local(2026, 10, 2, 0, 0) }),
        thread('team', { status: 'done', source: 'team' }),
      ],
    });
    expect(ids(s.doneToday)).toEqual(['done', 'failed', 'stopped', 'midnight']);
  });
});

describe('Conductor handoffs', () => {
  const job = stub('job', { channel_id: 'conductor', title: 'Plan launch', source: 'conductor', status: 'stopped' });
  const copy = stub('copy', { channel_id: 'volero', parent_id: 'job', source: 'conductor', status: 'running' });
  const done = stub('done-child', { channel_id: 'volero', parent_id: 'job', source: 'conductor', status: 'done' });
  const handoffs = [{ parent: job, children: [copy, done] }];

  it('nests a running child under its stopped parent, which it keeps visible, and counts both rows', () => {
    const s = sections({
      recent: [thread('copy', { status: 'running', parent_id: 'job', source: 'conductor' }), thread('solo', { status: 'running' })],
      channels: [
        channel('conductor', { handoffs, active: [] }),
        channel('volero', { active: [copy, stub('solo', { status: 'running' })] }),
      ],
    });
    expect(tree(s.running)).toEqual([
      ['job', ['copy']],
      ['solo', []],
    ]);
    expect(s.running[1]?.row.channel).toBe('Volero');
    expect(s.runningCount).toBe(3);
  });

  it("brings a job into Recent threads by its child's activity and shows every child, finished ones too", () => {
    const later = stub('copy', { ...copy, updated_at: local(2026, 10, 2, 13, 0) });
    const s = sections({
      channels: [
        channel('conductor', { handoffs: [{ parent: job, children: [later, done] }], recent: [] }),
        channel('volero', { recent: [later, stub('older', { updated_at: local(2026, 10, 2, 8, 0) })] }),
      ],
    });
    expect(tree(s.latest)).toEqual([
      ['job', ['copy', 'done-child']],
      ['older', []],
    ]);
    expect(s.latestCount).toBe(4);
  });

  it('lists the five latest threads across channels in Recent threads', () => {
    const at = (h: number) => local(2026, 10, 2, h, 0);
    const recent = [1, 2, 3, 4, 5, 6, 7].map((h) => stub(`t${h}`, { updated_at: at(h) }));
    const s = sections({ channels: [channel('volero', { recent: recent.slice(0, 4) }), channel('other', { recent: recent.slice(4) })] });
    expect(s.latest.map((g) => g.row.id)).toEqual(['t7', 't6', 't5', 't4', 't3']);
  });
});

describe('Pinned', () => {
  it('lists pins in the order given, with their channel', () => {
    const pins: PinnedThread[] = [{ ...stub('b'), pinned_at: EARLIER_TODAY }, { ...stub('a'), pinned_at: EARLIER_TODAY }];
    const s = sections({ pinned: pins });
    expect(s.pinned.map((r) => [r.id, r.channel])).toEqual([
      ['b', 'Volero'],
      ['a', 'Volero'],
    ]);
  });
});

describe('usage meters', () => {
  it("shows each harness's five-hour window over its month, as a fraction whether it came as a percent or not", () => {
    const usage: HarnessUsage = {
      'claude-code': { five_hour: { utilization: 42, resetsAt: 0 }, monthly: { utilization: 0.9, resetsAt: 0 } },
      cursor: { monthly: { utilization: 0.25, resetsAt: 0 } },
      codex: { five_hour: { utilization: 130, resetsAt: 0 } },
      hermes: null,
    };
    expect(sections({ usage }).usage).toEqual([
      { id: 'claude-code', name: 'Claude', fraction: 0.42, unit: '5h' },
      { id: 'codex', name: 'Codex', fraction: 1, unit: '5h' },
      { id: 'cursor', name: 'Cursor', fraction: 0.25, unit: 'mo' },
    ]);
  });

  it('is empty when no harness reports a window', () => {
    expect(sections({ usage: { 'claude-code': { status: 'ok' } } }).usage).toEqual([]);
  });
});

describe('headline', () => {
  it('names the day and counts what runs and what needs Ben, in the singular for one', () => {
    const s = sections({
      recent: [thread('run', { status: 'running' })],
      needsYou: inbox(item(thread('ask'), { blockers: [{ kind: 'question', detail: null, count: 1 }] })),
    });
    expect(s.headline).toBe('Monday 2 November · 1 running · 1 needs you');
    expect(s.nothingNeeded).toBe('Nothing waits on you. 1 thread is running.');
  });

  it('uses the plural for none and for many', () => {
    const s = sections({ recent: [thread('a', { status: 'running' }), thread('b', { status: 'queued' })] });
    expect(s.headline).toBe('Monday 2 November · 2 running · 0 need you');
    expect(s.nothingNeeded).toBe('Nothing waits on you. 2 threads are running.');
  });
});
