// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// A burst of thread events reloads the channel list, the running counts and Needs you. While the page is hidden only
// Needs you reloads (notifications read it); the other two wait for the page to come back, then reload once.

const gets: string[] = [];
let push: (d: unknown) => void = () => {};
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    gets.push(path.split('?')[0]);
    return path.startsWith('/status') ? { profile: null, usage: {} } : [];
  }) as typeof actual.api.get;
  return {
    ...actual,
    openSSE: (_url: () => string, onData: (d: unknown) => void) => {
      push = onData;
      return { close: () => {} };
    },
  };
});
vi.mock('../src/display.ts', () => ({ loadDisplay: async () => {} }));

const { AppProvider } = await import('../src/store.tsx');

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (v: DocumentVisibilityState) =>
  act(async () => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  });

let root: Root;
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const count = (path: string) => gets.filter((g) => g === path).length;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  visibility = 'visible';
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(AppProvider, null, null)));
  await tick(0);
  gets.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('feed bursts while the page is hidden', () => {
  it('reload only Needs you while hidden, and the rest once on return', async () => {
    await setVisibility('hidden');
    act(() => push({ type: 'thread' }));
    act(() => push({ type: 'thread' }));
    await tick(600);
    expect(count('/needs-you')).toBe(1);
    expect(count('/channels')).toBe(0);
    expect(count('/status')).toBe(0);
    await setVisibility('visible');
    await tick(0);
    expect(count('/channels')).toBe(1);
    expect(count('/status')).toBe(1);
  });

  it('reload everything at once while shown', async () => {
    act(() => push({ type: 'thread' }));
    await tick(600);
    expect(count('/needs-you')).toBe(1);
    expect(count('/channels')).toBe(1);
    expect(count('/status')).toBe(1);
  });

  it('coming back with nothing missed asks for nothing more', async () => {
    await setVisibility('hidden');
    await setVisibility('visible');
    await tick(0);
    expect(count('/channels')).toBe(0);
  });
});
