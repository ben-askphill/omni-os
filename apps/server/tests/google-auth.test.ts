import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { startRunner } from './runner-boot.ts';
import { FAKE_CLIENT_ID, FAKE_PUBLISHABLE_KEY, fakeClerk } from './fake-clerk.ts';

// Google sign-in for new devices (apps/server/google-auth.ts) through the API: linking the owner from a device that
// holds the token, a new device signing in as the owner with the device-code flow, its session getting in where the
// token would, and revoking it. Clerk is fake-clerk.ts, swapped in for fetch; nothing reaches the network.

const clerk = fakeClerk({ interval: 1 });
let app: Awaited<typeof import('../app.ts')>['app'];
let auth: typeof import('../google-auth.ts');

beforeAll(async () => {
  await startRunner({ OMNI_CLERK_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY, OMNI_CLERK_CLIENT_ID: FAKE_CLIENT_ID });
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(clerk.issuer) ? clerk.fetch(input, init) : real(input, init);
  });
  ({ app } = await import('../app.ts'));
  auth = await import('../google-auth.ts');
});

afterEach(() => {
  auth.resetFlows();
});

const HOST = { host: '127.0.0.1:4747' };
const NO_TOKEN = { ...HOST, authorization: '' };

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`http://127.0.0.1:4747/api${path}`, {
    method,
    headers: { ...HOST, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the flow is no longer pending. Clerk's interval here is 1 s. */
async function pollUntilDone(flow: string, secret: string, headers: Record<string, string> = NO_TOKEN) {
  for (let i = 0; i < 10; i++) {
    const res = await req('POST', '/auth/google/poll', { flow, secret }, headers);
    const body = (await res.json()) as { state: string; [k: string]: unknown };
    if (body.state !== 'pending') return { res, body };
    await wait(400);
  }
  throw new Error('still pending');
}

async function link(who: { sub: string; email?: string }) {
  const start = (await (await req('POST', '/auth/google/link', {})).json()) as { flow: string; secret: string; userCode: string };
  clerk.approve(start.userCode, who);
  return pollUntilDone(start.flow, start.secret);
}

const sessionCookie = (res: Response) => /omni_session_\d+=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];

describe('Google sign-in: linking the owner', () => {
  it('offers no Google sign-in until an owner is linked', async () => {
    expect(await (await req('GET', '/auth/methods', undefined, NO_TOKEN)).json()).toEqual({ google: false, connect: null });
    const start = await req('POST', '/auth/google/start', {}, NO_TOKEN);
    expect(start.status).toBe(409);
    expect(((await start.json()) as { error: string }).error).toMatch(/No Google account is linked/);
  });

  it('refuses to link without the token', async () => {
    expect((await req('POST', '/auth/google/link', {}, NO_TOKEN)).status).toBe(401);
  });

  it('links the account that approves, from a device holding the token', async () => {
    const { body } = await link({ sub: 'user_ada', email: 'ada@example.com' });
    expect(body).toMatchObject({ state: 'linked', owner: { email: 'ada@example.com' } });
    expect(await (await req('GET', '/auth/methods', undefined, NO_TOKEN)).json()).toEqual({ google: true, connect: null });
    expect(await (await req('GET', '/auth/account')).json()).toMatchObject({ available: true, owner: { email: 'ada@example.com' }, via: 'token' });
  });
});

describe('Google sign-in: a new device', () => {
  it('a browser that signs in as the owner gets a session cookie, never the token, and gets in with it', async () => {
    const start = await req('POST', '/auth/google/start', { client: 'browser' }, { ...NO_TOKEN, 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1' });
    expect(start.status).toBe(200);
    const s = (await start.json()) as { flow: string; secret: string; userCode: string; verificationUri: string; deviceCode?: string };
    expect(s.verificationUri).toMatch(/^https:\/\/fake-walrus/);
    expect(s).not.toHaveProperty('deviceCode');

    // Polled straight away, it waits for Clerk's interval and does not ask Clerk.
    const before = clerk.calls.filter((p) => p === '/oauth/token').length;
    expect(await (await req('POST', '/auth/google/poll', { flow: s.flow, secret: s.secret }, NO_TOKEN)).json()).toEqual({ state: 'pending' });
    expect(clerk.calls.filter((p) => p === '/oauth/token').length).toBe(before);

    clerk.approve(s.userCode, { sub: 'user_ada', email: 'ada@example.com' });
    const { res, body } = await pollUntilDone(s.flow, s.secret);
    expect(body).toEqual({ state: 'signed_in' });
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/^omni_s_[0-9a-f]{64}$/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(res.headers.get('set-cookie')).toMatch(/SameSite=Strict/);

    const withCookie = { ...NO_TOKEN, cookie: `omni_session_4747=${cookie}` };
    expect((await req('GET', '/auth', undefined, withCookie)).status).toBe(200);
    expect((await req('GET', '/threads', undefined, withCookie)).status).toBe(200);
    const devices = (await (await req('GET', '/auth/devices', undefined, withCookie)).json()) as { devices: { name: string; kind: string; current: boolean }[] };
    expect(devices.devices).toEqual([expect.objectContaining({ name: 'Safari on iPhone', kind: 'browser', current: true })]);
  });

  it('an app gets the session as a bearer token instead', async () => {
    const s = (await (await req('POST', '/auth/google/start', { client: 'app', name: 'omarchy' }, NO_TOKEN)).json()) as { flow: string; secret: string; userCode: string };
    clerk.approve(s.userCode, { sub: 'user_ada' });
    const { res, body } = await pollUntilDone(s.flow, s.secret);
    expect(sessionCookie(res)).toBeUndefined();
    expect(body.token).toMatch(/^omni_s_/);
    expect((await req('GET', '/threads', undefined, { ...NO_TOKEN, authorization: `Bearer ${body.token}` })).status).toBe(200);
  });

  it('refuses a Google account that is not the owner, and gives it nothing', async () => {
    const s = (await (await req('POST', '/auth/google/start', { client: 'app' }, NO_TOKEN)).json()) as { flow: string; secret: string; userCode: string };
    clerk.approve(s.userCode, { sub: 'user_eve', email: 'eve@example.com' });
    const { body } = await pollUntilDone(s.flow, s.secret);
    expect(body.state).toBe('refused');
    expect(body.error).toMatch(/eve@example.com does not own this Omni/);
    expect(body).not.toHaveProperty('token');
  });

  it('reports a denial on the Clerk page', async () => {
    const s = (await (await req('POST', '/auth/google/start', {}, NO_TOKEN)).json()) as { flow: string; secret: string; userCode: string };
    clerk.deny(s.userCode);
    expect((await pollUntilDone(s.flow, s.secret)).body).toEqual({ state: 'denied' });
  });

  it('answers a poll with the wrong secret, or an unknown flow, with 404', async () => {
    const s = (await (await req('POST', '/auth/google/start', {}, NO_TOKEN)).json()) as { flow: string; secret: string };
    expect((await req('POST', '/auth/google/poll', { flow: s.flow, secret: 'nope' }, NO_TOKEN)).status).toBe(404);
    expect((await req('POST', '/auth/google/poll', { flow: 'nope', secret: s.secret }, NO_TOKEN)).status).toBe(404);
  });

  it('caps open sign-ins, since starting one takes no token', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await req('POST', '/auth/google/start', {}, NO_TOKEN)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('still refuses a cross-site page and a form post on the open routes', async () => {
    expect((await req('POST', '/auth/google/start', {}, { ...NO_TOKEN, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await req('POST', '/auth/google/start', {}, { ...NO_TOKEN, origin: 'https://evil.example' })).status).toBe(403);
    const form = await app.request('http://127.0.0.1:4747/api/auth/google/start', { method: 'POST', headers: { ...NO_TOKEN, 'content-type': 'text/plain' }, body: '{}' });
    expect(form.status).toBe(415);
  });
});

describe('Google sign-in: what a session may and may not do', () => {
  async function appSession(name = 'laptop') {
    const s = (await (await req('POST', '/auth/google/start', { client: 'app', name }, NO_TOKEN)).json()) as { flow: string; secret: string; userCode: string };
    clerk.approve(s.userCode, { sub: 'user_ada' });
    const { body } = await pollUntilDone(s.flow, s.secret);
    return { ...NO_TOKEN, authorization: `Bearer ${body.token}` };
  }

  it('cannot change or unlink the owner', async () => {
    const bearer = await appSession();
    expect((await req('POST', '/auth/google/link', {}, bearer)).status).toBe(403);
    expect((await req('DELETE', '/auth/google', undefined, bearer)).status).toBe(403);
  });

  it('stops working once revoked, and signing out revokes your own', async () => {
    const a = await appSession('a');
    const b = await appSession('b');
    const list = (await (await req('GET', '/auth/devices', undefined, a)).json()) as { devices: { id: string; name: string }[] };
    const idB = list.devices.find((d) => d.name === 'b')!.id;
    expect((await req('DELETE', `/auth/devices/${idB}`, undefined, a)).status).toBe(200);
    expect((await req('GET', '/threads', undefined, b)).status).toBe(401);
    expect((await req('POST', '/auth/signout', {}, a)).status).toBe(200);
    expect((await req('GET', '/threads', undefined, a)).status).toBe(401);
  });

  it('every session ends when another account is linked, and when the owner is unlinked', async () => {
    const before = await appSession('before');
    await link({ sub: 'user_bob', email: 'bob@example.com' });
    expect((await req('GET', '/threads', undefined, before)).status).toBe(401);

    await link({ sub: 'user_ada', email: 'ada@example.com' });
    const again = await appSession('again');
    expect((await req('DELETE', '/auth/google')).status).toBe(200);
    expect((await req('GET', '/threads', undefined, again)).status).toBe(401);
    expect(await (await req('GET', '/auth/methods', undefined, NO_TOKEN)).json()).toEqual({ google: false, connect: null });
  });

  it('a made-up session token gets nothing', async () => {
    expect((await req('GET', '/threads', undefined, { ...NO_TOKEN, authorization: `Bearer omni_s_${'0'.repeat(64)}` })).status).toBe(401);
    expect((await req('GET', '/threads', undefined, { ...NO_TOKEN, cookie: `omni_session_4747=omni_s_${'0'.repeat(64)}` })).status).toBe(401);
  });
});

describe('wire fixtures', () => {
  // The server must still send the shape of these hand-made account and device fixtures.
  const fixture = (name: string) => JSON.parse(readFileSync(join(WIRE_FIXTURES, name), 'utf8'));
  const shape = (v: unknown): unknown =>
    v === null ? 'null' : Array.isArray(v) ? v.slice(0, 1).map(shape) : typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x)])) : typeof v;

  it('sends the account and device list shapes the fixtures have', async () => {
    await link({ sub: 'user_ada', email: 'ada@example.com' });
    const s = (await (await req('POST', '/auth/google/start', { client: 'browser' }, NO_TOKEN)).json()) as { flow: string; secret: string; userCode: string };
    clerk.approve(s.userCode, { sub: 'user_ada' });
    await pollUntilDone(s.flow, s.secret);
    const account = (await (await req('GET', '/auth/account')).json()) as Record<string, unknown>;
    // Ada's name is null here and a string in the fixture: both are an optional string.
    expect(shape({ ...account, owner: { ...(account.owner as object), name: 'Ada' } })).toEqual(shape(fixture('auth-account.json')));
    expect(shape(await (await req('GET', '/auth/devices')).json())).toEqual(shape(fixture('auth-devices.json')));
  });
});
