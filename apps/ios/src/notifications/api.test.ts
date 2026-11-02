import type { Fetch } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { createPushServerApi } from './api';

const a = { id: 'a', origin: 'https://a.example.com' };
const b = { id: 'b', origin: 'https://b.example.com' };

interface Call {
  url: string;
  method: string;
  authorization: string | undefined;
  body: unknown;
}

function setup(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      authorization: init.headers.authorization,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  const api = createPushServerApi({ getToken: async (id) => `token-${id}`, fetch });
  return { api, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createPushServerApi', () => {
  it('registers on the named server with that server\'s own token', async () => {
    const { api, calls } = setup(() => json({ ok: true }));
    const body = { token: 'abc', platform: 'ios', environment: 'sandbox', bundleId: 'app.omni-os.ios' } as const;

    await api.register(b, body);

    expect(calls).toEqual([
      { url: 'https://b.example.com/api/auth/push-token', method: 'PUT', authorization: 'Bearer token-b', body },
    ]);
  });

  it('sends only the changed key when saving preferences', async () => {
    const all = { needsInput: true, finished: false, failed: true, crewReport: true };
    const { api, calls } = setup(() => json(all));

    await expect(api.setPreferences(a, { finished: false })).resolves.toEqual(all);

    expect(calls[0]).toMatchObject({ url: 'https://a.example.com/api/auth/push-preferences', method: 'PUT', body: { finished: false } });
  });

  it('reads preferences', async () => {
    const all = { needsInput: true, finished: true, failed: true, crewReport: true };
    const { api, calls } = setup(() => json(all));

    await expect(api.preferences(a)).resolves.toEqual(all);
    expect(calls[0]?.method).toBe('GET');
  });

  it('tells a thread that exists from one that does not and from an unreachable server', async () => {
    const { api } = setup((call) => {
      const path = new URL(call.url).pathname;
      if (path === '/api/threads/here') return json({ thread: { id: 'here' } });
      if (path === '/api/threads/gone') return json({ error: 'not found' }, 404);
      return json({}, 500);
    });

    expect(await api.probeThread(a, 'here')).toBe('found');
    expect(await api.probeThread(a, 'gone')).toBe('missing');
    expect(await api.probeThread(a, 'broken')).toBe('error');
  });
});
