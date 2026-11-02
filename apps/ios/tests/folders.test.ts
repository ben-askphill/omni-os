import type { ChannelWithRunning } from '@omni/client-core';
import { describe, expect, it, vi } from 'vitest';

import { createFolderCollapse, createPendingFolders } from '../src/live/folders';
import type { ChannelsState } from '../src/live/hub';
import { createStore } from '../src/live/store';

const channel = (id: string, folders: { id: string; collapsed: number }[]) => ({ id, name: id, folders }) as unknown as ChannelWithRunning;

function setup(call: (id: string, collapsed: boolean) => Promise<unknown> = async () => ({}), pending = createPendingFolders()) {
  const channels = createStore<ChannelsState>({
    channels: [channel('a', [{ id: 'f1', collapsed: 0 }]), channel('b', [{ id: 'f2', collapsed: 1 }, { id: 'f3', collapsed: 0 }])],
    loading: false,
    error: null,
    loadedAt: null,
  });
  const setFolderCollapsed = vi.fn(call);
  const refresh = vi.fn(async () => {});
  const run = createFolderCollapse({ api: { setFolderCollapsed: setFolderCollapsed as never }, withAuth: (f) => f(), channels, refresh, pending });
  const collapsed = () => Object.fromEntries(channels.get().channels!.flatMap((c) => c.folders!.map((f) => [f.id, f.collapsed])));
  return { run, channels, setFolderCollapsed, refresh, collapsed };
}

describe('createFolderCollapse', () => {
  it('closes the folder before the server answers and leaves the others alone', async () => {
    let answer!: () => void;
    const t = setup(() => new Promise((resolve) => (answer = () => resolve({}))));
    const done = t.run('f1', true);
    expect(t.collapsed()).toEqual({ f1: 1, f2: 1, f3: 0 });
    answer();
    expect(await done).toBeNull();
    expect(t.setFolderCollapsed).toHaveBeenCalledWith('f1', true);
  });

  it('refetches the list after the server took it', async () => {
    const t = setup();
    await t.run('f3', true);
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it('opens a closed folder', async () => {
    const t = setup();
    await t.run('f2', false);
    expect(t.collapsed().f2).toBe(0);
  });

  it('puts the folder back and returns the message when the server refuses', async () => {
    const t = setup(async () => {
      throw new Error('Folder is locked');
    });
    expect(await t.run('f1', true)).toBe('Folder is locked');
    expect(t.collapsed()).toEqual({ f1: 0, f2: 1, f3: 0 });
    expect(t.refresh).not.toHaveBeenCalled();
  });

  it('does not undo a newer state a refetch brought while the request failed', async () => {
    let fail!: () => void;
    const t = setup(() => new Promise((_, reject) => (fail = () => reject(new Error('down')))));
    const done = t.run('f1', true);
    t.channels.set((s) => ({ ...s, channels: [channel('a', [{ id: 'f1', collapsed: 0 }]), ...s.channels!.slice(1)] }));
    fail();
    await done;
    expect(t.collapsed().f1).toBe(0);
  });

  it('keeps a toggle the server has not answered on a list fetched meanwhile, and drops it once answered', async () => {
    let answer!: () => void;
    const pending = createPendingFolders();
    const t = setup(() => new Promise((resolve) => (answer = () => resolve({}))), pending);
    const done = t.run('f1', true);
    const stale = [channel('a', [{ id: 'f1', collapsed: 0 }])];
    expect(pending.apply(stale)[0]!.folders![0]!.collapsed).toBe(1);
    answer();
    await done;
    expect(pending.apply(stale)[0]!.folders![0]!.collapsed).toBe(0);
  });

  it('refuses a folder the list does not have, without calling the server', async () => {
    const t = setup();
    expect(await t.run('nope', true)).toBe('That folder is gone');
    expect(t.setFolderCollapsed).not.toHaveBeenCalled();
  });

  it('says so when the device is not paired', async () => {
    const channels = createStore<ChannelsState>({ channels: null, loading: false, error: null, loadedAt: null });
    const run = createFolderCollapse({ api: null, withAuth: (f) => f(), channels, refresh: async () => {} });
    expect(await run('f1', true)).toBe('Not paired');
  });
});
