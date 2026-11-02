import type { Fetch } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { createPairingApi, PairingApiError, type PairingApiErrorKind } from './api';

const ORIGIN = 'https://omni.example.com';

const capabilities = {
  api: 1,
  auth: { via: 'session', method: 'pairing', sessionId: 's1' },
  pairing: { app: true, codeTtlSeconds: 300 },
  push: { registration: true, delivery: false },
  streams: { sse: true, closeOnRevoke: true },
};

interface Call {
  url: string;
  init: Parameters<Fetch>[1];
}

function respond(status: number, body?: unknown, init: { headers?: Record<string, string>; url?: string } = {}) {
  const response = new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (init.url !== undefined) Object.defineProperty(response, 'url', { value: init.url });
  return response;
}

function apiWith(handler: (call: Call) => Response | Promise<Response>, timeoutMs?: number) {
  const calls: Call[] = [];
  const fakeFetch: Fetch = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { api: createPairingApi({ fetch: fakeFetch, timeoutMs }), calls };
}

async function failureOf(promise: Promise<unknown>): Promise<PairingApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PairingApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

describe('redeemPairingCode', () => {
  it('returns the token and session id, sending the code without credentials', async () => {
    const { api, calls } = apiWith(() => respond(200, { token: 'tok', sessionId: 'sess' }));

    await expect(api.redeemPairingCode({ origin: ORIGIN, code: 'abc', name: 'iPhone' })).resolves.toEqual({
      token: 'tok',
      sessionId: 'sess',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/auth/app-pairings/redeem`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ code: 'abc', name: 'iPhone' });
    expect(calls[0]?.init.headers.authorization).toBeUndefined();
  });

  it.each<[number, PairingApiErrorKind]>([
    [400, 'invalid-input'],
    [404, 'code-unavailable'],
    [429, 'rate-limited'],
    [500, 'server-error'],
  ])('maps %i to %s', async (status, kind) => {
    const { api } = apiWith(() => respond(status, { error: 'x' }));
    const error = await failureOf(api.redeemPairingCode({ origin: ORIGIN, code: 'abc', name: 'p' }));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  it('reports the Retry-After seconds on a rate limit', async () => {
    const { api } = apiWith(() => respond(429, { error: 'slow' }, { headers: { 'Retry-After': '17' } }));
    const error = await failureOf(api.redeemPairingCode({ origin: ORIGIN, code: 'abc', name: 'p' }));
    expect(error.kind).toBe('rate-limited');
    expect(error.retryAfterSeconds).toBe(17);
  });

  it('falls back to 60 seconds when Retry-After is missing or not a number', async () => {
    for (const headers of [{}, { 'Retry-After': 'soon' }]) {
      const { api } = apiWith(() => respond(429, { error: 'slow' }, { headers: headers as Record<string, string> }));
      const error = await failureOf(api.redeemPairingCode({ origin: ORIGIN, code: 'abc', name: 'p' }));
      expect(error.retryAfterSeconds).toBe(60);
    }
  });

  it('treats a 200 without a token as a server error', async () => {
    const { api } = apiWith(() => respond(200, { sessionId: 'sess' }));
    const error = await failureOf(api.redeemPairingCode({ origin: ORIGIN, code: 'abc', name: 'p' }));
    expect(error.kind).toBe('server-error');
  });
});

describe('fetchCapabilities', () => {
  it('returns capabilities for api 1 and sends the bearer token', async () => {
    const { api, calls } = apiWith(() => respond(200, capabilities));

    await expect(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' })).resolves.toEqual(capabilities);

    expect(calls[0]?.url).toBe(`${ORIGIN}/api/capabilities`);
    expect(calls[0]?.init.headers.authorization).toBe('Bearer tok');
  });

  it('rejects another api version as incompatible and reports it', async () => {
    const { api } = apiWith(() => respond(200, { ...capabilities, api: 2 }));
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('incompatible');
    expect(error.api).toBe(2);
  });

  it('treats a 404 from an older server as incompatible', async () => {
    const { api } = apiWith(() => respond(404, { error: 'not found' }));
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('incompatible');
  });

  it('maps 401 to unauthorized', async () => {
    const { api } = apiWith(() => respond(401, { error: 'no' }));
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('unauthorized');
  });

  it.each([
    ['a non-JSON body', () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['a JSON array', () => respond(200, [1])],
    ['api 1 without the capability sections', () => respond(200, { api: 1 })],
  ])('treats %s as incompatible', async (_label, make) => {
    const { api } = apiWith(make);
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('incompatible');
  });
});

describe('signOut', () => {
  it('posts to signout with the bearer token', async () => {
    const { api, calls } = apiWith(() => respond(200, { ok: true }));
    await api.signOut({ origin: ORIGIN, token: 'tok' });
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/auth/signout`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers.authorization).toBe('Bearer tok');
  });

  it('propagates a failure', async () => {
    const { api } = apiWith(() => respond(500));
    const error = await failureOf(api.signOut({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('server-error');
  });
});

describe('deletePushToken', () => {
  it('sends a delete to the push token route with the bearer token', async () => {
    const { api, calls } = apiWith(() => respond(200, { ok: true }));
    await api.deletePushToken({ origin: ORIGIN, token: 'tok' });
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/auth/push-token`);
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.init.headers.authorization).toBe('Bearer tok');
  });

  it('reports a rejected session as unauthorized', async () => {
    const { api } = apiWith(() => respond(401));
    const error = await failureOf(api.deletePushToken({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('unauthorized');
  });
});

describe('unreachable servers', () => {
  it('maps a network failure to unreachable and names the origin', async () => {
    const { api } = apiWith(() => {
      throw new TypeError('Network request failed');
    });
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('unreachable');
    expect(error.origin).toBe(ORIGIN);
  });

  it('refuses a response that came from another origin', async () => {
    const { api } = apiWith(() =>
      respond(200, capabilities, { url: 'https://evil.example.net/api/capabilities' }),
    );
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('unreachable');
  });

  it('refuses a redirect and never asks for the target', async () => {
    const { api, calls } = apiWith(() => respond(302, undefined, { headers: { Location: 'https://evil.example.net/' } }));
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('unreachable');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('accepts a response whose url is on the same origin', async () => {
    const { api } = apiWith(() => respond(200, capabilities, { url: `${ORIGIN}/api/capabilities` }));
    await expect(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' })).resolves.toBeDefined();
  });

  it('gives up on a request that never answers', async () => {
    const { api } = apiWith(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      20,
    );
    const error = await failureOf(api.fetchCapabilities({ origin: ORIGIN, token: 'tok' }));
    expect(error.kind).toBe('unreachable');
  });
});
