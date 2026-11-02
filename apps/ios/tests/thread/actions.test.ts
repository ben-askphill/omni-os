import { describe, expect, it, vi } from 'vitest';

import { changedMessage, normalizeTitle, runThreadAction, type ThreadActionApi } from '../../src/thread/actions';
import { targetOfThread } from '../../src/thread/target';
import { thread } from './fixtures';

function fakeApi(over: Partial<ThreadActionApi> = {}) {
  const api = {
    setPinned: vi.fn(async (id: string, pinned: boolean) => thread({ id, pinned_at: pinned ? 'now' : null })),
    setDone: vi.fn(async (id: string, done: boolean) => thread({ id, done_at: done ? 'now' : null })),
    rename: vi.fn(async (id: string, title: string) => thread({ id, title })),
    setArchived: vi.fn(async (id: string, archived: boolean) => thread({ id, archived: archived ? 1 : 0 })),
    moveToFolder: vi.fn(async (id: string, folderId: string | null) => thread({ id, folder_id: folderId })),
    ...over,
  };
  return api as typeof api & ThreadActionApi;
}

describe('thread actions', () => {
  it('pins an unpinned thread and unpins a pinned one', async () => {
    const api = fakeApi();
    const out = await runThreadAction(api, targetOfThread(thread()), { kind: 'pin' }, targetOfThread);
    expect(api.setPinned).toHaveBeenCalledWith('t1', true);
    expect(out).toMatchObject({ kind: 'changed', message: 'Pinned' });

    const back = await runThreadAction(api, targetOfThread(thread({ pinned_at: 'x' })), { kind: 'pin' }, targetOfThread);
    expect(api.setPinned).toHaveBeenLastCalledWith('t1', false);
    expect(back).toMatchObject({ kind: 'changed', message: 'Unpinned' });
  });

  it('marks a thread done and back', async () => {
    const api = fakeApi();
    expect(await runThreadAction(api, targetOfThread(thread()), { kind: 'done' }, targetOfThread)).toMatchObject({ message: 'Marked done' });
    expect(api.setDone).toHaveBeenLastCalledWith('t1', true);
    expect(await runThreadAction(api, targetOfThread(thread({ done_at: 'x' })), { kind: 'done' }, targetOfThread)).toMatchObject({
      message: 'Back in Needs you',
    });
    expect(api.setDone).toHaveBeenLastCalledWith('t1', false);
  });

  it('archives and unarchives', async () => {
    const api = fakeApi();
    expect(await runThreadAction(api, targetOfThread(thread()), { kind: 'archive' }, targetOfThread)).toMatchObject({ message: 'Archived. Search still finds it.' });
    expect(api.setArchived).toHaveBeenLastCalledWith('t1', true);
    await runThreadAction(api, targetOfThread(thread({ archived: 1 })), { kind: 'archive' }, targetOfThread);
    expect(api.setArchived).toHaveBeenLastCalledWith('t1', false);
  });

  it('renames with the title as one trimmed line', async () => {
    const api = fakeApi();
    const out = await runThreadAction(api, targetOfThread(thread()), { kind: 'rename', title: '  Ship   the\nbuild ' }, targetOfThread);
    expect(api.rename).toHaveBeenCalledWith('t1', 'Ship the build');
    expect(out).toMatchObject({ kind: 'changed', message: 'Renamed' });
  });

  it('sends nothing for a rename to a blank or the same title', async () => {
    const api = fakeApi();
    expect(await runThreadAction(api, targetOfThread(thread()), { kind: 'rename', title: '   ' }, targetOfThread)).toEqual({ kind: 'unchanged' });
    expect(await runThreadAction(api, targetOfThread(thread()), { kind: 'rename', title: ' Fix the  build ' }, targetOfThread)).toEqual({ kind: 'unchanged' });
    expect(api.rename).not.toHaveBeenCalled();
  });

  it('moves into a folder and out of one', async () => {
    const api = fakeApi();
    const into = await runThreadAction(api, targetOfThread(thread()), { kind: 'move', folderId: 'f1' }, targetOfThread);
    expect(api.moveToFolder).toHaveBeenCalledWith('t1', 'f1');
    expect(into).toMatchObject({ kind: 'changed', message: 'Moved to folder' });
    const out = await runThreadAction(api, targetOfThread(thread({ folder_id: 'f1' })), { kind: 'move', folderId: null }, targetOfThread);
    expect(api.moveToFolder).toHaveBeenLastCalledWith('t1', null);
    expect(out).toMatchObject({ message: 'Moved out of its folder' });
  });

  it('sends nothing for a move to the folder the thread is already in', async () => {
    const api = fakeApi();
    expect(await runThreadAction(api, targetOfThread(thread({ folder_id: 'f1' })), { kind: 'move', folderId: 'f1' }, targetOfThread)).toEqual({ kind: 'unchanged' });
    expect(api.moveToFolder).not.toHaveBeenCalled();
  });

  it("returns the changed thread so the open view takes the server's row", async () => {
    const out = await runThreadAction(fakeApi(), targetOfThread(thread()), { kind: 'pin' }, targetOfThread);
    expect(out.kind === 'changed' && out.thread.pinned_at).toBe('now');
  });

  it("fails with the server's words and changes nothing", async () => {
    const api = fakeApi({ setDone: vi.fn(async () => Promise.reject(new Error('A running thread cannot be marked done'))) });
    expect(await runThreadAction(api, targetOfThread(thread()), { kind: 'done' }, targetOfThread)).toEqual({
      kind: 'failed',
      error: 'A running thread cannot be marked done',
    });
  });

  it('falls back to a plain message when the error has none', async () => {
    const api = fakeApi({ setPinned: vi.fn(async () => Promise.reject(new Error(''))) });
    expect(await runThreadAction(api, targetOfThread(thread()), { kind: 'pin' }, targetOfThread)).toEqual({ kind: 'failed', error: 'Something went wrong' });
  });
});

describe('action helpers', () => {
  it('collapses whitespace in a title', () => {
    expect(normalizeTitle('  a \t b\n')).toBe('a b');
  });

  it('words the result for the state the action left', () => {
    expect(changedMessage('archive', targetOfThread(thread({ archived: 0 })))).toBe('Back in the lists');
  });
});
