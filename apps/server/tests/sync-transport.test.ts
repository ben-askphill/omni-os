import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelayTransport, isSignedOut, relayAuth, RelayRefusedError } from '../sync/transport.ts';

// The Cloudflare relay's transport (apps/relay), against a fake fetch and a fake WebSocket. Nothing reaches the network.

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(reply: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
    calls.push(c);
    return reply(c);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const TOKEN = 'omni_r_dXNlcl8x.' + 'a'.repeat(64);
const relay = (f: typeof fetch, extra = {}) => createRelayTransport({ url: 'https://relay.example.dev/', token: TOKEN, fetch: f, ...extra });

describe('relay transport', () => {
  it('pushes and pulls the change log with the token, and normalizes times', async () => {
    const f = fakeFetch((c) =>
      c.method === 'POST'
        ? Response.json({ ok: true })
        : Response.json({ changes: [{ seq: '3', machine_id: 'b', entity: 'thread', entity_id: 't', op: 'upsert', data: { a: 1 }, ts: '2026-11-01T12:00:00Z' }] }),
    );
    const t = relay(f.fn);
    const change = { machine_id: 'a', entity: 'thread' as const, entity_id: 't', op: 'upsert' as const, data: { title: 'nul\u0000' }, ts: '2026-11-01T12:00:00.000Z' };
    await t.push([change]);
    expect(f.calls[0]).toMatchObject({ url: 'https://relay.example.dev/v1/changes', method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    // No Postgres any more: the data goes as it is.
    expect(JSON.parse(f.calls[0].body as string)).toEqual({ changes: [change] });
    const got = await t.pull({ after: 2, excludeMachine: 'a', limit: 200 });
    expect(f.calls[1].url).toBe('https://relay.example.dev/v1/changes?after=2&exclude=a&limit=200');
    expect(got).toEqual([{ seq: 3, machine_id: 'b', entity: 'thread', entity_id: 't', op: 'upsert', data: { a: 1 }, ts: '2026-11-01T12:00:00.000Z' }]);
  });

  it('reads Connect registrations with the relay token, without claiming they contain token bindings', async () => {
    const f = fakeFetch(() => Response.json({ machines: [{ id: 'paired-b', name: 'B', hostname: 'b.example.dev' }] }));
    expect(await relay(f.fn).pairedMachines!()).toEqual(new Set(['paired-b']));
    expect(f.calls).toEqual([expect.objectContaining({ url: 'https://relay.example.dev/v1/connect/machines', method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } })]);
  });

  it.each([{}, { machines: null }, { machines: [{}] }, { machines: [{ id: '' }] }])('fails closed on a malformed registration response %j', async (body) => {
    await expect(relay(fakeFetch(() => Response.json(body)).fn).pairedMachines!()).rejects.toThrow('Invalid paired machines response');
  });

  it.each([401, 404, 503])('fails closed when registrations return HTTP %s', async (status) => {
    await expect(relay(fakeFetch(() => Response.json({ error: 'unavailable' }, { status })).fn).pairedMachines!()).rejects.toThrow();
  });

  it('a 401 is signed out, which takes a new sign-in; any other failure is retried', async () => {
    const dead = relay(fakeFetch(() => Response.json({ error: 'This machine is signed out of the relay', code: 'signed_out' }, { status: 401 })).fn);
    const out = await dead.pull({ after: 0, excludeMachine: 'a', limit: 1 }).catch((e) => e);
    expect(isSignedOut(out)).toBe(true);
    expect(out.message).toMatch(/sign in again/);

    const down = relay(fakeFetch(() => Response.json({ error: 'boom' }, { status: 500 })).fn);
    const err = await down.push([]).catch((e) => e);
    expect(isSignedOut(err)).toBe(false);
    expect(err.message).toBe('push failed: boom');

    const offline = relay((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect((await offline.hasObject('blobs/x').catch((e) => e)).message).toMatch(/relay unreachable/);
  });

  it('puts, gets and checks files by path, each part escaped', async () => {
    const stored = new Map<string, Uint8Array>();
    const f = fakeFetch(async (c) => {
      const key = c.url.replace('https://relay.example.dev/v1/objects/', '');
      if (c.method === 'PUT') return stored.set(key, new Uint8Array(c.body as Uint8Array)), Response.json({ ok: true });
      const body = stored.get(key);
      if (!body) return new Response(null, { status: 404 });
      return new Response(c.method === 'HEAD' ? null : (body as BodyInit));
    });
    const t = relay(f.fn);
    await t.putObject('sessions/claude/a b.jsonl', new TextEncoder().encode('{"x":1}\n'), 'application/x-ndjson');
    expect(f.calls[0]).toMatchObject({ url: 'https://relay.example.dev/v1/objects/sessions/claude/a%20b.jsonl', headers: { 'content-type': 'application/x-ndjson' } });
    expect(new TextDecoder().decode((await t.getObject('sessions/claude/a b.jsonl'))!)).toBe('{"x":1}\n');
    expect(await t.hasObject('sessions/claude/a b.jsonl')).toBe(true);
    expect(await t.getObject('blobs/missing')).toBeNull();
    expect(await t.hasObject('blobs/missing')).toBe(false);
  });
});

// ---------- the WebSocket ----------

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

describe('relay transport subscribe', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeSocket.all = [];
  });

  const subscribe = (onRemote: () => void) =>
    relay(fakeFetch(() => Response.json({})).fn, { WebSocket: FakeSocket as unknown as typeof WebSocket }).subscribe!('mac-a', onRemote);

  it('carries the token as a protocol, and syncs on connect and on each nudge', () => {
    const onRemote = vi.fn();
    const off = subscribe(onRemote);
    const [ws] = FakeSocket.all;
    expect(ws.url).toBe('wss://relay.example.dev/v1/subscribe?exclude=mac-a');
    expect(ws.protocols).toEqual(['omni-relay', `bearer.${TOKEN}`]);
    ws.onopen!();
    expect(onRemote).toHaveBeenCalledTimes(1);
    ws.onmessage!({ data: 'changes' });
    ws.onmessage!({ data: 'pong' });
    expect(onRemote).toHaveBeenCalledTimes(2);
    off();
    expect(ws.closed).toBe(true);
  });

  it('opens again after a drop, backing off, and stops for good on unsubscribe', () => {
    vi.useFakeTimers();
    const off = subscribe(() => {});
    FakeSocket.all[0].close();
    vi.advanceTimersByTime(4_999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].close();
    vi.advanceTimersByTime(9_999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    off();
    vi.advanceTimersByTime(10 * 60_000);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('pings, and a link silent too long counts as dead and opens again', () => {
    vi.useFakeTimers();
    const off = subscribe(() => {});
    const [ws] = FakeSocket.all;
    ws.onopen!();
    vi.advanceTimersByTime(30_000);
    expect(ws.sent).toEqual(['ping']);
    ws.onmessage!({ data: 'pong' });
    vi.advanceTimersByTime(90_000);
    expect(ws.closed).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.all).toHaveLength(2);
    off();
  });
});

describe('relay sign-in calls', () => {
  it('checks the URL is a relay, trades an ID token, and says why it was refused', async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith('/v1/info')) return Response.json({ service: 'omni-relay', version: 1, issuer: 'https://clerk.example.dev', clientId: 'omni-app' });
      if (c.method === 'DELETE') return Response.json({ error: 'gone' }, { status: 401 });
      const { idToken } = JSON.parse(c.body as string);
      if (idToken === 'stranger') return Response.json({ error: 'x@example.com (Clerk user user_9) may not use this relay' }, { status: 403 });
      return Response.json({ token: TOKEN, user: { id: 'user_1', email: 'ben@example.com' } });
    });
    const a = relayAuth(f.fn);
    expect(await a.info('https://relay.example.dev/')).toEqual({ issuer: 'https://clerk.example.dev', clientId: 'omni-app' });
    expect(await a.exchange('https://relay.example.dev', 'id', 'Mac')).toEqual({ token: TOKEN, user: { id: 'user_1', email: 'ben@example.com' } });
    const refused = await a.exchange('https://relay.example.dev', 'stranger', 'Mac').catch((e) => e);
    expect(refused).toBeInstanceOf(RelayRefusedError);
    expect(refused).toMatchObject({ status: 403, message: expect.stringMatching(/may not use this relay/) });
    // Already signed out there is fine.
    await a.revoke('https://relay.example.dev', TOKEN);
    expect(f.calls.at(-1)).toMatchObject({ method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } });

    const notRelay = relayAuth(fakeFetch(() => new Response('<html>', { status: 200 })).fn);
    expect((await notRelay.info('https://example.com').catch((e) => e)).message).toMatch(/not an Omni relay/);
  });
});
