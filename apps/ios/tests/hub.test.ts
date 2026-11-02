import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveHub, REFRESH_DEBOUNCE_MS } from '../src/live/hub';
import type { OmniSession } from '../src/live/session';

const BASE = 'http://omni.test';
const NOW = 1_800_000_000_000;

interface Reply {
  status?: number;
  body?: unknown;
}

function fakeFetch(reply: (path: string, method: string) => Reply) {
  const calls: string[] = [];
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    const path = pathname + search;
    calls.push(path);
    requests.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const r = reply(path, init.method);
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return {
      status: r.status ?? 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => text,
    };
  };
  return { fetch, calls, requests };
}

interface FakeConn {
  url: string;
  sink: SSESink;
  closed: boolean;
}

/** Records every stream connection the hub opens, so a test can drive each one. */
function fakeTransport() {
  const conns: FakeConn[] = [];
  const transport: SSETransport = (request, sink): SSEConnection => {
    const conn: FakeConn = { url: request.url, sink, closed: false };
    conns.push(conn);
    return {
      close() {
        conn.closed = true;
      },
    };
  };
  const feeds = () => conns.filter((c) => new URL(c.url).pathname === '/api/feed' && !c.closed);
  const threadStreams = (threadId: string) =>
    conns.filter((c) => new URL(c.url).pathname === `/api/threads/${threadId}/stream` && !c.closed);
  return { transport, conns, feeds, threadStreams };
}

const frame = (value: unknown) => ({ event: 'message', data: JSON.stringify(value) });
const channel = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, kind: 'client', archived: 0, running: 0, ...over });
const threadDetail = (over: Record<string, unknown> = {}) => ({
  thread: { id: 't1', channel_id: 'c', title: 'Fix build', status: 'running', updated_at: '', created_at: '' },
  channel: { id: 'c', name: 'Client' },
  events: [{ id: 1, thread_id: 't1', kind: 'user', payload: JSON.stringify({ text: 'hi' }), created_at: '' }],
  history: { from: 1, to: null, results_below: 0 },
  artifacts: [],
  children: [],
  parent: null,
  pending: [],
  live: false,
  ...over,
});

function session(over: Partial<OmniSession> = {}): OmniSession {
  return {
    serverUrl: BASE,
    token: async () => 'token',
    refreshAuth: async () => false,
    ...over,
  };
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('channel list', () => {
  it('loads the channels when the hub opens and stamps the load time', async () => {
    const { fetch, calls } = fakeFetch((path) => (path === '/api/channels' ? { body: [channel('conductor', { kind: 'system' })] } : {}));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch, now: () => NOW });
    await settle();
    expect(calls).toContain('/api/channels');
    expect(hub.channels.get()).toMatchObject({ loading: false, error: null, loadedAt: NOW });
    expect(hub.channels.get().channels?.map((c) => c.id)).toEqual(['conductor']);
    hub.close();
  });

  it('refetches once after a burst of thread changes, not once per message', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const before = calls.length;
    await settle(); // the feed opens on its first connection
    const [feed] = t.feeds();
    feed?.sink.open();
    feed?.sink.message(frame({ type: 'thread' }));
    feed?.sink.message(frame({ type: 'thread' }));
    feed?.sink.message(frame({ type: 'tasks' }));
    await settle(REFRESH_DEBOUNCE_MS - 1);
    expect(calls.length).toBe(before);
    await settle(1);
    expect(calls.filter((p) => p === '/api/channels')).toHaveLength(2);
    hub.close();
  });

  it('does not refetch for usage or mod lines', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const before = calls.length;
    const [feed] = t.feeds();
    feed?.sink.open();
    feed?.sink.message(frame({ type: 'usage' }));
    feed?.sink.message(frame({ type: 'mods' }));
    await settle(REFRESH_DEBOUNCE_MS * 5);
    expect(calls.length).toBe(before);
    hub.close();
  });

  it('refetches after the feed reconnects, because the feed keeps no replay', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const [first] = t.feeds();
    first?.sink.open();
    const asked = (path: string) => calls.filter((p) => p === path).length;
    const channelsBefore = asked('/api/channels');
    const needsBefore = asked('/api/needs-you');
    first?.sink.error({});
    await settle(1_000);
    const [second] = t.feeds();
    second?.sink.open();
    await settle();
    expect(asked('/api/channels')).toBe(channelsBefore + 1);
    expect(asked('/api/needs-you')).toBe(needsBefore + 1);
    hub.close();
  });

  it('retries once with fresh credentials when a request is refused', async () => {
    let attempts = 0;
    const refreshAuth = vi.fn(async () => true);
    const { fetch, calls } = fakeFetch(() => {
      attempts += 1;
      return attempts === 1 ? { status: 401, body: { error: 'expired' } } : { body: [channel('c')] };
    });
    const hub = createLiveHub({ session: session({ refreshAuth }), transport: fakeTransport().transport, fetch });
    await settle();
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(calls.filter((p) => p === '/api/channels')).toHaveLength(2);
    expect(hub.channels.get().channels?.map((c) => c.id)).toEqual(['c']);
    hub.close();
  });

  it('runs a one-off request with the same retry, and refuses when unpaired', async () => {
    let searches = 0;
    const refreshAuth = vi.fn(async () => true);
    const { fetch } = fakeFetch((path) => {
      if (!path.startsWith('/api/search')) return { body: [] };
      searches += 1;
      return searches === 1 ? { status: 401, body: { error: 'expired' } } : { body: [{ thread_id: 't1' }] };
    });
    const hub = createLiveHub({ session: session({ refreshAuth }), transport: fakeTransport().transport, fetch });
    await settle();
    expect(await hub.request((api) => api.search('fix'))).toEqual([{ thread_id: 't1' }]);
    expect(refreshAuth).toHaveBeenCalledOnce();
    hub.close();

    const unpaired = createLiveHub({ session: session({ serverUrl: null }), transport: fakeTransport().transport, fetch });
    await expect(unpaired.request((api) => api.search('fix'))).rejects.toThrow('Not paired');
    unpaired.close();
  });

  it('keeps the last list on screen when a refetch fails', async () => {
    let fail = false;
    const { fetch } = fakeFetch(() => (fail ? { status: 500, body: { error: 'down' } } : { body: [channel('kept')] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    fail = true;
    await hub.refreshChannels();
    expect(hub.channels.get()).toMatchObject({ error: 'down', loading: false });
    expect(hub.channels.get().channels?.map((c) => c.id)).toEqual(['kept']);
    hub.close();
  });
});

describe('folder collapse', () => {
  it('keeps a folder closed on a list fetched before the server answered the PATCH', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const json = (body: unknown) => ({
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(body),
    });
    const list = [channel('c', { folders: [{ id: 'f1', collapsed: 0, count: 0, running: 0, threads: [] }] })];
    const fetch: Fetch = async (_url, init) => {
      if (init?.method === 'PATCH') {
        await held;
        return json({ id: 'f1', collapsed: 1 });
      }
      return json(list);
    };
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    const collapsed = () => hub.channels.get().channels?.[0]?.folders?.[0]?.collapsed;
    const toggled = hub.setFolderCollapsed('f1', true);
    expect(collapsed()).toBe(1);
    await hub.refreshChannels();
    expect(collapsed()).toBe(1);
    release();
    expect(await toggled).toBeNull();
    hub.close();
  });
});

describe('link and background', () => {
  it('reads live once the feed is open, pauses in the background and recovers on return', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const [feed] = t.feeds();
    feed?.sink.open();
    expect(hub.link.get()).toEqual({ kind: 'live' });

    hub.setForeground(false);
    expect(hub.link.get()).toEqual({ kind: 'paused' });
    expect(t.feeds()).toHaveLength(0);

    const before = calls.length;
    hub.setForeground(true);
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    t.feeds()[0]?.sink.open();
    expect(hub.link.get()).toEqual({ kind: 'live' });
    hub.close();
  });

  it('shows Offline, retrying after the second failed attempt', async () => {
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: fakeFetch(() => ({ body: [] })).fetch });
    await settle();
    t.feeds()[0]?.sink.error({});
    await settle(1_000);
    t.feeds()[0]?.sink.error({});
    expect(hub.link.get()).toEqual({ kind: 'reconnecting', attempt: 2 });
    hub.close();
  });

  it('stays unpaired with no server: no requests, no streams, no data', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session({ serverUrl: null }), transport: t.transport, fetch });
    await hub.refreshChannels();
    await settle(REFRESH_DEBOUNCE_MS * 2);
    expect(hub.link.get()).toEqual({ kind: 'unpaired' });
    expect(hub.channels.get().channels).toBeNull();
    expect(calls).toEqual([]);
    expect(t.conns).toEqual([]);
    hub.close();
  });
});

describe('open thread', () => {
  it('shows the bounded history, then applies streamed rows and status changes', async () => {
    const t = fakeTransport();
    const { fetch } = fakeFetch((path) => (path.split('?')[0] === '/api/threads/t1' ? { body: threadDetail() } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    const live = hub.openThread('t1');
    await settle();

    expect(live.view.get()).toMatchObject({ status: 'ready', thread: { title: 'Fix build', status: 'running' } });
    expect(live.view.get().rows.map((r) => r.id)).toEqual([1]);

    const [stream] = t.threadStreams('t1');
    expect(stream?.url).toContain('after=1');
    stream?.sink.open();
    stream?.sink.message(frame({ id: 2, thread_id: 't1', kind: 'assistant_text', payload: JSON.stringify({ text: 'hello' }), created_at: '' }));
    expect(live.view.get().rows.map((r) => r.id)).toEqual([1, 2]);

    stream?.sink.message(frame({ kind: 'thread', thread: { id: 't1', channel_id: 'c', title: 'Fix build', status: 'done' }, pending: [], live: false }));
    expect(live.view.get().thread?.status).toBe('done');
    t.feeds()[0]?.sink.open();
    expect(hub.link.get()).toEqual({ kind: 'live' });
    live.close();
    hub.close();
  });

  it('reports a thread the server does not have as missing', async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: { error: 'not found' } }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('gone');
    await settle();
    expect(live.view.get().status).toBe('missing');
    live.close();
    hub.close();
  });
});

describe('thread changes made in the app', () => {
  it('sends a request with the session and retries once with fresh credentials after a 401', async () => {
    let attempts = 0;
    const refreshAuth = vi.fn(async () => true);
    const { fetch, calls } = fakeFetch((path) => {
      if (path !== '/api/threads/t1') return { body: [] };
      attempts += 1;
      return attempts === 1 ? { status: 401, body: { error: 'expired' } } : { body: { id: 't1', pinned_at: 'now' } };
    });
    const hub = createLiveHub({ session: session({ refreshAuth }), transport: fakeTransport().transport, fetch });
    await settle();
    const thread = await hub.request((api) => api.setPinned('t1', true));
    expect(thread).toMatchObject({ id: 't1', pinned_at: 'now' });
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(calls.filter((p) => p === '/api/threads/t1')).toHaveLength(2);
    hub.close();
  });

  it('puts the changed thread into the open thread and refetches the lists', async () => {
    const { fetch, calls } = fakeFetch((path) => (path.split('?')[0] === '/api/threads/t1' ? { body: threadDetail() } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    const before = calls.filter((p) => p === '/api/channels').length;

    const changed = { ...threadDetail().thread, title: 'Renamed', pinned_at: '2026-11-02T10:00:00Z' };
    hub.applyThread(changed as never);
    expect(live.view.get().thread).toMatchObject({ title: 'Renamed', pinned_at: '2026-11-02T10:00:00Z' });
    await settle();
    expect(calls.filter((p) => p === '/api/channels').length).toBe(before + 1);
    live.close();
    hub.close();
  });

  it('reads the handoff and takeover from the detail and the stream, and clears them when the stream stops sending them', async () => {
    const t = fakeTransport();
    const takeover = { from: { id: 'm2', name: 'Studio' }, to: { id: 'm1', name: 'Laptop' }, running: true, refused: null };
    const handoff = { id: 'h1', from: { id: 'm1', name: 'Laptop' }, to: { id: 'm2', name: 'Studio' }, outgoing: true, at: '', state: { phase: 'offered', stale: false }, leftBehind: null, idle: false, requested: false };
    const { fetch } = fakeFetch((path) => (path.split('?')[0] === '/api/threads/t1' ? { body: threadDetail({ takeover, blocked: 'Running on Studio.' }) } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    expect(live.view.get()).toMatchObject({ takeover, handoff: null, blocked: 'Running on Studio.' });

    const [stream] = t.threadStreams('t1');
    stream?.sink.open();
    stream?.sink.message(frame({ kind: 'thread', thread: { id: 't1', channel_id: 'c', title: 'Fix build', status: 'running' }, pending: [], live: true, handoff }));
    expect(live.view.get()).toMatchObject({ handoff, takeover: null, blocked: null });
    live.close();
    hub.close();
  });

  it('puts the answer of a handoff into the open thread at once', async () => {
    const { fetch } = fakeFetch((path) => (path.split('?')[0] === '/api/threads/t1' ? { body: threadDetail() } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    const handoff = { id: 'h1', state: { phase: 'preparing', step: 'stopping' } };
    hub.applyHandoff({ ...threadDetail().thread, status: 'stopped' } as never, handoff as never);
    expect(live.view.get()).toMatchObject({ thread: { status: 'stopped' }, handoff, takeover: null });
    hub.applyHandoff({ ...threadDetail().thread, id: 'other' } as never, null);
    expect(live.view.get().handoff).toEqual(handoff);
    live.close();
    hub.close();
  });

  it('leaves other open threads alone', async () => {
    const { fetch } = fakeFetch((path) => (path.split('?')[0] === '/api/threads/t1' ? { body: threadDetail() } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    hub.applyThread({ ...threadDetail().thread, id: 'other', title: 'Not this one' } as never);
    expect(live.view.get().thread?.title).toBe('Fix build');
    live.close();
    hub.close();
  });
});

const waiting = (id: string, over: Record<string, unknown> = {}) => ({
  thread: { id, channel_id: 'c', title: `Thread ${id}`, status: 'done', created_at: '', updated_at: '' },
  result: { uid: `result-${id}`, status: 'done', event_uid: null, at: '' },
  blockers: [],
  at: '',
  ...over,
});
const inbox = (items: ReturnType<typeof waiting>[]) => ({
  items,
  unread: items.filter((i) => i.result).length,
  blocked: items.filter((i) => i.blockers.length).length,
});

describe('needs you', () => {
  it('loads when the hub opens, and once more after a burst of needs_you messages', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch((path) => (path === '/api/needs-you' ? { body: inbox([waiting('a')]) } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    expect(hub.needsYou.get().data?.items.map((i) => i.thread.id)).toEqual(['a']);

    const asked = () => calls.filter((p) => p === '/api/needs-you').length;
    const before = asked();
    const [feed] = t.feeds();
    feed?.sink.open();
    feed?.sink.message(frame({ type: 'needs_you', thread_id: 'a' }));
    feed?.sink.message(frame({ type: 'needs_you', thread_id: 'a' }));
    feed?.sink.message(frame({ type: 'needs_you', thread_id: 'b' }));
    await settle();
    expect(asked() - before).toBeLessThanOrEqual(2);
    expect(asked()).toBeGreaterThan(before);
    hub.close();
  });

  it('keeps the last inbox on screen when a load fails', async () => {
    let fail = false;
    const { fetch } = fakeFetch((path) => (path === '/api/needs-you' ? (fail ? { status: 500, body: { error: 'down' } } : { body: inbox([waiting('a')]) }) : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    fail = true;
    await hub.refreshNeedsYou();
    expect(hub.needsYou.get().error).toBe('down');
    expect(hub.needsYou.get().data?.items).toHaveLength(1);
    hub.close();
  });

  it('drops a read result at once, posts the read, then loads what the server says', async () => {
    let unread = true;
    const { fetch, requests } = fakeFetch((path, method) => {
      if (path === '/api/needs-you/read') {
        unread = false;
        return { body: { thread_id: 'a', item: null } };
      }
      if (path === '/api/needs-you' && method === 'GET') return { body: inbox(unread ? [waiting('a')] : []) };
      return { body: [] };
    });
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    const done = hub.markResultRead('result-a');
    expect(hub.needsYou.get().data?.items).toEqual([]);
    await done;
    expect(requests.find((r) => r.path === '/api/needs-you/read')).toMatchObject({ method: 'POST', body: { uid: 'result-a' } });
    expect(hub.needsYou.get().data).toMatchObject({ items: [], unread: 0 });
    hub.close();
  });

  it('keeps a blocker when its result is read', async () => {
    const blocked = waiting('a', { blockers: [{ kind: 'setup', detail: null, count: 1 }] });
    const { fetch } = fakeFetch((path) => (path === '/api/needs-you' ? { body: inbox([blocked]) } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    void hub.markResultRead('result-a');
    expect(hub.needsYou.get().data).toMatchObject({ unread: 0, blocked: 1 });
    expect(hub.needsYou.get().data?.items[0]?.result).toBeNull();
    hub.close();
  });

  it('does not let a load that began before the read bring the result back', async () => {
    let read = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let gets = 0;
    const base = fakeFetch((path, method) => {
      if (path === '/api/needs-you/read') {
        read = true;
        return { body: { thread_id: 'a', item: null } };
      }
      if (path === '/api/needs-you' && method === 'GET') return { body: inbox(read ? [] : [waiting('a')]) };
      return { body: [] };
    });
    const slow: Fetch = async (url, init) => {
      const reply = await base.fetch(url, init);
      if (new URL(url).pathname === '/api/needs-you' && init.method === 'GET' && ++gets === 1) await gate;
      return reply;
    };
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: slow });
    await settle();
    const seen: number[] = [];
    hub.needsYou.subscribe(() => seen.push(hub.needsYou.get().data?.items.length ?? -1));
    const done = hub.markResultRead('result-a');
    release();
    await done;
    await settle();
    expect(seen).not.toContain(1);
    expect(hub.needsYou.get().data?.items).toEqual([]);
    hub.close();
  });
});

describe('answers and card buttons on an open thread', () => {
  const answer = [{ selected: ['Ship it'], other: null }];

  it('sends the answers to the question and loads Needs you again', async () => {
    const { fetch, requests } = fakeFetch((path, method) => {
      if (path.split('?')[0] === '/api/threads/t1') return { body: threadDetail() };
      if (method === 'POST') return { body: { state: 'answered', via: 'tool' } };
      return { body: [] };
    });
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    const before = requests.filter((r) => r.path === '/api/needs-you').length;
    await expect(live.answerQuestion('q1', answer)).resolves.toEqual({ state: 'answered', via: 'tool' });
    await settle();
    expect(requests.find((r) => r.path === '/api/threads/t1/questions/q1/answer')).toMatchObject({ method: 'POST', body: { answers: answer } });
    expect(requests.filter((r) => r.path === '/api/needs-you').length).toBeGreaterThan(before);
    live.close();
    hub.close();
  });

  it('rejects with the 409 and its state when the question was answered already', async () => {
    const { fetch } = fakeFetch((path, method) => {
      if (path.split('?')[0] === '/api/threads/t1') return { body: threadDetail() };
      if (method === 'POST') return { status: 409, body: { error: 'These questions were already answered.', state: 'answered' } };
      return { body: [] };
    });
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    await expect(live.answerQuestion('q1', answer)).rejects.toMatchObject({ failure: { kind: 'http', status: 409, body: { state: 'answered' } } });
    live.close();
    hub.close();
  });

  it('shows the thread and pending list a card button answers with', async () => {
    const limited = { id: 't1', channel_id: 'c', title: 'Fix build', status: 'stopped', limit_state: 'limited', limit_resets_at: null, harness: 'claude-code' };
    const { fetch, requests } = fakeFetch((path, method) => {
      if (path.split('?')[0] === '/api/threads/t1') return { body: threadDetail({ thread: limited }) };
      if (path === '/api/threads/t1/limit/resume' && method === 'POST') return { body: { thread: { ...limited, status: 'running', limit_state: null }, pending: [] } };
      return { body: [] };
    });
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    expect(live.view.get().thread?.limit_state).toBe('limited');
    await live.act({ kind: 'limit', action: 'resume' });
    expect(requests.some((r) => r.path === '/api/threads/t1/limit/resume' && r.method === 'POST')).toBe(true);
    expect(live.view.get().thread).toMatchObject({ status: 'running', limit_state: null });
    live.close();
    hub.close();
  });

  it('leaves the thread as it was and rejects when a card button fails', async () => {
    const { fetch } = fakeFetch((path, method) => {
      if (path.split('?')[0] === '/api/threads/t1') return { body: threadDetail() };
      if (method === 'POST') return { status: 409, body: { error: 'It did not say when it resets.' } };
      return { body: [] };
    });
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('t1');
    await settle();
    const before = live.view.get().thread;
    await expect(live.act({ kind: 'limit', action: 'schedule' })).rejects.toThrow('It did not say when it resets.');
    expect(live.view.get().thread).toBe(before);
    live.close();
    hub.close();
  });
});

describe('files', () => {
  it('asks the server for its upload limit once and keeps the answer', async () => {
    const { fetch, calls } = fakeFetch((path) => (path === '/api/status' ? { body: { maxUploadMb: 40 } } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    expect(await hub.uploadLimitMb()).toBe(40);
    expect(await hub.uploadLimitMb()).toBe(40);
    expect(calls.filter((p) => p === '/api/status')).toHaveLength(1);
    hub.close();
  });

  it('falls back to 25 MB when the server does not say, and asks again next time', async () => {
    let ok = false;
    const { fetch, calls } = fakeFetch((path) => (path === '/api/status' ? (ok ? { body: { maxUploadMb: 50 } } : { status: 500, body: { error: 'down' } }) : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    const asked = () => calls.filter((p) => p === '/api/status').length;
    const loaded = asked(); // Activity's own load of the status failed too
    expect(await hub.uploadLimitMb()).toBe(25);
    ok = true;
    expect(await hub.uploadLimitMb()).toBe(50);
    expect(asked() - loaded).toBe(2);
    hub.close();
  });

  it('gives a file’s address with the bearer token, and the download form on request', async () => {
    const { fetch } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    const view = await hub.fileSource('t1', 'my photo.png');
    expect(view?.headers).toEqual({ Authorization: 'Bearer token' });
    expect(view?.uri).toBe(`${BASE}/api/threads/t1/uploads/my%20photo.png`);
    expect((await hub.fileSource('t1', 'a.pdf', { download: true }))?.uri).toBe(`${BASE}/api/threads/t1/uploads/a.pdf?download=1`);
    hub.close();
  });

  it('gives no address without a token', async () => {
    const { fetch } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session({ token: async () => null }), transport: fakeTransport().transport, fetch });
    await settle();
    expect(await hub.fileSource('t1', 'a.png')).toBeNull();
    hub.close();
  });
});
