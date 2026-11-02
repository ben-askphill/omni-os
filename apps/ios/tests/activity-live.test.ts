import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveHub } from '../src/live/hub';
import type { OmniSession } from '../src/live/session';

const BASE = 'http://omni.test';
const NOW = 1_800_000_000_000;

interface Reply {
  status?: number;
  body?: unknown;
}

/** Answers each request by its path, now or once `reply`'s promise settles. `calls` records every path, in order. */
function fakeFetch(reply: (path: string) => Reply | Promise<Reply>) {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    const { pathname, search } = new URL(url);
    const path = pathname + search;
    calls.push(path);
    const r = await reply(path);
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return {
      status: r.status ?? 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => text,
    };
  };
  return { fetch, calls, count: (path: string) => calls.filter((p) => p === path).length };
}

function fakeTransport() {
  const conns: { url: string; sink: SSESink; closed: boolean }[] = [];
  const transport: SSETransport = (request, sink): SSEConnection => {
    const conn = { url: request.url, sink, closed: false };
    conns.push(conn);
    return {
      close() {
        conn.closed = true;
      },
    };
  };
  const feed = () => conns.find((c) => new URL(c.url).pathname === '/api/feed' && !c.closed);
  return { transport, feed };
}

const frame = (value: unknown) => ({ event: 'message', data: JSON.stringify(value) });
const session = (): OmniSession => ({ serverUrl: BASE, token: async () => 'token', refreshAuth: async () => false });
const thread = (id: string, updated_at: string, over: Record<string, unknown> = {}) => ({ id, channel_id: 'c', title: id, status: 'running', archived: 0, updated_at, ...over });
const needs = (...ids: string[]) => ({ items: ids.map((id) => ({ thread: thread(id, ''), result: null, blockers: [], at: '' })), unread: 0, blocked: 0 });

/** The loads Activity and the inbox make, answered from `server`, which a test changes between loads. */
function activityServer() {
  const server = {
    needsYou: needs('ask') as unknown,
    recent: [thread('b', '2026-11-02T10:00:00Z'), thread('a', '2026-11-02T09:00:00Z')] as unknown[],
    pinned: [] as unknown[],
    usage: { 'claude-code': { five_hour: { utilization: 40, resetsAt: 0 } } } as unknown,
    fail: new Set<string>(),
  };
  const reply = (path: string): Reply => {
    const route = path.split('?')[0]!;
    if (server.fail.has(route)) return { status: 500, body: { error: 'down' } };
    if (route === '/api/needs-you') return { body: server.needsYou };
    if (route === '/api/recent') return { body: server.recent };
    if (route === '/api/pinned') return { body: server.pinned };
    if (route === '/api/status') return { body: { usage: server.usage, running: 0 } };
    return { body: [] };
  };
  return { server, reply };
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

describe('activity', () => {
  it('loads needs you, the 60 latest threads, pins and usage when the hub opens', async () => {
    const { reply } = activityServer();
    const { fetch, calls } = fakeFetch(reply);
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch, now: () => NOW });
    await settle();
    expect(calls).toEqual(expect.arrayContaining(['/api/needs-you', '/api/recent?limit=60', '/api/pinned', '/api/status']));
    const s = hub.activity.get();
    expect(s).toMatchObject({ loading: false, error: null, loadedAt: NOW, pinned: [] });
    expect(hub.needsYou.get().data?.items.map((i) => i.thread.id)).toEqual(['ask']);
    expect(s.recent?.map((t) => t.id)).toEqual(['b', 'a']);
    expect(s.usage['claude-code']?.five_hour?.utilization).toBe(40);
    hub.close();
  });

  it('puts a changed thread in its place by activity, drops an archived one, and rechecks needs you and pins', async () => {
    const { reply } = activityServer();
    const t = fakeTransport();
    const { fetch, count } = fakeFetch(reply);
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    t.feed()?.sink.open();

    t.feed()?.sink.message(frame({ type: 'thread', thread: thread('a', '2026-11-02T11:00:00Z', { status: 'done' }) }));
    expect(hub.activity.get().recent?.map((r) => [r.id, r.status])).toEqual([
      ['a', 'done'],
      ['b', 'running'],
    ]);
    t.feed()?.sink.message(frame({ type: 'thread', thread: thread('new', '2026-11-02T12:00:00Z') }));
    t.feed()?.sink.message(frame({ type: 'thread', thread: thread('b', '2026-11-02T12:30:00Z', { archived: 1 }) }));
    expect(hub.activity.get().recent?.map((r) => r.id)).toEqual(['new', 'a']);

    await settle();
    expect(count('/api/needs-you')).toBe(3);
    expect(count('/api/pinned')).toBe(3);
    hub.close();
  });

  it('runs one needs you load at a time, and one more for any number of changes meanwhile', async () => {
    const { reply } = activityServer();
    let release = () => {};
    let hold = false;
    const { fetch, count } = fakeFetch((path) =>
      hold && path === '/api/needs-you' ? new Promise<Reply>((done) => (release = () => done(reply(path)))) : reply(path),
    );
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    t.feed()?.sink.open();
    const before = count('/api/needs-you');

    hold = true;
    for (let i = 0; i < 4; i++) t.feed()?.sink.message(frame({ type: 'needs_you', thread_id: 'ask' }));
    await settle();
    expect(count('/api/needs-you')).toBe(before + 1);
    hold = false;
    release();
    await settle();
    expect(count('/api/needs-you')).toBe(before + 2);
    hub.close();
  });

  it("applies a usage line to its harness, Claude's when it names none", async () => {
    const { reply } = activityServer();
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: fakeFetch(reply).fetch });
    await settle();
    t.feed()?.sink.open();
    t.feed()?.sink.message(frame({ type: 'usage', usage: { five_hour: { utilization: 80, resetsAt: 0 } } }));
    t.feed()?.sink.message(frame({ type: 'usage', harness: 'cursor', usage: { monthly: { utilization: 0.5, resetsAt: 0 } } }));
    expect(hub.activity.get().usage).toEqual({
      'claude-code': { five_hour: { utilization: 80, resetsAt: 0 } },
      cursor: { monthly: { utilization: 0.5, resetsAt: 0 } },
    });
    hub.close();
  });

  it('loads everything again after the feed reconnects and on return to the front', async () => {
    const { server, reply } = activityServer();
    const t = fakeTransport();
    const { fetch, count } = fakeFetch(reply);
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    t.feed()?.sink.open();
    server.pinned = [{ ...thread('p', ''), pinned_at: '' }];
    t.feed()?.sink.error({});
    await settle(1_000);
    t.feed()?.sink.open();
    await settle();
    expect(count('/api/recent?limit=60')).toBe(2);
    expect(hub.activity.get().pinned.map((p) => p.id)).toEqual(['p']);

    hub.setForeground(false);
    hub.setForeground(true);
    await settle();
    expect(count('/api/status')).toBe(3);
    hub.close();
  });

  it('keeps what is on screen when a load fails, and says so', async () => {
    const { server, reply } = activityServer();
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch: fakeFetch(reply).fetch, now: () => NOW });
    await settle();
    server.fail.add('/api/recent');
    server.needsYou = needs('ask', 'more');
    await hub.refreshActivity();
    await hub.refreshNeedsYou();
    const s = hub.activity.get();
    expect(s).toMatchObject({ error: 'down', loading: false, loadedAt: NOW });
    expect(s.recent?.map((r) => r.id)).toEqual(['b', 'a']);
    expect(hub.needsYou.get().data?.items.map((i) => i.thread.id)).toEqual(['ask', 'more']);

    server.fail.clear();
    await hub.refreshActivity();
    expect(hub.activity.get().error).toBeNull();
    hub.close();
  });

  it('makes no request with no server paired', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: { ...session(), serverUrl: null }, transport: fakeTransport().transport, fetch });
    await hub.refreshActivity();
    expect(calls).toEqual([]);
    expect(hub.activity.get()).toMatchObject({ recent: null, loading: false });
    hub.close();
  });
});
