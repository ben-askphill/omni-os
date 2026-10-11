import { describe, expect, it, vi } from 'vitest';

// Guard: the grouping is pure. It may not open data/omni.db.
vi.mock('../server/db.ts', () => {
  throw new Error('db.ts must not be imported by folder grouping tests');
});

import type { FolderWithThreads, ThreadStub } from '../web/src/api.ts';
import { folderOf, groupByFolder } from '../web/src/folder-groups.ts';

const at = '2026-10-10T00:00:00.000Z';
const folder = (id: string, name: string, threads: ThreadStub[] = [], position: number | null = null): FolderWithThreads => ({
  id, channel_id: 'c', parent_id: null, name, position, collapsed: 0, created_at: at, updated_at: at,
  count: threads.length, running: 0, threads,
});
const thread = (id: string, folder_id: string | null = null) => ({ id, channel_id: 'c', title: id, status: 'done' as const, created_at: at, folder_id });

describe('folderOf', () => {
  it("takes a folder's listed threads first, then the channel's stubs, then the thread's own folder_id", () => {
    const a = folder('a', 'A', [thread('t1', 'a')]);
    const b = folder('b', 'B');
    // Moved into A by the sidebar: the overview's copy still says B until the feed catches up.
    expect(folderOf({ folders: [a, b] }, thread('t1', 'b'))).toBe('a');
    // Taken out of B: the stub says so before the overview's copy does.
    expect(folderOf({ folders: [a, b], recent: [thread('t2', null)] }, thread('t2', 'b'))).toBeNull();
    // Past the folder's listed threads: its own folder_id.
    expect(folderOf({ folders: [a, b] }, thread('t3', 'b'))).toBe('b');
  });

  it('puts a thread whose folder is gone back in the ungrouped list', () => {
    expect(folderOf({ folders: [folder('a', 'A')] }, thread('t1', 'deleted'))).toBeNull();
    expect(folderOf({}, thread('t1', 'a'))).toBeNull();
  });
});

describe('groupByFolder', () => {
  it("keeps the sidebar's folder order, empty folders included, and the threads' own order in each", () => {
    const folders = [folder('z', 'Zeta', [], 0), folder('a', 'Alpha', [], 1), folder('e', 'Empty', [], 2)];
    const list = [thread('t1', 'a'), thread('t2'), thread('t3', 'z'), thread('t4', 'a'), thread('t5')];
    const g = groupByFolder(list, { folders });
    expect(g.folders.map((x) => [x.folder.name, x.threads.map((t) => t.id)])).toEqual([
      ['Zeta', ['t3']],
      ['Alpha', ['t1', 't4']],
      ['Empty', []],
    ]);
    expect(g.unfiled.map((t) => t.id)).toEqual(['t2', 't5']);
  });

  it('puts every thread in exactly one group', () => {
    const folders = [folder('a', 'A', [thread('t1', 'a')]), folder('b', 'B')];
    const list = [thread('t1', null), thread('t2', 'b'), thread('t3', 'gone'), thread('t4')];
    const g = groupByFolder(list, { folders, recent: [thread('t2', null)] });
    const ids = [...g.folders.flatMap((x) => x.threads), ...g.unfiled].map((t) => t.id).sort();
    expect(ids).toEqual(['t1', 't2', 't3', 't4']);
    expect(g.folders[0]!.threads.map((t) => t.id)).toEqual(['t1']);
    expect(g.folders[1]!.threads).toEqual([]);
    expect(g.unfiled.map((t) => t.id)).toEqual(['t2', 't3', 't4']);
  });

  it('is all ungrouped when the channel has no folders', () => {
    const g = groupByFolder([thread('t1'), thread('t2', 'x')], { folders: [] });
    expect(g.folders).toEqual([]);
    expect(g.unfiled.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});
