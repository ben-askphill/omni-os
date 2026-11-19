// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The Search page shows a hit's snippet as text with the search API's <mark> markers as mark elements, and writes no
// HTML string into the page (audit L5): markup quoted in a transcript shows as written.

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  const snippet = 'ran <mark>checkout</mark> on <img src=x onerror="window.pwned=1"> and <b>bold</b> … <mark>checko</mark>ut</mark>';
  const hit = { thread_id: 't1', title: 'Checkout fix', channel_id: 'shop', status: 'done', updated_at: '2026-11-19T10:00:00Z', snippet, event_id: 4 };
  return { ...actual, useApi: () => ({ data: [hit], error: null, loading: false, reload: () => {} }) };
});
vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useApp: () => ({ channel: () => ({ id: 'shop', name: 'Shop' }) }),
}));

import { SearchPage } from '../src/pages/Search.tsx';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The prototype that owns the innerHTML setter, so a spy sees every write. */
function innerHtmlOwner() {
  let proto: object | null = HTMLParagraphElement.prototype;
  while (proto && !Object.getOwnPropertyDescriptor(proto, 'innerHTML')) proto = Object.getPrototypeOf(proto);
  return proto as HTMLElement;
}

it('renders the snippet as text and <mark> nodes, with no innerHTML write', async () => {
  const writes = vi.spyOn(innerHtmlOwner(), 'innerHTML', 'set');
  await act(() => root.render(createElement(SearchPage, { q: 'checkout' })));
  const p = host.querySelector('a[href*="t1"] p')!;
  expect([...p.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['checkout', 'checko']);
  expect(p.textContent).toBe('ran checkout on <img src=x onerror="window.pwned=1"> and <b>bold</b> … checkout</mark>');
  expect(p.querySelector('img, b')).toBeNull();
  expect(p.children).toHaveLength(2);
  expect(writes).not.toHaveBeenCalled();
});
