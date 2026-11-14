// Tests for src/backend/pairing.ts: the nonce a main window pairs with, and what happens when the server will not give one.
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { DESKTOP_NONCE_PATH, desktopPairUrl, newPairSecret, PAIR_SECRET_HEADER, PairingError, redactNonce } from '../src/backend/pairing.ts';

const ORIGIN = 'http://127.0.0.1:4766';
const SECRET = 'c'.repeat(64);
const TOKEN = 'd'.repeat(64);

interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
}

/** A fetch that answers each call with `answer(n)`, n counting from 1, and keeps what it was asked. */
function fakeFetch(answer: (n: number) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers), body: init?.body });
    return answer(calls.length);
  };
  return { fetch: fn as typeof fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('desktopPairUrl', () => {
  it('mints a fresh nonce for every pairing load and puts only the nonce in the URL', async () => {
    const { fetch, calls } = fakeFetch((n) => json({ nonce: `nonce-${n}`, expiresIn: 60 }));
    const first = await desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch });
    const second = await desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch });
    expect(first).toBe(`${ORIGIN}/api/auth/desktop-pair?nonce=nonce-1`);
    expect(second).toBe(`${ORIGIN}/api/auth/desktop-pair?nonce=nonce-2`);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toBe(`${ORIGIN}${DESKTOP_NONCE_PATH}`);
      expect(call.method).toBe('POST');
      expect(call.body).toBeUndefined();
      expect(call.headers.get(PAIR_SECRET_HEADER)).toBe(SECRET);
      expect(call.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(SECRET);
    }
    for (const url of [first, second]) {
      expect(url).not.toContain(SECRET);
      expect(url).not.toContain(TOKEN);
    }
  });

  it('encodes a nonce that is not URL-safe', async () => {
    const { fetch } = fakeFetch(() => json({ nonce: 'a+b/c=&x', expiresIn: 60 }));
    expect(await desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch })).toBe(`${ORIGIN}/api/auth/desktop-pair?nonce=a%2Bb%2Fc%3D%26x`);
  });

  it('sends no secret header for a server it did not start', async () => {
    const { fetch, calls } = fakeFetch(() => json({ nonce: 'n', expiresIn: 60 }));
    await desktopPairUrl({ origin: ORIGIN, secret: null, token: TOKEN, fetch });
    expect(calls[0].headers.has(PAIR_SECRET_HEADER)).toBe(false);
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('gets a nonce with the token alone from a server it did not start', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.headers['x-omni-desktop-secret'] || req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      res.end(JSON.stringify({ nonce: 'token-nonce', expiresIn: 60 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect(await desktopPairUrl({ origin, secret: null, token: TOKEN })).toBe(`${origin}/api/auth/desktop-pair?nonce=token-nonce`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falls back to desktop-pair without a nonce when the server is from before nonces (404)', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Not found' }, 404));
    expect(await desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch })).toBe(`${ORIGIN}/api/auth/desktop-pair`);
  });

  it.each([400, 401, 403, 429, 500, 503])('throws rather than pair without a nonce on %i', async (status) => {
    const { fetch } = fakeFetch(() => json({ error: 'no' }, status));
    const err = await desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PairingError);
    expect((err as PairingError).status).toBe(status);
    expect((err as PairingError).message).not.toContain(SECRET);
    expect((err as PairingError).message).not.toContain(TOKEN);
  });

  it('throws when a 2xx carries no usable nonce', async () => {
    for (const answer of [json({}), json({ nonce: '' }), json({ nonce: 42 }), json({ nonce: 'x'.repeat(513) }), new Response('not json', { status: 200 })]) {
      const { fetch } = fakeFetch(() => answer);
      await expect(desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch })).rejects.toBeInstanceOf(PairingError);
    }
  });

  it('throws when the server does not answer', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const err = await desktopPairUrl({ origin: ORIGIN, secret: SECRET, token: TOKEN, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PairingError);
    expect((err as PairingError).status).toBeNull();
  });

  it('sends an empty POST a real server sees with the secret and no body type the guard refuses', async () => {
    const seen: { method?: string; url?: string; headers?: IncomingHttpHeaders; body?: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ nonce: 'real-nonce', expiresIn: 60 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect(await desktopPairUrl({ origin, secret: SECRET, token: TOKEN })).toBe(`${origin}/api/auth/desktop-pair?nonce=real-nonce`);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ method: 'POST', url: DESKTOP_NONCE_PATH, body: '' });
      expect(seen[0].headers?.['x-omni-desktop-secret']).toBe(SECRET);
      expect(seen[0].headers?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(seen[0].headers?.['content-type']).toBeUndefined();
      expect(seen[0].headers?.origin).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('pairing secret', () => {
  it('is 32 random bytes as hex, new each time', () => {
    const a = newPairSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newPairSecret()).not.toBe(a);
  });
});

describe('redactNonce', () => {
  it('keeps a nonce out of a log line', () => {
    expect(redactNonce("ERR_ABORTED (-3) loading 'http://127.0.0.1:4747/api/auth/desktop-pair?nonce=abc123'")).toBe(
      "ERR_ABORTED (-3) loading 'http://127.0.0.1:4747/api/auth/desktop-pair?nonce=…'",
    );
    expect(redactNonce('no nonce here')).toBe('no nonce here');
  });
});
