import { describe, expect, it } from 'vitest';

import type { OmniAlert } from './alert';
import type { PushServer } from './registration';
import { createTapRouter, pickServer, routesFor, waitUntil, type TapRoute, type ThreadProbe } from './tap';

const a: PushServer = { id: 'a', origin: 'https://a.example.com' };
const b: PushServer = { id: 'b', origin: 'https://b.example.com' };
const alert: OmniAlert = { kind: 'needsInput', threadId: 't1', channelId: 'c1' };

describe('routesFor', () => {
  it('stacks Channels, the channel and the thread so Back lands where the alert came from', () => {
    expect(routesFor(alert)).toEqual([
      { name: 'Channels' },
      { name: 'Channel', params: { id: 'c1' } },
      { name: 'Thread', params: { id: 't1' } },
    ]);
  });

  it('skips the channel when the alert names none', () => {
    expect(routesFor({ threadId: 't1', channelId: null }).map((route) => route.name)).toEqual(['Channels', 'Thread']);
  });
});

describe('pickServer', () => {
  const probeWith = (found: string[]) => async (server: PushServer): Promise<ThreadProbe> =>
    found.includes(server.id) ? 'found' : 'missing';

  it('takes the only server without asking it', async () => {
    let probed = 0;
    const server = await pickServer('t1', [a], async () => {
      probed += 1;
      return 'missing';
    });
    expect(server).toBe(a);
    expect(probed).toBe(0);
  });

  it('takes the first server that has the thread, active first', async () => {
    expect(await pickServer('t1', [a, b], probeWith(['a', 'b']))).toBe(a);
    expect(await pickServer('t1', [a, b], probeWith(['b']))).toBe(b);
  });

  it('falls back to the active server when none has it or none answers', async () => {
    expect(await pickServer('t1', [a, b], probeWith([]))).toBe(a);
    expect(
      await pickServer('t1', [a, b], async () => {
        throw new Error('offline');
      }),
    ).toBe(a);
  });

  it('is null with no servers', async () => {
    expect(await pickServer('t1', [], probeWith([]))).toBeNull();
  });
});

describe('waitUntil', () => {
  it('resolves true as soon as ready', async () => {
    let calls = 0;
    expect(await waitUntil(() => ++calls >= 3, { stepMs: 1 })).toBe(true);
  });

  it('gives up after the timeout', async () => {
    expect(await waitUntil(() => false, { timeoutMs: 20, stepMs: 5 })).toBe(false);
  });
});

function setup(options: { servers?: PushServer[]; ready?: () => boolean; active?: string | null; onScreen?: string | null; found?: string[] } = {}) {
  const state = { active: options.active === undefined ? 'a' : options.active, ready: true };
  const opened: TapRoute[][] = [];
  const selected: string[] = [];
  const router = createTapRouter({
    servers: async () => options.servers ?? [a],
    probe: async (server) => ((options.found ?? ['a']).includes(server.id) ? 'found' : 'missing'),
    ready: options.ready ?? (() => state.ready),
    activeServerId: () => state.active,
    select: async (id) => {
      selected.push(id);
      state.active = id;
    },
    threadOnScreen: () => options.onScreen ?? null,
    open: (routes) => opened.push(routes),
    wait: { timeoutMs: 100, stepMs: 1 },
  });
  return { router, opened, selected, state };
}

describe('createTapRouter', () => {
  it('opens the thread on the active server', async () => {
    const { router, opened, selected } = setup();

    await router.handle('n1', alert);

    expect(opened).toEqual([routesFor(alert)]);
    expect(selected).toEqual([]);
  });

  it('switches to the server that has the thread before opening it', async () => {
    const { router, opened, selected } = setup({ servers: [a, b], found: ['b'] });

    await router.handle('n1', alert);

    expect(selected).toEqual(['b']);
    expect(opened).toHaveLength(1);
  });

  it('opens a notification once even when iOS delivers the tap twice', async () => {
    const { router, opened } = setup();

    await router.handle('n1', alert);
    await router.handle('n1', alert);

    expect(opened).toHaveLength(1);
  });

  it('waits for a cold app to load before opening', async () => {
    const { router, opened, state } = setup();
    state.ready = false;

    const tap = router.handle('n1', alert);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(opened).toEqual([]);

    state.ready = true;
    await tap;
    expect(opened).toHaveLength(1);
  });

  it('gives up when the app never becomes ready', async () => {
    const { router, opened } = setup({ ready: () => false });
    await router.handle('n1', alert);
    expect(opened).toEqual([]);
  });

  it('lets the newest tap win over an older one still waiting', async () => {
    const { router, opened, state } = setup();
    state.ready = false;

    const older = router.handle('n1', { ...alert, threadId: 'old' });
    const newer = router.handle('n2', { ...alert, threadId: 'new' });
    state.ready = true;
    await Promise.all([older, newer]);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.at(-1)).toEqual({ name: 'Thread', params: { id: 'new' } });
  });

  it('leaves the screen alone when the thread is already open', async () => {
    const { router, opened } = setup({ onScreen: 't1' });
    await router.handle('n1', alert);
    expect(opened).toEqual([]);
  });

  it('opens nothing with no paired server', async () => {
    const { router, opened } = setup({ servers: [] });
    await router.handle('n1', alert);
    expect(opened).toEqual([]);
  });
});
