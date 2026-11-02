import { describe, expect, it } from 'vitest';
import { apiPath, createHttpClient, OmniHttpError, originOf, parseBaseUrl, type BaseUrl, type Fetch, type HttpFailure } from '../src/http.ts';

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string; redirect: string; signal?: AbortSignal };

const base = parseBaseUrl('http://127.0.0.1:4757') as BaseUrl;

type Reply = {
  status?: number;
  type?: string | null;
  text?: string;
  headers?: Record<string, string>;
  /** Where the platform says the answer came from, and the response type. */
  url?: string;
  responseType?: string;
};

function fake(reply: Reply | ((init: Parameters<Fetch>[1]) => Promise<never>) = {}) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect, signal: init.signal });
    if (typeof reply === 'function') return reply(init);
    const { status = 200, type = 'application/json; charset=UTF-8', text = '{}', headers = {}, url: from, responseType } = reply;
    const all: Record<string, string | null> = { 'content-type': type, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
    return { status, headers: { get: (n: string) => all[n.toLowerCase()] ?? null }, text: async () => text, url: from, type: responseType };
  };
  return { sent, fetch };
}

async function rejected(p: Promise<unknown>): Promise<OmniHttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OmniHttpError);
  return err as OmniHttpError;
}

const failure = async (p: Promise<unknown>): Promise<HttpFailure> => (await rejected(p)).failure;

describe('parseBaseUrl', () => {
  it.each([
    ['http://127.0.0.1:4747', 'http://127.0.0.1:4747'],
    ['https://mac.tail1234.ts.net/', 'https://mac.tail1234.ts.net'],
    ['  HTTPS://omni.example.com/prefix//  ', 'https://omni.example.com/prefix'],
    ['http://[::1]:4747', 'http://[::1]:4747'],
  ])('accepts %s', (input, want) => expect(parseBaseUrl(input)).toBe(want));

  it.each(['', '127.0.0.1:4747', 'ftp://host', 'http://', 'http://host?x=1', 'http://host#frag', 'http://user:pw@host', 'http://ho st'])(
    'refuses %j',
    (input) => expect(parseBaseUrl(input)).toBeNull(),
  );
});

describe('apiPath', () => {
  it('encodes each value as one path segment', () => {
    expect(apiPath`/threads/${'a/b?c d'}/uploads/${'shot #1.png'}`).toBe('/threads/a%2Fb%3Fc%20d/uploads/shot%20%231.png');
    expect(apiPath`/threads/${'t1'}/events/${42}`).toBe('/threads/t1/events/42');
  });

  it('refuses a path without a leading slash', () => {
    expect(() => apiPath`status`).toThrow(TypeError);
  });
});

describe('request', () => {
  it('sends to base/api/path with the query, the token and JSON accepted', async () => {
    const { sent, fetch } = fake();
    const http = createHttpClient({ baseUrl: parseBaseUrl('https://omni.example.com/prefix/') as BaseUrl, token: ' tok-123 ', fetch });
    await http.request('GET', apiPath`/channels/${'c 1'}/threads`, { query: { archived: '1', limit: 20, skip: undefined, q: 'a&b=c' } });
    expect(sent).toEqual([
      {
        url: 'https://omni.example.com/prefix/api/channels/c%201/threads?archived=1&limit=20&q=a%26b%3Dc',
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer tok-123' },
        body: undefined,
        redirect: 'manual',
        signal: undefined,
      },
    ]);
  });

  it('passes an already encoded query string through', async () => {
    const { sent, fetch } = fake();
    await createHttpClient({ baseUrl: base, token: null, fetch }).request('GET', apiPath`/threads/${'t1'}/events`, { query: 'at=5&before=9' });
    expect(sent[0].url).toBe('http://127.0.0.1:4757/api/threads/t1/events?at=5&before=9');
  });

  it('sends no Authorization header without a token', async () => {
    for (const token of [null, '', '   ']) {
      const { sent, fetch } = fake();
      await createHttpClient({ baseUrl: base, token, fetch }).request('GET', apiPath`/auth/methods`);
      expect(sent[0].headers).toEqual({ accept: 'application/json' });
    }
  });

  it('sends a body as JSON with its content type, and no content type without one', async () => {
    const { sent, fetch } = fake();
    const http = createHttpClient({ baseUrl: base, token: 't', fetch });
    await http.request('POST', apiPath`/threads/${'t1'}/messages`, { body: { prompt: 'hi', mode: 'steer' } });
    await http.request('POST', apiPath`/threads/${'t1'}/stop`);
    expect(sent[0]).toMatchObject({ method: 'POST', body: '{"prompt":"hi","mode":"steer"}' });
    expect(sent[0].headers['content-type']).toBe('application/json');
    expect(sent[1].body).toBeUndefined();
    expect(sent[1].headers).not.toHaveProperty('content-type');
  });

  it('resolves with the JSON, or what parse makes of it', async () => {
    const { fetch } = fake({ text: '{"running":2,"queued":0}' });
    const http = createHttpClient({ baseUrl: base, token: 't', fetch });
    expect(await http.request('GET', apiPath`/status`)).toEqual({ running: 2, queued: 0 });
    const parsed = await http.request('GET', apiPath`/status`, { parse: (j) => (j as { running: number }).running * 10 });
    expect(parsed).toBe(20);
  });

  it('accepts a +json content type', async () => {
    const { fetch } = fake({ type: 'application/problem+json', text: '[1]' });
    expect(await createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/x`)).toEqual([1]);
  });

  it("rejects with the server's {error} and keeps the body for a refusal", async () => {
    const { fetch } = fake({ status: 409, text: '{"error":"Thread is running","code":"busy"}' });
    const f = await failure(createHttpClient({ baseUrl: base, token: 't', fetch }).request('PATCH', apiPath`/threads/${'t1'}`, { body: { done: true } }));
    expect(f).toEqual({ kind: 'http', status: 409, message: 'Thread is running', body: { error: 'Thread is running', code: 'busy' }, retryAfter: null });
  });

  it('rejects 401 as an http failure, so the caller can ask to pair again', async () => {
    const { fetch } = fake({ status: 401, text: '{"error":"Unauthorized: send this install\'s token"}' });
    const f = await failure(createHttpClient({ baseUrl: base, token: 'stale', fetch }).request('GET', apiPath`/status`));
    expect(f).toMatchObject({ kind: 'http', status: 401 });
  });

  it('uses the first 300 characters of a plain-text refusal, and the status for HTML or nothing', async () => {
    const long = 'x'.repeat(400);
    const text = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ status: 500, type: 'text/plain', text: long }).fetch }).request('GET', apiPath`/x`));
    expect(text).toMatchObject({ kind: 'http', status: 500, message: 'x'.repeat(300) });
    const html = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ status: 502, type: 'text/html', text: '<html>Bad gateway</html>' }).fetch }).request('GET', apiPath`/x`));
    expect(html).toMatchObject({ kind: 'http', status: 502, message: 'Request failed (502)' });
    const empty = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ status: 404, type: null, text: '' }).fetch }).request('GET', apiPath`/x`));
    expect(empty).toEqual({ kind: 'http', status: 404, message: 'Request failed (404)', body: null, retryAfter: null });
  });

  it('rejects a 2xx answer that is not JSON', async () => {
    const { fetch } = fake({ type: 'text/html', text: '<!doctype html>' });
    const err = await rejected(createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/nope`));
    expect(err.failure).toEqual({ kind: 'not-json', status: 200, contentType: 'text/html' });
    expect(err.message).toBe('The server answered 200 with text/html, not JSON.');
  });

  it('rejects malformed JSON and a shape parse refuses as decoding failures', async () => {
    const bad = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ text: '{"a":' }).fetch }).request('GET', apiPath`/x`));
    expect(bad.kind).toBe('decoding');
    const refused = await failure(
      createHttpClient({ baseUrl: base, token: 't', fetch: fake({ text: '{"a":1}' }).fetch }).request('GET', apiPath`/x`, {
        parse: () => {
          throw new Error('threads is missing');
        },
      }),
    );
    expect(refused).toEqual({ kind: 'decoding', detail: 'threads is missing' });
  });

  it('rejects as unreachable when no answer comes', async () => {
    const { fetch } = fake(() => Promise.reject(new TypeError('fetch failed')));
    const err = await rejected(createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/status`));
    expect(err.failure).toEqual({ kind: 'unreachable', detail: 'fetch failed' });
    expect(err.message).toBe('Cannot reach the Omni server. Is it running?');
  });

  it('rejects as cancelled when the signal aborts', async () => {
    const abort = new AbortController();
    const fetch: Fetch = (_url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
    const pending = createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/status`, { signal: abort.signal });
    abort.abort();
    expect(await failure(pending)).toEqual({ kind: 'cancelled' });
  });

  it('sends a failed write once, with no retry or queue', async () => {
    const { sent, fetch } = fake(() => Promise.reject(new TypeError('offline')));
    const http = createHttpClient({ baseUrl: base, token: 't', fetch });
    await failure(http.request('POST', apiPath`/threads`, { body: { channel: 'c', prompt: 'p' } }));
    await http.request('GET', apiPath`/status`).catch(() => {});
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['POST http://127.0.0.1:4757/api/threads', 'GET http://127.0.0.1:4757/api/status']);
  });

  it('keeps the Retry-After header on a refusal', async () => {
    const { fetch } = fake({ status: 429, text: '{"error":"slow down"}', headers: { 'Retry-After': '17' } });
    const f = await failure(createHttpClient({ baseUrl: base, token: null, fetch }).request('POST', apiPath`/x`));
    expect(f).toMatchObject({ kind: 'http', status: 429, retryAfter: '17' });
  });

  it('gives up on a request that never answers once the timeout passes', async () => {
    const { fetch } = fake((init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const f = await failure(createHttpClient({ baseUrl: base, token: 't', fetch, timeoutMs: 10 }).request('GET', apiPath`/status`));
    expect(f).toEqual({ kind: 'unreachable', detail: 'timed out' });
  });

  it('still reports the caller cancelling as cancelled when a timeout is set', async () => {
    const abort = new AbortController();
    const { fetch } = fake((init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const pending = createHttpClient({ baseUrl: base, token: 't', fetch, timeoutMs: 60_000 }).request('GET', apiPath`/status`, { signal: abort.signal });
    abort.abort();
    expect(await failure(pending)).toEqual({ kind: 'cancelled' });
  });
});

describe('redirects', () => {
  const authed = (fetch: Fetch) => createHttpClient({ baseUrl: base, token: 'secret-token', fetch });

  it('asks fetch not to follow redirects', async () => {
    const { sent, fetch } = fake();
    await authed(fetch).request('GET', apiPath`/status`);
    expect(sent[0].redirect).toBe('manual');
  });

  it.each([301, 302, 303, 307, 308])('refuses a %i without contacting the target or reading the body', async (status) => {
    let read = false;
    const sent: string[] = [];
    const fetch: Fetch = async (url) => {
      sent.push(url);
      return {
        status,
        headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://evil.example.net/steal' : null) },
        text: async () => {
          read = true;
          return '{}';
        },
      };
    };
    expect(await failure(authed(fetch).request('GET', apiPath`/status`))).toEqual({ kind: 'redirect' });
    expect(sent).toEqual(['http://127.0.0.1:4757/api/status']);
    expect(read).toBe(false);
  });

  it('refuses the opaque redirect a browser returns', async () => {
    const { fetch } = fake({ status: 0, responseType: 'opaqueredirect' });
    expect(await failure(authed(fetch).request('GET', apiPath`/status`))).toEqual({ kind: 'redirect' });
  });

  it('refuses an answer a platform that ignores `manual` took from another origin, without reading it', async () => {
    let read = false;
    const fetch: Fetch = async () => ({
      status: 200,
      headers: { get: () => 'application/json' },
      url: 'https://evil.example.net/api/status',
      text: async () => {
        read = true;
        return '{"running":1}';
      },
    });
    expect(await failure(authed(fetch).request('GET', apiPath`/status`))).toEqual({ kind: 'redirect' });
    expect(read).toBe(false);
  });

  it.each([
    ['another port', 'http://127.0.0.1:9999/api/status'],
    ['another scheme', 'https://127.0.0.1:4757/api/status'],
    ['a look-alike host', 'http://127.0.0.1.evil.example.net:4757/api/status'],
  ])('refuses an answer from %s', async (_label, url) => {
    expect(await failure(authed(fake({ url }).fetch).request('GET', apiPath`/status`))).toEqual({ kind: 'redirect' });
  });

  it.each([
    ['the same origin', 'http://127.0.0.1:4757/api/status'],
    ['no url at all', ''],
  ])('accepts an answer with %s', async (_label, url) => {
    expect(await authed(fake({ url }).fetch).request('GET', apiPath`/status`)).toEqual({});
  });

  it('treats a default port as the same origin', async () => {
    const fetch = fake({ url: 'https://OMNI.example.com/api/status' }).fetch;
    const http = createHttpClient({ baseUrl: parseBaseUrl('https://omni.example.com:443') as BaseUrl, token: 't', fetch });
    expect(await http.request('GET', apiPath`/status`)).toEqual({});
  });
});

describe('originOf', () => {
  it.each([
    ['https://Omni.Example.com:443/api/x', 'https://omni.example.com'],
    ['http://host:80', 'http://host'],
    ['http://127.0.0.1:4757/a?b#c', 'http://127.0.0.1:4757'],
    ['http://[::1]:4747/x', 'http://[::1]:4747'],
  ])('reads %s', (url, origin) => expect(originOf(url)).toBe(origin));

  it.each(['', '/api/status', 'ftp://host', 'https://user@host'])('refuses %j', (url) => expect(originOf(url)).toBeNull());
});

describe('urls', () => {
  it('builds the URL a stream or file request uses', () => {
    const http = createHttpClient({ baseUrl: base, token: 't', fetch: fake().fetch });
    expect(http.url(apiPath`/threads/${'t 1'}/stream`, { after: 7 })).toBe('http://127.0.0.1:4757/api/threads/t%201/stream?after=7');
    expect(http.url(apiPath`/feed`)).toBe('http://127.0.0.1:4757/api/feed');
  });
});

describe('requestBytes', () => {
  const authed = (fetch: Fetch) => createHttpClient({ baseUrl: base, token: 'secret', fetch });
  const bytesFetch = (reply: { status?: number; type?: string; bytes?: number[]; text?: string; headers?: Record<string, string>; url?: string; noBuffer?: boolean }) => {
    const sent: Sent[] = [];
    let readBody = false;
    const fetch: Fetch = async (url, init) => {
      sent.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect, signal: init.signal });
      const all: Record<string, string> = { 'content-type': reply.type ?? 'image/png', ...(reply.headers ?? {}) };
      return {
        status: reply.status ?? 200,
        headers: { get: (n: string) => all[n.toLowerCase()] ?? null },
        text: async () => reply.text ?? '',
        url: reply.url,
        ...(reply.noBuffer
          ? {}
          : {
              arrayBuffer: async () => {
                readBody = true;
                return new Uint8Array(reply.bytes ?? [1, 2, 3]).buffer;
              },
            }),
      };
    };
    return { fetch, sent, bodyRead: () => readBody };
  };
  const get = (fetch: Fetch, maxBytes = 100) => authed(fetch).requestBytes(apiPath`/artifacts/${7}/raw`, { query: { v: 'x' }, maxBytes });

  it('sends the token to the server and returns the bytes with their type', async () => {
    const { fetch, sent } = bytesFetch({ bytes: [137, 80, 78, 71] });
    const res = await get(fetch);
    expect([...res.bytes]).toEqual([137, 80, 78, 71]);
    expect(res.contentType).toBe('image/png');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: 'http://127.0.0.1:4757/api/artifacts/7/raw?v=x', method: 'GET', redirect: 'manual' });
    expect(sent[0].headers.authorization).toBe('Bearer secret');
  });

  it('turns a non-2xx answer into the server error, reading it as text', async () => {
    const { fetch, bodyRead } = bytesFetch({ status: 404, type: 'text/plain', text: 'not found' });
    const err = await rejected(get(fetch));
    expect(err.failure).toMatchObject({ kind: 'http', status: 404, message: 'not found' });
    expect(bodyRead()).toBe(false);
  });

  it('refuses a redirect without reading the body', async () => {
    const { fetch, bodyRead } = bytesFetch({ status: 302, headers: { location: 'https://evil.example.net/x' } });
    expect(await failure(get(fetch))).toEqual({ kind: 'redirect' });
    expect(bodyRead()).toBe(false);
  });

  it('refuses an answer from another origin', async () => {
    const { fetch, bodyRead } = bytesFetch({ url: 'https://evil.example.net/api/artifacts/7/raw' });
    expect(await failure(get(fetch))).toEqual({ kind: 'redirect' });
    expect(bodyRead()).toBe(false);
  });

  it('refuses a file over the limit by its Content-Length, before reading it', async () => {
    const { fetch, bodyRead } = bytesFetch({ headers: { 'content-length': '101' } });
    expect(await failure(get(fetch))).toMatchObject({ kind: 'decoding' });
    expect(bodyRead()).toBe(false);
  });

  it('refuses a file over the limit that sent no Content-Length', async () => {
    const { fetch } = bytesFetch({ bytes: Array.from({ length: 101 }, () => 0) });
    expect(await failure(get(fetch))).toMatchObject({ kind: 'decoding' });
  });

  it('fails as decoding where the platform cannot give bytes', async () => {
    expect(await failure(get(bytesFetch({ noBuffer: true }).fetch))).toMatchObject({ kind: 'decoding' });
  });

  it('reports a cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch: Fetch = async (_url, init) => {
      if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return { status: 200, headers: { get: () => null }, text: async () => '' };
    };
    expect(await failure(authed(fetch).requestBytes(apiPath`/artifacts/${7}/raw`, { signal: controller.signal, maxBytes: 10 }))).toEqual({ kind: 'cancelled' });
  });
});
