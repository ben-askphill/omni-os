import type { ChannelWithRunning, Thread, ThreadStub } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { channelSections, channelSubtitle, channelThreads, CONDUCTOR_SUBTITLE, needsByChannel, shortAgo, threadRow, threadSections } from '../src/live/channel-model';

const NOW = Date.parse('2026-11-02T12:00:00Z');

function channel(over: Partial<ChannelWithRunning> & { id: string }): ChannelWithRunning {
  return {
    name: over.id,
    kind: 'client',
    archived: 0,
    running: 0,
    ...over,
  } as unknown as ChannelWithRunning;
}

function stub(over: Partial<ThreadStub> & { id: string }): ThreadStub {
  return {
    title: over.id,
    status: 'done',
    channel_id: 'c',
    created_at: '2026-11-02T11:00:00Z',
    updated_at: '2026-11-02T11:00:00Z',
    folder_id: null,
    source: 'manual',
    ...over,
  } as ThreadStub;
}

describe('channelSections', () => {
  it('lifts the Conductor out and groups the rest in the phone web order', () => {
    const model = channelSections([
      channel({ id: 'personal-1', kind: 'personal' }),
      channel({ id: 'conductor', kind: 'system', running: 1 }),
      channel({ id: 'client-1', kind: 'client' }),
      channel({ id: 'internal-1', kind: 'internal', running: 2 }),
    ]);
    expect(model.conductor?.id).toBe('conductor');
    expect(model.groups.map((g) => g.label)).toEqual(['Clients', 'Internal', 'Personal']);
    expect(model.groups.map((g) => g.channels.map((c) => c.id))).toEqual([['client-1'], ['internal-1'], ['personal-1']]);
    expect(model.listedCount).toBe(3);
    expect(model.running).toBe(3);
  });

  it('leaves out archived channels and empty groups', () => {
    const model = channelSections([channel({ id: 'old', archived: 1 }), channel({ id: 'p', kind: 'personal' })]);
    expect(model.groups).toEqual([{ label: 'Personal', channels: [expect.objectContaining({ id: 'p' })] }]);
    expect(model.listedCount).toBe(1);
    expect(model.conductor).toBeUndefined();
  });
});

describe('shortAgo', () => {
  it('uses the shortest honest unit', () => {
    expect(shortAgo(new Date(NOW - 10_000).toISOString(), NOW)).toBe('now');
    expect(shortAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m');
    expect(shortAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h');
    expect(shortAgo(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d');
  });

  it('shows a date past a week and nothing for a bad timestamp', () => {
    expect(shortAgo(new Date(NOW - 30 * 86_400_000).toISOString(), NOW)).not.toMatch(/[hdm]$/);
    expect(shortAgo('not a date', NOW)).toBe('');
  });
});

describe('threadRow', () => {
  it('names only the states worth a word and marks busy threads', () => {
    expect(threadRow(stub({ id: 'a', status: 'running' }), NOW)).toMatchObject({ busy: true, statusLabel: 'Running' });
    expect(threadRow(stub({ id: 'b', status: 'queued' }), NOW)).toMatchObject({ busy: true, statusLabel: 'Queued' });
    expect(threadRow(stub({ id: 'c', status: 'done' }), NOW)).toMatchObject({ busy: false, statusLabel: null });
    expect(threadRow(stub({ id: 'd', status: 'failed' }), NOW)).toMatchObject({ statusLabel: 'Failed' });
  });

  it('falls back to Untitled for a blank title', () => {
    expect(threadRow(stub({ id: 'e', title: '  ' }), NOW).title).toBe('  ');
    expect(threadRow(stub({ id: 'f', title: '' }), NOW).title).toBe('Untitled');
  });
});

describe('channelThreads', () => {
  it('splits ungrouped threads into active and recent and leaves out team members', () => {
    const model = channelThreads(
      channel({
        id: 'c',
        active: [stub({ id: 'run', status: 'running' }), stub({ id: 'team', status: 'running', source: 'team' })],
        recent: [stub({ id: 'old', status: 'done' })],
      }),
      NOW,
    );
    expect(model.active.map((r) => r.id)).toEqual(['run']);
    expect(model.recent.map((r) => r.id)).toEqual(['old']);
    expect(model.folders).toEqual([]);
  });

  it('moves folder threads into their folder, once, and drops folders with nothing in them', () => {
    const model = channelThreads(
      channel({
        id: 'c',
        active: [stub({ id: 'in-folder', status: 'running', folder_id: 'f1' })],
        recent: [stub({ id: 'in-folder', status: 'running', folder_id: 'f1' }), stub({ id: 'loose' })],
        folders: [
          { id: 'f1', name: 'Launch', collapsed: 0, threads: [stub({ id: 'in-folder', status: 'running', folder_id: 'f1' }), stub({ id: 'done-in', status: 'done', folder_id: 'f1' })] },
          { id: 'f2', name: 'Empty', collapsed: 1, threads: [] },
        ] as unknown as ChannelWithRunning['folders'],
      }),
      NOW,
    );
    expect(model.folders.map((f) => f.name)).toEqual(['Launch']);
    expect(model.folders[0]?.active.map((r) => r.id)).toEqual(['in-folder']);
    expect(model.folders[0]?.recent.map((r) => r.id)).toEqual(['done-in']);
    expect(model.recent.map((r) => r.id)).toEqual(['loose']);
    expect(model.active).toEqual([]);
  });
});

describe('thread rows for the menu', () => {
  it('carries what the swipe actions and the long-press menu act on', () => {
    const row = threadRow(stub({ id: 'p', pinned_at: '2026-11-02T09:00:00Z', done_at: null, folder_id: 'f1' } as Partial<ThreadStub> & { id: string }), NOW);
    expect(row.pinned).toBe(true);
    expect(row.target).toMatchObject({ id: 'p', pinned: true, done: false, folderId: 'f1', archived: false });
  });

  it('is not pinned without a pin time', () => {
    expect(threadRow(stub({ id: 'q' }), NOW)).toMatchObject({ pinned: false, target: { pinned: false } });
  });
});

describe('folder counts', () => {
  const folders = [
    {
      id: 'f1',
      name: 'Launch',
      collapsed: 1,
      threads: [stub({ id: 'a', status: 'running', folder_id: 'f1' }), stub({ id: 'b', status: 'queued', folder_id: 'f1' }), stub({ id: 'c', folder_id: 'f1' })],
    },
  ] as unknown as ChannelWithRunning['folders'];

  it('counts every row and the busy ones, and reads collapsed from the server', () => {
    const [folder] = channelThreads(channel({ id: 'c', folders }), NOW).folders;
    expect(folder).toMatchObject({ id: 'f1', collapsed: true, count: 3, running: 2 });
  });

  it('keeps a closed folder as a header with no rows', () => {
    const sections = threadSections(channelThreads(channel({ id: 'c', recent: [stub({ id: 'loose' })], folders }), NOW));
    expect(sections.map((s) => [s.key, s.data.length])).toEqual([
      ['folder-f1', 0],
      ['recent', 1],
    ]);
    expect(sections[0]?.folder).toEqual({ id: 'f1', collapsed: true, count: 3, running: 2 });
  });

  it('lists an open folder busy rows first', () => {
    const open = folders!.map((f) => ({ ...f, collapsed: 0 }));
    const [section] = threadSections(channelThreads(channel({ id: 'c', folders: open }), NOW));
    expect(section?.data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('Conductor handoffs', () => {
  const parent = stub({ id: 'p', title: 'Plan the launch', status: 'done', source: 'conductor', channel_id: 'conductor' });
  const kid = (id: string, status: ThreadStub['status'], channel_id = 'web') => stub({ id, status, channel_id, title: `Task ${id}`, parent_id: 'p' } as Partial<ThreadStub> & { id: string });
  const conductor = (children: ThreadStub[], over: Partial<ChannelWithRunning> = {}) =>
    channel({ id: 'conductor', kind: 'system', recent: [parent, ...children], handoffs: [{ parent, children }], ...over });
  const names = (id: string) => (id === 'web' ? 'Web' : id);

  it('nests the delegated threads under their parent and drops them from the list', () => {
    const model = channelThreads(conductor([kid('k1', 'done'), kid('k2', 'done')]), NOW, names);
    expect(model.recent.map((r) => r.id)).toEqual(['p']);
    expect(model.recent[0]?.handoff).toEqual({
      running: 0,
      children: [
        { id: 'k1', title: 'Task k1', status: 'done', busy: false, channelId: 'web', channel: 'Web' },
        { id: 'k2', title: 'Task k2', status: 'done', busy: false, channelId: 'web', channel: 'Web' },
      ],
    });
  });

  it('promotes a finished parent to active while a child runs or waits', () => {
    const model = channelThreads(conductor([kid('k1', 'running'), kid('k2', 'queued'), kid('k3', 'done')]), NOW, names);
    expect(model.active.map((r) => r.id)).toEqual(['p']);
    expect(model.recent).toEqual([]);
    expect(model.active[0]?.handoff?.running).toBe(2);
  });

  it('does not list a parent twice when it is already active', () => {
    const busy = { ...parent, status: 'running' } as ThreadStub;
    const model = channelThreads(channel({ id: 'conductor', active: [busy], handoffs: [{ parent: busy, children: [kid('k1', 'running')] }] }), NOW);
    expect(model.active.map((r) => r.id)).toEqual(['p']);
  });

  it('restores a parent the lists no longer hold', () => {
    const model = channelThreads(channel({ id: 'conductor', handoffs: [{ parent, children: [kid('k1', 'running')] }] }), NOW);
    expect(model.active.map((r) => r.id)).toEqual(['p']);
  });

  it('leaves a parent in its folder when promoting it', () => {
    const inFolder = { ...parent, folder_id: 'f1' } as ThreadStub;
    const model = channelThreads(
      channel({
        id: 'conductor',
        folders: [{ id: 'f1', name: 'Plans', collapsed: 0, threads: [inFolder] }] as unknown as ChannelWithRunning['folders'],
        handoffs: [{ parent: inFolder, children: [kid('k1', 'running')] }],
      }),
      NOW,
    );
    expect(model.active).toEqual([]);
    expect(model.folders[0]).toMatchObject({ count: 1, running: 0 });
    expect(model.folders[0]?.active.map((r) => r.id)).toEqual(['p']);
  });

  it('names a child channel by id until the channel list has it', () => {
    const model = channelThreads(conductor([kid('k1', 'done', 'gone')]), NOW);
    expect(model.recent[0]?.handoff?.children[0]?.channel).toBe('gone');
  });

  it('ignores handoffs outside the Conductor and groups with no children', () => {
    const other = channel({ id: 'web', recent: [parent], handoffs: [{ parent, children: [kid('k1', 'running')] }] });
    expect(channelThreads(other, NOW).recent[0]?.handoff).toBeUndefined();
    expect(channelThreads(conductor([]), NOW, names).recent[0]?.handoff).toBeUndefined();
  });
});

describe('channelSubtitle', () => {
  it('uses the Conductor notes, then its role', () => {
    expect(channelSubtitle(channel({ id: 'conductor', notes: 'Runs the crew' }))).toBe('Runs the crew');
    expect(channelSubtitle(channel({ id: 'conductor', notes: null }))).toBe(CONDUCTOR_SUBTITLE);
  });

  it('prefers the store domain to the repo and shows nothing for a bare channel', () => {
    expect(channelSubtitle(channel({ id: 'a', store_domain: 'shop.test', github_repo: 'o/r' }))).toBe('shop.test');
    expect(channelSubtitle(channel({ id: 'b', github_repo: 'o/r' }))).toBe('o/r');
    expect(channelSubtitle(channel({ id: 'c' }))).toBeNull();
  });
});

describe('needsByChannel', () => {
  it('counts the threads waiting on Ben per channel', () => {
    let n = 0;
    const item = (channel_id: string) => ({ thread: stub({ id: `t${n++}`, channel_id }) as unknown as Thread, result: null, blockers: [], at: '' });
    const counts = needsByChannel({ items: [item('a'), item('b'), item('a')], unread: 0, blocked: 0 });
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBeUndefined();
    expect(needsByChannel(null).size).toBe(0);
  });
});
