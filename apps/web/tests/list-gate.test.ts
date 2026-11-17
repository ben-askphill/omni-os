// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The channel list and pins the app reloads by itself give way to a thread's first page (api.ts listGate): on a phone
// they share a narrow link with it, and the list can be close to a megabyte.

type Sent = { path: string; aborted: boolean; resolve: (v: unknown) => void };
const sent: Sent[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(
    (path: string, signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        const s: Sent = { path, aborted: false, resolve };
        sent.push(s);
        signal?.addEventListener('abort', () => {
          s.aborted = true;
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
      }),
  ) as typeof actual.api.get;
  return actual;
});

import { listGate } from '../src/api.ts';
import { useChannels } from '../src/app/useChannels.ts';

let hook: ReturnType<typeof useChannels>;
function Probe() {
  hook = useChannels();
  return null;
}

let root: Root;
beforeEach(() => {
  sent.length = 0;
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
});
afterEach(() => act(() => root.unmount()));

const flush = () => act(async () => {});

describe('list reloads give way to an opening thread', () => {
  it('waits to reload the channels until the thread page is in', async () => {
    const release = listGate.hold();
    act(() => void hook.reloadChannels());
    await flush();
    expect(sent).toEqual([]);
    release();
    await flush();
    expect(sent.map((s) => s.path).sort()).toEqual(['/channels', '/pinned']);
    await act(async () => sent.forEach((s) => s.resolve([])));
  });

  it('cuts off a channel reload in flight when a thread opens, and sends it again after', async () => {
    let reload!: Promise<void>;
    act(() => void (reload = hook.reloadChannels()));
    await flush();
    const release = listGate.hold();
    await flush();
    expect(sent.filter((s) => s.path === '/channels').map((s) => s.aborted)).toEqual([true]);
    release();
    await flush();
    const again = sent.filter((s) => s.path === '/channels');
    expect(again.map((s) => s.aborted)).toEqual([true, false]);
    await act(async () => {
      again[1]?.resolve([{ id: 'c1', name: 'omni' }]);
      sent.find((s) => s.path === '/pinned' && !s.aborted)?.resolve([]);
      await reload;
    });
    expect(hook.channels.map((c) => c.id)).toEqual(['c1']);
    expect(hook.channelsError).toBeNull();
  });
});
