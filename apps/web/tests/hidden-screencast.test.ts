// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The live browser's screencast (a JPEG decode each time Chrome paints) closes while the page is hidden and attaches
// again on return, without asking Chrome to start a second time.

const posts: string[] = [];
const streams: { open: boolean }[] = [];
vi.mock('../src/api.ts', () => ({
  api: {
    post: vi.fn(async (path: string) => {
      posts.push(path);
      return { running: true, url: 'https://example.com/', title: '', loading: false, canBack: false, canForward: false, tabs: [], active: null };
    }),
  },
  ApiError: class extends Error {},
  errorText: (e: unknown) => String(e),
  openSSE: () => {
    const s = { open: true };
    streams.push(s);
    return { close: () => void (s.open = false) };
  },
}));

const { useChannelBrowser } = await import('../src/components/LiveBrowser.tsx');

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (v: DocumentVisibilityState) =>
  act(async () => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  });

let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  visibility = 'visible';
  posts.length = 0;
  streams.length = 0;
  root = createRoot(document.createElement('div'));
  function Probe() {
    useChannelBrowser('inbox');
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const open = () => streams.filter((s) => s.open).length;

describe('the live browser screencast', () => {
  it('closes while the page is hidden and attaches again on return', async () => {
    expect(posts).toEqual(['/channels/inbox/browser/start']);
    expect(open()).toBe(1);
    await setVisibility('hidden');
    expect(open()).toBe(0);
    await setVisibility('visible');
    expect(open()).toBe(1);
    expect(streams).toHaveLength(2);
    expect(posts).toEqual(['/channels/inbox/browser/start']);
  });
});
