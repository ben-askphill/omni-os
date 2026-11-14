// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelWithRunning } from '../src/api.ts';
import type { PinnedThread } from '../src/pins.ts';

// U25: a channel or pinned reload that started before a local edit (folder rename, collapse, pin) must not put the
// old list back when it lands late.

type Pending = { path: string; resolve: (v: unknown) => void };
const pending: Pending[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn((path: string) => new Promise((resolve) => pending.push({ path, resolve }))) as typeof actual.api.get;
  actual.api.patch = vi.fn(async () => ({})) as typeof actual.api.patch;
  return actual;
});

import { useChannels } from '../src/app/useChannels.ts';

const channel = (folderName: string) => ({ id: 'c1', name: 'omni', folders: [{ id: 'f1', name: folderName }] }) as unknown as ChannelWithRunning;
const pin = (id: string) => ({ id, title: id }) as unknown as PinnedThread;

let hook: ReturnType<typeof useChannels>;
function Probe() {
  hook = useChannels();
  return null;
}

let root: Root;
beforeEach(() => {
  pending.length = 0;
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
});
afterEach(() => act(() => root.unmount()));

const answer = async (path: string, value: unknown) => {
  const i = pending.findIndex((p) => p.path === path);
  const [p] = pending.splice(i, 1);
  await act(async () => p.resolve(value));
};
const folderName = () => (hook.channels[0]?.folders?.[0] as { name: string } | undefined)?.name;

describe('channel reloads are latest-only', () => {
  it('drops a reload that started before a folder rename', async () => {
    let reload!: Promise<void>;
    act(() => void (reload = hook.reloadChannels()));
    // Ben renames the folder while the GET is in flight.
    act(() => hook.setChannels([channel('Renamed')]));
    await answer('/channels', [channel('Old name')]);
    await answer('/pinned', []);
    expect(folderName()).toBe('Renamed');
    // The dropped pass loads again, and that answer started after the rename.
    await answer('/channels', [channel('Renamed on server')]);
    await answer('/pinned', []);
    await act(() => reload);
    expect(folderName()).toBe('Renamed on server');
  });

  it('applies a reload that started after the edit', async () => {
    act(() => hook.setChannels([channel('Renamed')]));
    act(() => void hook.reloadChannels());
    await answer('/channels', [channel('From server')]);
    expect(folderName()).toBe('From server');
    expect(hook.channelsLoaded).toBe(true);
  });

  it('runs one reload at a time and one more for any calls meanwhile, so a burst still lands', async () => {
    act(() => void hook.reloadChannels());
    act(() => void hook.reloadChannels());
    act(() => void hook.reloadChannels());
    expect(pending.filter((p) => p.path === '/channels')).toHaveLength(1);
    await answer('/channels', [channel('First')]);
    expect(hook.channelsLoaded).toBe(true);
    expect(folderName()).toBe('First');
    act(() => void hook.reloadChannels());
    await answer('/pinned', []);
    expect(pending.filter((p) => p.path === '/channels')).toHaveLength(1);
    await answer('/channels', [channel('Second')]);
    expect(folderName()).toBe('Second');
    await answer('/pinned', []);
    expect(pending.filter((p) => p.path === '/channels')).toHaveLength(0);
  });

  it('drops a pinned reload that started before a pin', async () => {
    act(() => void hook.reloadChannels());
    await act(async () => void hook.setPinned({ id: 'b', title: 'b' } as never, true));
    // The first /pinned started before the pin; the one after the PATCH is current.
    const [stale, fresh] = pending.filter((p) => p.path === '/pinned');
    await act(async () => stale.resolve([pin('a')]));
    expect(hook.pinned.map((p) => p.id)).toEqual(['b']);
    await act(async () => fresh.resolve([pin('a'), pin('b')]));
    expect(hook.pinned.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
