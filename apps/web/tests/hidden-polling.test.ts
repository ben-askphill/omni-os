// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FeedEvent } from '../src/api.ts';

// Background reads stop while the page is hidden (a background tab, a minimized desktop window) or, on the phone,
// while their tab is under another one, and ask once on coming back. A /machines GET in the last minute keeps the
// server sampling CPU and RAM (apps/server/machine-stats.ts).

const gets: { path: string; priority?: RequestPriority }[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string, extras: { priority?: RequestPriority } = {}) => {
    gets.push({ path, priority: extras.priority });
    return { machines: [] };
  }) as typeof actual.api.get;
  return actual;
});
let feed: (e: FeedEvent) => void = () => {};
vi.mock('../src/store.tsx', () => ({ useFeed: (fn: (e: FeedEvent) => void) => void (feed = fn) }));

const { useVisibleInterval } = await import('../src/visible.ts');
const { useMachines } = await import('../src/app/useMachines.ts');
const { useSyncTrouble } = await import('../src/forwarded.ts');

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (v: DocumentVisibilityState) =>
  act(() => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  });

let root: Root;
// One component type, so rendering again with new arguments updates it instead of mounting a new one.
let hook: () => void = () => {};
function Probe() {
  hook();
  return null;
}
const render = (fn: () => void) => {
  hook = fn;
  return act(() => root.render(createElement(Probe)));
};
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const count = (path: string) => gets.filter((g) => g.path === path).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  visibility = 'visible';
  gets.length = 0;
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useVisibleInterval', () => {
  it('stops while the page is hidden and asks once at once on return, then every interval again', async () => {
    const fn = vi.fn();
    await render(() => useVisibleInterval(fn, 15_000));
    await tick(30_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await setVisibility('hidden');
    await tick(120_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(3);
    await tick(15_000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('stops while its owner is not shown, as a phone tab under another one', async () => {
    const fn = vi.fn();
    let shown = true;
    const probe = () => useVisibleInterval(fn, 15_000, shown);
    await render(probe);
    shown = false;
    await render(probe);
    await tick(60_000);
    expect(fn).not.toHaveBeenCalled();
    shown = true;
    await render(probe);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('mounted while hidden, it waits for the page and then asks', async () => {
    visibility = 'hidden';
    const fn = vi.fn();
    await render(() => useVisibleInterval(fn, 15_000));
    await tick(60_000);
    expect(fn).not.toHaveBeenCalled();
    await setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('useMachines', () => {
  it('stops polling /machines and ignores feed bursts while hidden, then asks once on return', async () => {
    await render(() => useMachines());
    await tick(0);
    expect(count('/machines')).toBe(1);
    await tick(15_000);
    expect(count('/machines')).toBe(2);
    await setVisibility('hidden');
    await tick(60_000);
    act(() => feed({ type: 'needs_you' } as FeedEvent));
    await tick(1_000);
    expect(count('/machines')).toBe(2);
    await setVisibility('visible');
    await tick(0);
    expect(count('/machines')).toBe(3);
    await tick(15_000);
    expect(count('/machines')).toBe(4);
    expect(gets.every((g) => g.priority === 'low')).toBe(true);
  });

  it('a feed burst while shown still asks again once it settles', async () => {
    await render(() => useMachines());
    await tick(0);
    act(() => feed({ type: 'thread' } as FeedEvent));
    act(() => feed({ type: 'tasks' } as FeedEvent));
    await tick(600);
    expect(count('/machines')).toBe(2);
  });

  it('stops on the phone while Activity is not the tab shown', async () => {
    let shown = true;
    const probe = () => useMachines(shown);
    await render(probe);
    await tick(0);
    shown = false;
    await render(probe);
    await tick(60_000);
    expect(count('/machines')).toBe(1);
    shown = true;
    await render(probe);
    await tick(0);
    expect(count('/machines')).toBe(2);
  });
});

describe('useSyncTrouble', () => {
  it('polls /sync/status only while a forwarded message waits and the page is on screen', async () => {
    await render(() => useSyncTrouble(true));
    await tick(15_000);
    expect(count('/sync/status')).toBe(2);
    await setVisibility('hidden');
    await tick(60_000);
    expect(count('/sync/status')).toBe(2);
    await setVisibility('visible');
    await tick(0);
    expect(count('/sync/status')).toBe(3);
  });
});
