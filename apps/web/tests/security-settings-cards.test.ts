// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Settings cards for PRD #667: MCP clients, install token, signing keys and refused changes, against the routes the
// server member fixed. A server from before them answers 404 and the read-backed cards stay out.

let replies: Record<string, unknown> = {};
let failures: Record<string, number> = {};
let postFailures: Record<string, number> = {};
const posts: string[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    if (path in failures) throw new actual.ApiError('Server error', failures[path]);
    if (!(path in replies)) throw new actual.ApiError('not found', 404);
    return replies[path];
  }) as typeof actual.api.get;
  actual.api.post = vi.fn(async (path: string) => {
    posts.push(path);
    if (path in postFailures) throw new actual.ApiError('Forbidden', postFailures[path]);
    return { ok: true };
  }) as typeof actual.api.post;
  return actual;
});

import { InstallTokenCard, McpClientsCard, RefusedChangesCard, SyncKeysCard } from '../src/pages/SecuritySettings.tsx';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  replies = {};
  failures = {};
  postFailures = {};
  posts.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const mount = async (el: ReactElement) => {
  await act(async () => root.render(el));
  await act(async () => {});
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

describe('MCP clients card', () => {
  it('lists pending and approved clients with Approve and Remove, hiding removed ones', async () => {
    replies['/mcp/clients'] = [
      { id: 'c1', name: 'Claude', status: 'approved', firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-10T00:00:00Z', via: 'audience' },
      { id: 'c2', name: null, status: 'pending', firstSeen: '2026-11-12T00:00:00Z', lastSeen: '2026-11-12T00:00:00Z', via: null },
      { id: 'c3', name: 'Old', status: 'removed', firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-02T00:00:00Z', via: null },
    ];
    await mount(createElement(McpClientsCard));
    expect(host.textContent).toContain('MCP clients');
    expect(host.textContent).toContain('Claude');
    expect(host.textContent).toContain('c2');
    expect(host.textContent).toContain('Pending');
    expect(host.textContent).not.toContain('Old');
    expect(host.textContent).toContain('First seen');
    await act(async () => button('Approve')!.click());
    expect(posts).toEqual(['/mcp/clients/c2/approve']);
  });

  it('stays out on a server without the route', async () => {
    await mount(createElement(McpClientsCard));
    expect(host.textContent).toBe('');
  });

  it('shows a bound client with its hint, Approve and Remove, between pending and approved', async () => {
    replies['/mcp/clients'] = [
      { id: 'a1', name: 'Approved one', status: 'approved', firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-13T00:00:00Z', via: 'client' },
      { id: 'b1', name: 'Bound one', status: 'bound', firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-02T00:00:00Z', via: 'audience' },
      { id: 'p1', name: 'Pending one', status: 'pending', firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-01T00:00:00Z', via: null },
    ];
    await mount(createElement(McpClientsCard));
    const rows = [...host.querySelectorAll('li')];
    expect(rows.map((r) => r.textContent?.match(/(Pending|Bound|Approved) one/)?.[0])).toEqual(['Pending one', 'Bound one', 'Approved one']);
    const bound = rows[1];
    expect(bound.textContent).toContain('Bound to this Omni');
    expect(bound.textContent).toContain('Approve also lets in tokens without an audience.');
    const labels = (row: Element) => [...row.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels(bound)).toEqual(['Approve', 'Remove']);
    expect(labels(rows[2])).toEqual(['Remove']);
    await act(async () => [...bound.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Approve')!.click());
    expect(posts).toEqual(['/mcp/clients/b1/approve']);
  });
});

describe('a card whose read fails for another reason than a missing route', () => {
  it.each([
    ['/mcp/clients', McpClientsCard, 'MCP clients'],
    ['/sync/devices', SyncKeysCard, 'Signing keys'],
    ['/sync/refused?limit=50', RefusedChangesCard, 'Refused changes'],
  ] as const)('%s shows the error with Retry instead of hiding', async (path, Card, title) => {
    failures[path] = 500;
    await mount(createElement(Card));
    expect(host.textContent).toContain(title);
    expect(host.textContent).toContain('Server error');
    expect(button('Retry')).toBeTruthy();
  });
});

describe('signing keys card', () => {
  it('shows each fingerprint, and Key changed with Confirm new key only where the key changed', async () => {
    replies['/sync/devices'] = [
      { id: 'here', name: 'omarchy', current: true, fingerprint: 'aaaa1111bbbb2222cccc', pinnedFingerprint: 'aaaa1111bbbb2222cccc', keyChanged: false },
      { id: 'mac', name: 'MacBook', current: false, fingerprint: 'dddd3333eeee4444ffff', pinnedFingerprint: '0000999988887777', keyChanged: true },
    ];
    await mount(createElement(SyncKeysCard));
    expect(host.textContent).toContain('aaaa 1111 bbbb 2222');
    expect(host.textContent).toContain('Key changed');
    expect(host.textContent).toContain('Pinned: 0000 9999 8888 7777');
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('Confirm new key'))).toHaveLength(1);
  });
  it('offers Trust this machine for a new machine and posts confirm-key after the second step', async () => {
    replies['/sync/devices'] = [
      { id: 'here', name: 'omarchy', current: true, fingerprint: 'aaaa1111', pinnedFingerprint: 'aaaa1111', keyChanged: false, trusted: true },
      { id: 'mini', name: 'Mac mini', current: false, fingerprint: 'dddd3333', pinnedFingerprint: 'dddd3333', keyChanged: false, trusted: false },
    ];
    await mount(createElement(SyncKeysCard));
    expect(host.textContent).toContain('New machine');
    expect(host.textContent).not.toContain('Key changed');
    expect(host.textContent).toContain('update requests and secrets wait');
    await act(async () => button('Trust this machine')!.click());
    expect(posts).toEqual([]);
    await act(async () => button('Trust Mac mini')!.click());
    await act(async () => {});
    expect(posts).toEqual(['/sync/devices/mini/confirm-key']);
  });
  it('shows a new machine with no key yet as new, with no Trust button until its key arrives', async () => {
    replies['/sync/devices'] = [{ id: 'mini', name: 'Mac mini', current: false, fingerprint: null, pinnedFingerprint: null, keyChanged: false, trusted: false }];
    await mount(createElement(SyncKeysCard));
    expect(host.textContent).toContain('New machine');
    expect(host.textContent).toContain('No signing key yet');
    expect(button('Trust this machine')).toBeFalsy();
  });
});

describe('refused changes card', () => {
  it('lists machine, entity and reason, newest first as the server sends them', async () => {
    replies['/sync/refused?limit=50'] = [{ id: 'r1', at: '2026-11-14T09:00:00Z', machine: 'MacBook', entity: 'remote_command', entityId: 'x', reason: 'unsigned' }];
    await mount(createElement(RefusedChangesCard));
    expect(host.textContent).toContain('Refused changes');
    expect(host.textContent).toContain('Remote command');
    expect(host.textContent).toContain('from MacBook');
    expect(host.textContent).toContain('unsigned');
  });
});

describe('install token card', () => {
  it('rotates only after the confirm step', async () => {
    await mount(createElement(InstallTokenCard));
    await act(async () => button('Rotate install token')!.click());
    expect(posts).toEqual([]);
    await act(async () => button('Rotate and sign out all')!.click());
    await act(async () => {});
    expect(posts).toEqual(['/auth/rotate-token']);
  });

  it('tells an app or Google session where to rotate from on a 403', async () => {
    postFailures['/auth/rotate-token'] = 403;
    await mount(createElement(InstallTokenCard));
    await act(async () => button('Rotate install token')!.click());
    await act(async () => button('Rotate and sign out all')!.click());
    await act(async () => {});
    expect(host.textContent).toContain('Rotate from this Mac or a token-paired device.');
  });
});
