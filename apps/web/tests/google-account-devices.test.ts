// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Settings, Sharing & access, Google account: an app paired with a code is a signed-in device even when no Google
// account is linked, or Google sign-in is not set up at all. It shows in the list and can be revoked.

let account: Record<string, unknown>;
const app = { id: 's1', name: 'Ben’s iPhone', kind: 'app', createdAt: '2026-11-02T10:00:00Z', lastSeenAt: '2026-11-02T10:01:00Z', current: false };
const gets: string[] = [];
const deletes: string[] = [];

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    gets.push(path);
    if (path === '/auth/account') return account;
    if (path === '/auth/devices') return { devices: [app] };
    throw new Error(`unexpected ${path}`);
  }) as typeof actual.api.get;
  actual.api.del = vi.fn(async (path: string) => void deletes.push(path)) as typeof actual.api.del;
  return actual;
});

import { GoogleAccountSection } from '../src/pages/GoogleAccount.tsx';

let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => {});

beforeEach(() => {
  gets.length = 0;
  deletes.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = async () => {
  await act(async () => root.render(createElement(GoogleAccountSection)));
  await flush();
};

it.each([
  ['no Google account linked', { available: true, issuer: 'https://clerk.example', owner: null, via: 'token' }],
  ['Google sign-in not set up', { available: false, issuer: null, owner: null, via: 'token' }],
])('lists a paired app with %s, and revokes it', async (_, a) => {
  account = a;
  await mount();
  expect(gets).toContain('/auth/devices');
  expect(host.textContent).toContain('Ben’s iPhone');
  expect(host.textContent).toContain('App, used');
  const revoke = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Revoke')!;
  await act(async () => revoke.click());
  const confirm = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Revoke')!;
  await act(async () => confirm.click());
  await flush();
  expect(deletes).toEqual(['/auth/devices/s1']);
});
