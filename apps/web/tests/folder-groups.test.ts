import { describe, expect, it, vi } from 'vitest';

// Guard: the grouping is pure. It may not open data/omni.db.
vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by folder grouping tests');
});

import type { FolderWithThreads, ThreadStub } from '../src/api.ts';
import { folderOf, groupByFolder } from '../src/folder-groups.ts';
import { folderStep, reorderedIds } from '../src/folder-edits.ts';
import { containerItems } from '../src/components/ContextMenuParts.tsx';

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

describe('folderStep: Move up and Move down in the folder menu', () => {
  const list = [folder('a', 'Alpha', [], 0), folder('b', 'Beta', [], 1), folder('c', 'Gamma', [], 2)];

  it('puts the folder before the one above it, or before the one after the next, and names the one it passes', () => {
    expect(folderStep(list, 'b', -1)).toEqual({ beforeId: 'a', past: list[0] });
    expect(folderStep(list, 'a', 1)).toEqual({ beforeId: 'c', past: list[1] });
    // Down past the last but one: last of all.
    expect(folderStep(list, 'b', 1)).toEqual({ beforeId: null, past: list[2] });
  });

  it('reads the sidebar order, not the array order', () => {
    expect(folderStep([list[2], list[0], list[1]], 'c', -1)?.past.id).toBe('b');
  });

  it('is null at either end and for a stand-in not yet saved', () => {
    expect(folderStep(list, 'a', -1)).toBeNull();
    expect(folderStep(list, 'c', 1)).toBeNull();
    expect(folderStep([...list, folder('tmp-1', 'New', [], null)], 'c', 1)).toBeNull();
  });

  it('feeds reorderedIds the move the menu means', () => {
    const step = folderStep(list, 'c', -1)!;
    expect(reorderedIds(list, 'c', step.beforeId)).toEqual(['a', 'c', 'b']);
  });
});

describe("the folder menu's Move up and Move down", () => {
  const list = [folder('a', 'Alpha', [], 0), folder('b', 'Beta', [], 1)];
  const fake = (folders: FolderWithThreads[]) =>
    ({ find: (id: string) => folders.find((f) => f.id === id), inChannel: () => folders, move: vi.fn(async () => {}) }) as unknown as Parameters<typeof containerItems>[1] & { move: ReturnType<typeof vi.fn> };

  it('offers both, the one that cannot run saying why, and runs folders.move', () => {
    const folders = fake(list);
    const close = vi.fn();
    const items = containerItems({ kind: 'folder', id: 'a' }, folders, close);
    const up = items.find((it) => it.label === 'Move up')!;
    const down = items.find((it) => it.label === 'Move down')!;
    expect(up.off).toBe('Already the first folder');
    expect(down.off).toBeNull();
    down.run();
    expect(folders.move).toHaveBeenCalledWith('a', 1);
    expect(close).toHaveBeenCalled();
  });

  it('leaves them out of a channel with one folder', () => {
    const items = containerItems({ kind: 'folder', id: 'a' }, fake([list[0]]), () => {});
    expect(items.map((it) => it.label)).not.toContain('Move up');
  });
});
