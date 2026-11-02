import { describe, expect, it } from 'vitest';

import { canMarkDone, folderChoices, organizeItems, targetOfStub, targetOfThread } from '../../src/thread/target';
import { stub, thread } from './fixtures';

describe('thread target', () => {
  it('reads the same facts from the whole thread and from a list stub', () => {
    const row = { pinned_at: '2026-11-02T09:00:00Z', done_at: '2026-11-02T09:30:00Z', folder_id: 'f1', parent_id: 'p1' };
    expect(targetOfThread(thread(row))).toEqual({ ...targetOfStub(stub(row)), archived: false });
    expect(targetOfThread(thread(row))).toMatchObject({ pinned: true, done: true, folderId: 'f1', child: true });
  });

  it('reads archived from the thread only: the channel list leaves archived threads out', () => {
    expect(targetOfThread(thread({ archived: 1 })).archived).toBe(true);
    expect(targetOfStub(stub()).archived).toBe(false);
  });

  it('cannot mark a running or queued thread done', () => {
    expect(canMarkDone('running')).toBe(false);
    expect(canMarkDone('queued')).toBe(false);
    expect(canMarkDone('done')).toBe(true);
    expect(canMarkDone('failed')).toBe(true);
  });
});

describe('organize items', () => {
  const ids = (t: Parameters<typeof organizeItems>[0]) => organizeItems(t).map((i) => i.id);

  it('lists pin, done, rename, move and archive for a settled thread', () => {
    expect(ids(targetOfThread(thread()))).toEqual(['pin', 'done', 'rename', 'move', 'archive']);
  });

  it('labels each action for the state the thread is in', () => {
    const labels = organizeItems(targetOfThread(thread({ pinned_at: 'x', done_at: 'y' }))).map((i) => i.label);
    expect(labels).toEqual(['Unpin thread', 'Mark as not done', 'Rename thread', 'Move to folder', 'Archive thread']);
  });

  it('leaves Mark as done out while a turn runs', () => {
    expect(ids(targetOfThread(thread({ status: 'running' })))).toEqual(['pin', 'rename', 'move', 'archive']);
  });

  it('offers a thread that is already done the way back even if it runs again', () => {
    expect(ids(targetOfThread(thread({ status: 'running', done_at: 'y' })))).toContain('done');
  });

  it('keeps a child thread out of folders', () => {
    expect(ids(targetOfThread(thread({ parent_id: 'p' })))).not.toContain('move');
  });
});

describe('folder choices', () => {
  const folders = [
    { id: 'a', parent_id: null, name: 'Alpha' },
    { id: 'a1', parent_id: 'a', name: 'Alpha child' },
    { id: 'b', parent_id: null, name: 'Beta' },
  ];

  it('starts with No folder and walks the tree, children under their parent', () => {
    expect(folderChoices(folders, null).map((c) => [c.name, c.depth])).toEqual([
      ['No folder', 0],
      ['Alpha', 0],
      ['Alpha child', 1],
      ['Beta', 0],
    ]);
  });

  it('marks the folder the thread is in, or No folder', () => {
    expect(folderChoices(folders, 'a1').filter((c) => c.current).map((c) => c.id)).toEqual(['a1']);
    expect(folderChoices(folders, null).filter((c) => c.current).map((c) => c.id)).toEqual([null]);
  });

  it('offers only No folder when the channel has none', () => {
    expect(folderChoices([], null)).toEqual([{ id: null, name: 'No folder', depth: 0, current: true }]);
  });

  it('lists a folder whose parent is missing at the top level', () => {
    expect(folderChoices([{ id: 'x', parent_id: 'gone', name: 'Orphan' }], null).map((c) => [c.name, c.depth])).toEqual([
      ['No folder', 0],
      ['Orphan', 0],
    ]);
  });
});
