// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Settings, Sync: one computer is enough to start, so until this machine signs in to a relay the section is one card
// with Set up sync, and the cards that only mean something with sync on (signing keys, refused changes, the path map)
// stay hidden.

const OFF = { configured: false, signedOut: false, legacyRelay: false, enabled: false, running: false, pending: 0, lastError: null, lastSyncAt: null };
let status: Record<string, unknown> = OFF;

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async () => status) as typeof actual.api.get;
  return actual;
});

import { SyncSection } from '../src/pages/Sync.tsx';

let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => {});
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const headings = () => [...host.querySelectorAll('h2, h3')].map((h) => h.textContent?.trim());
const extra = createElement('div', { 'data-extra': '' }, 'Signing keys');

beforeEach(() => {
  status = OFF;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('never set up: one card, a pointer to phone pairing, no relay form and none of the sync-only cards', async () => {
  await act(async () => root.render(createElement(SyncSection, null, extra)));
  await flush();
  expect(headings()).toEqual(['One computer is enough']);
  expect(host.querySelector('[data-sync-phone] a')?.getAttribute('href')).toBe('#/settings/access?focus=ios');
  expect(host.querySelector('#sync-url')).toBeNull();
  expect(host.querySelector('[data-extra]')).toBeNull();
});

it('Set up sync opens the relay sign-in, still without the sync-only cards', async () => {
  await act(async () => root.render(createElement(SyncSection, null, extra)));
  await flush();
  await act(async () => button('Set up sync')!.click());
  expect(headings()).toEqual(['Sign in to your relay']);
  expect(host.querySelector('#sync-url')).not.toBeNull();
  expect(host.querySelector('[data-extra]')).toBeNull();
});

it('a machine still on the old Supabase relay goes straight to the sign-in that says sync moved', async () => {
  status = { ...OFF, legacyRelay: true };
  await act(async () => root.render(createElement(SyncSection, null, extra)));
  await flush();
  expect(headings()).toEqual(['Sign in to your relay']);
  expect(host.textContent).toContain('Sync moved from Supabase to a Cloudflare relay.');
});
