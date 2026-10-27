// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The address bar of the thread panel's live browser: it takes the keys while it has focus, Return goes to the address
// and Escape gives up the edit, and either way the keys go back to the page, as in Chrome. The page's frames and the
// Mac app's field are checked in a real browser and the Mac QA harness ({"browserAddress": ...}).

const posts: { path: string; body: any }[] = [];
let push: (d: unknown) => void = () => {};

vi.mock('../src/api.ts', () => ({
  api: {
    post: vi.fn(async (path: string, body: any = {}) => {
      posts.push({ path, body });
      return state({ url: body.action === 'navigate' ? `https://${body.url}/` : 'https://example.com/' });
    }),
  },
  errorText: (e: unknown) => String(e),
  openSSE: (_url: () => string, onData: (d: unknown) => void) => {
    push = onData;
    return { close: () => {} };
  },
}));

import { LiveBrowser } from '../src/components/LiveBrowser.tsx';

const state = (over: Record<string, unknown> = {}) => ({
  running: true,
  url: 'https://example.com/',
  title: 'Example Domain',
  loading: false,
  canBack: false,
  canForward: false,
  tabs: [{ id: 't1', url: 'https://example.com/', title: 'Example Domain' }],
  active: 't1',
  ...over,
});

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  posts.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(LiveBrowser, { channelId: 'inbox' })));
  await act(async () => push({ type: 'state', state: state() }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const bar = () => host.querySelector<HTMLInputElement>('input[aria-label="Address and search bar"]')!;
const page = () => host.querySelector<HTMLDivElement>('[aria-label="Live browser. Click to interact, then type."]')!;
const inputs = () => posts.filter((p) => p.path.endsWith('/input'));

/** Types into the bar as a person does: a key the page must not see, then the new value. */
async function type(text: string) {
  const el = bar();
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: text.at(-1)!, bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(k: string) {
  await act(async () => {
    bar().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

describe('the live browser address bar', () => {
  it('shows the address at rest and takes focus from the page', async () => {
    expect(bar().value).toBe('example.com');
    await act(async () => page().focus());
    expect(document.activeElement).toBe(page());
    await act(async () => bar().focus());
    expect(document.activeElement).toBe(bar());
    expect(bar().value).toBe('https://example.com/');
  });

  it('keeps what is typed out of the page, goes there on Return and hands the keys back to the page', async () => {
    await act(async () => bar().focus());
    await type('example.org');
    expect(bar().value).toBe('example.org');
    expect(document.activeElement).toBe(bar());
    await act(async () => bar().form!.requestSubmit());
    expect(posts.filter((p) => p.body.action === 'navigate')).toEqual([{ path: '/channels/inbox/browser/action', body: { action: 'navigate', url: 'example.org' } }]);
    expect(document.activeElement).toBe(page());
    expect(inputs()).toEqual([]);
  });

  it('puts the address back on Escape and hands the keys back to the page', async () => {
    await act(async () => bar().focus());
    await type('typo.example');
    await key('Escape');
    expect(document.activeElement).toBe(page());
    expect(bar().value).toBe('example.com');
    expect(posts.filter((p) => p.body.action === 'navigate')).toEqual([]);
    expect(inputs()).toEqual([]);
  });

  it('does not navigate to an empty address', async () => {
    await act(async () => bar().focus());
    await type('   ');
    await act(async () => bar().form!.requestSubmit());
    expect(posts.filter((p) => p.body.action === 'navigate')).toEqual([]);
    expect(document.activeElement).toBe(bar());
  });
});
