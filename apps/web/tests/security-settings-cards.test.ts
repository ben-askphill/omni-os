// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Settings cards for PRD #667: MCP clients, install token, signing keys and refused changes, against the routes the
// server member fixed. A server from before them answers 404 and the read-backed cards stay out.

let replies: Record<string, unknown> = {};
const posts: string[] = [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    if (!(path in replies)) throw new actual.ApiError('not found', 404);
    return replies[path];
  }) as typeof actual.api.get;
  actual.api.post = vi.fn(async (path: string) => {
    posts.push(path);
    return { ok: true };
  }) as typeof actual.api.post;
  return actual;
});

import { InstallTokenCard, McpClientsCard, RefusedChangesCard, SyncKeysCard } from '../src/pages/SecuritySettings.tsx';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  replies = {};
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
});
