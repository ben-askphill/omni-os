import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveHub } from '../src/live/hub';
import { LIBRARY_DEBOUNCE_MS } from '../src/live/library';
import type { OmniSession } from '../src/live/session';

const BASE = 'http://omni.test';
const NOW = 1_800_000_000_000;

const art = (id: number, kind = 'html', over: Record<string, unknown> = {}) => ({
  id,
  thread_id: 't',
  path: `/x/${id}`,
  name: `file-${id}.${kind}`,
  kind,
  size: 10,
  url: null,
  description: null,
  created_at: '2026-11-02T09:00:00Z',
  updated_at: '2026-11-02T09:00:00Z',
  thread_title: 'T',
  channel_id: 'c',
  ...over,
});

interface Seen {
  path: string;
  authorization: string | undefined;
  accept: string | undefined;
}

/** Answers the list as JSON and `/raw` as bytes, and records what each request carried. */
function server() {
  const state = { list: [art(2), art(1)] as unknown[], fail: false };
  const seen: Seen[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ path: pathname + search, authorization: headers.authorization, accept: headers.accept });
    const base = { headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) } };
    if (pathname === '/api/artifacts') {
      return state.fail ? { ...base, status: 500, text: async () => '{"error":"down"}' } : { ...base, status: 200, text: async () => JSON.stringify(state.list) };
    }
    if (pathname.endsWith('/raw')) {
      const bytes = new TextEncoder().encode('<h1>hi</h1>');
      return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) }, text: async () => '', arrayBuffer: async () => bytes.buffer };
    }
    return { ...base, status: 200, text: async () => '[]' };
  };
  return { state, fetch, count: (path: string) => seen.filter((s) => s.path === path).length, seen };
}

function fakeTransport() {
  const conns: { url: string; sink: SSESink; closed: boolean }[] = [];
  const transport: SSETransport = (request, sink): SSEConnection => {
    const conn = { url: request.url, sink, closed: false };
    conns.push(conn);
    return { close: () => void (conn.closed = true) };
  };
  return { transport, feed: () => conns.find((c) => new URL(c.url).pathname === '/api/feed' && !c.closed) };
}

const frame = (value: unknown) => ({ event: 'message', data: JSON.stringify(value) });
const session = (): OmniSession => ({ serverUrl: BASE, token: async () => 'secret-token', refreshAuth: async () => false });
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('library', () => {
  it('loads the list when the hub opens', async () => {
    const s = server();
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: s.fetch, now: () => NOW });
    await settle();
    expect(hub.library.get()).toMatchObject({ loading: false, error: null, loadedAt: NOW });
    expect(hub.library.get().artifacts?.map((a) => a.id)).toEqual([2, 1]);
    hub.close();
  });

  it('refetches once for a burst of changed files, and not for a screenshot or a thread change', async () => {
    const s = server();
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: s.fetch });
    await settle();
    t.feed()?.sink.open();
    expect(s.count('/api/artifacts')).toBe(1);

    t.feed()?.sink.message(frame({ type: 'artifact', artifact: art(3, 'screenshot') }));
    t.feed()?.sink.message(frame({ type: 'thread', thread: { id: 'x' } }));
    await settle(LIBRARY_DEBOUNCE_MS * 2);
    expect(s.count('/api/artifacts')).toBe(1);

    s.state.list = [art(3), art(2), art(1)];
    for (let i = 0; i < 5; i++) t.feed()?.sink.message(frame({ type: 'artifact', artifact: art(3) }));
    await settle(LIBRARY_DEBOUNCE_MS - 1);
    expect(s.count('/api/artifacts')).toBe(1);
    await settle(1);
    expect(s.count('/api/artifacts')).toBe(2);
    expect(hub.library.get().artifacts?.map((a) => a.id)).toEqual([3, 2, 1]);
    hub.close();
  });

  it('loads again after the feed reconnects and on return to the front', async () => {
    const s = server();
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: s.fetch });
    await settle();
    t.feed()?.sink.open();
    t.feed()?.sink.error({});
    await settle(1_000);
    t.feed()?.sink.open();
    await settle();
    expect(s.count('/api/artifacts')).toBe(2);

    hub.setForeground(false);
    hub.setForeground(true);
    await settle();
    expect(s.count('/api/artifacts')).toBe(3);
    hub.close();
  });

  it('keeps the files on screen when a load fails, and says so', async () => {
    const s = server();
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: s.fetch, now: () => NOW });
    await settle();
    s.state.fail = true;
    await hub.refreshLibrary();
    expect(hub.library.get().error).toBe('down');
    expect(hub.library.get().artifacts?.map((a) => a.id)).toEqual([2, 1]);
    s.state.fail = false;
    await hub.refreshLibrary();
    expect(hub.library.get().error).toBeNull();
    hub.close();
  });

  it('does not refetch after the hub closes', async () => {
    const s = server();
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: s.fetch });
    await settle();
    const feed = t.feed();
    feed?.sink.open();
    feed?.sink.message(frame({ type: 'artifact', artifact: art(3) }));
    hub.close();
    await settle(LIBRARY_DEBOUNCE_MS * 2);
    expect(s.count('/api/artifacts')).toBe(1);
  });
});

describe('artifact file', () => {
  it('is fetched with the token in the hub and comes back as bytes', async () => {
    const s = server();
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: s.fetch });
    await settle();
    const file = await hub.fetchArtifactFile({ id: 2, updated_at: '2026-11-02T09:00:00Z' });
    expect(new TextDecoder().decode(file.bytes)).toBe('<h1>hi</h1>');
    const request = s.seen.find((r) => r.path.startsWith('/api/artifacts/2/raw'));
    expect(request?.authorization).toBe('Bearer secret-token');
    expect(request?.path).toBe('/api/artifacts/2/raw?v=2026-11-02T09%3A00%3A00Z');
    hub.close();
  });
});
