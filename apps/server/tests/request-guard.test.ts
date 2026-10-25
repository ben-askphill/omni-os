import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cookieName, loadToken, proofFor, sessionCookieName } from '../api-token.ts';
import { hostAllowed, requestGuard, useSessions, viaTailnet } from '../request-guard.ts';

// requestGuard in front of /api: a request without this install's token is refused, and so is what a
// cross-site page or a DNS-rebinding domain sends. What the Web UI (same origin, or through vite), the Mac
// app, the MCP and curl send with the token gets through. tests/setup.ts adds the token to every app.request
// unless the test passes `authorization: ''`, which `get` does.

const app = new Hono();
app.use('*', requestGuard);
app.all('*', (c) => c.json({ ok: true, via: c.get('access')?.via ?? null }));

// A stand-in for apps/server/sign-in.ts's session check, so this file needs no database.
const LIVE = 'omni_s1.live.secret';
const session = (renewed: boolean) => ({
  sessionId: 'live',
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  renewed,
  user: { id: 'u', email: 'ada@example.com', name: 'Ada', hd: null },
  device: { id: 'd', name: 'Safari on iPhone', kind: 'browser' as const },
});
let renewed = false;
useSessions((credential) => (credential === LIVE ? session(renewed) : null));

const TOKEN = process.env.OMNI_TOKEN!;
const AUTH = { authorization: `Bearer ${TOKEN}` };

const send = (headers: Record<string, string>, init: RequestInit = {}) =>
  app.request('http://127.0.0.1:4747/api/threads', { method: 'POST', body: '{"prompt":"x"}', ...init, headers: { host: '127.0.0.1:4747', ...AUTH, ...headers } });
const get = (path: string, headers: Record<string, string> = {}) =>
  app.request(`http://127.0.0.1:4747${path}`, { headers: { host: '127.0.0.1:4747', authorization: '', ...headers } });

describe('requestGuard: the token', () => {
  it('refuses a request with no token, or the wrong one, with 401', async () => {
    const none = await get('/api/threads');
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: string }).error).toMatch(/token/);
    expect((await get('/api/threads', { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await get('/api/threads', { authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
    expect((await get('/api/threads', { authorization: TOKEN })).status).toBe(401);
    expect((await send({ authorization: '', 'content-type': 'application/json' })).status).toBe(401);
  });

  it('lets the right token through as a bearer header or as the paired cookie', async () => {
    expect((await get('/api/threads', AUTH)).status).toBe(200);
    expect((await get('/api/threads', { authorization: `bearer  ${TOKEN} ` })).status).toBe(200);
    expect((await get('/api/threads', { cookie: `other=1; ${cookieName()}=${TOKEN}` })).status).toBe(200);
    // EventSource sends only the cookie.
    expect((await get('/api/feed', { cookie: `${cookieName()}=${TOKEN}`, accept: 'text/event-stream' })).status).toBe(200);
  });

  it('takes no cookie of another name, like another port\'s', async () => {
    expect((await get('/api/threads', { cookie: `omni_token_1=${TOKEN}` })).status).toBe(401);
    expect((await get('/api/threads', { cookie: `${cookieName()}=nope` })).status).toBe(401);
  });

  it('lets GET /api/auth/proof through without one, and nothing else on that path', async () => {
    expect((await get('/api/auth/proof?nonce=00')).status).toBe(200);
    expect((await app.request('http://127.0.0.1:4747/api/auth/proof', { method: 'POST', headers: { host: '127.0.0.1:4747', authorization: '' } })).status).toBe(401);
    expect((await get('/api/auth/proof/x')).status).toBe(401);
  });

  it('lets a POST to a GitHub webhook path through without one, and nothing else under /api/hooks', async () => {
    const hook = (path: string, headers: Record<string, string> = {}, method = 'POST') =>
      app.request(`http://127.0.0.1:4747${path}`, { method, body: method === 'POST' ? '{}' : undefined, headers: { host: '127.0.0.1:4747', authorization: '', 'content-type': 'application/json', ...headers } });
    expect((await hook('/api/hooks/github/ci-fixer')).status).toBe(200);
    expect((await hook('/api/hooks/github/ci-fixer', {}, 'GET')).status).toBe(401);
    expect((await hook('/api/hooks/github/ci-fixer/extra')).status).toBe(401);
    expect((await hook('/api/hooks/github/%2e%2e%2fthreads')).status).toBe(401);
    expect((await hook('/api/hooks/slack/x')).status).toBe(401);
    // The other checks still apply: GitHub sends JSON, from no browser.
    expect((await hook('/api/hooks/github/ci-fixer', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await hook('/api/hooks/github/ci-fixer', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await hook('/api/hooks/github/ci-fixer', { host: 'evil.example' })).status).toBe(403);
  });

  it('still refuses a cross-site request that carries the cookie', async () => {
    const res = await send({ authorization: '', cookie: `${cookieName()}=${TOKEN}`, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });
});

describe('requestGuard: a Google sign-in session', () => {
  afterEach(() => {
    renewed = false;
  });

  it('lets a live session through as the cookie or a bearer header, and says so', async () => {
    const viaCookie = await get('/api/threads', { cookie: `${sessionCookieName()}=${LIVE}` });
    expect(await viaCookie.json()).toEqual({ ok: true, via: 'session' });
    expect(await (await get('/api/threads', { authorization: `Bearer ${LIVE}` })).json()).toEqual({ ok: true, via: 'session' });
    expect(await (await get('/api/threads', AUTH)).json()).toEqual({ ok: true, via: 'token' });
  });

  it('refuses a dead or forged one, and never reads a session from the token cookie or the token from the session cookie', async () => {
    expect((await get('/api/threads', { cookie: `${sessionCookieName()}=omni_s1.dead.secret` })).status).toBe(401);
    expect((await get('/api/threads', { authorization: 'Bearer omni_s1.dead.secret' })).status).toBe(401);
    expect((await get('/api/threads', { cookie: `${cookieName()}=${LIVE}` })).status).toBe(401);
    expect((await get('/api/threads', { cookie: `${sessionCookieName()}=${TOKEN}` })).status).toBe(401);
    // A wrong bearer header is not rescued by a good cookie, as with the token.
    expect((await get('/api/threads', { authorization: 'Bearer nope', cookie: `${sessionCookieName()}=${LIVE}` })).status).toBe(401);
  });

  it('sends the cookie again with its new expiry when the session slid', async () => {
    expect((await get('/api/threads', { cookie: `${sessionCookieName()}=${LIVE}` })).headers.get('set-cookie')).toBeNull();
    renewed = true;
    const slid = (await get('/api/threads', { cookie: `${sessionCookieName()}=${LIVE}` })).headers.get('set-cookie') ?? '';
    expect(slid).toContain(`${sessionCookieName()}=${LIVE}`);
    expect(slid).toMatch(/HttpOnly/);
    expect(slid).toMatch(/SameSite=Strict/);
    expect(Number(slid.match(/Max-Age=(\d+)/)?.[1])).toBeGreaterThan(29 * 86_400);
  });

  it('keeps the cross-site, Origin and content-type checks for a session as for the token', async () => {
    const cookie = `${sessionCookieName()}=${LIVE}`;
    expect((await send({ authorization: '', cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' })).status).toBe(403);
    expect((await send({ authorization: '', cookie, origin: 'http://evil.example:4747', 'content-type': 'application/json' })).status).toBe(403);
    expect((await send({ authorization: '', cookie, 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('opens only the sign-in routes to a browser with neither, and only same-origin', async () => {
    expect(await (await get('/api/auth/google')).json()).toEqual({ ok: true, via: null });
    const start = (headers: Record<string, string> = {}) =>
      app.request('http://127.0.0.1:4747/api/auth/google/start', { method: 'POST', body: '{}', headers: { host: '127.0.0.1:4747', authorization: '', 'content-type': 'application/json', ...headers } });
    expect((await start()).status).toBe(200);
    expect((await start({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await start({ 'content-type': 'text/plain' })).status).toBe(415);
    for (const path of ['/api/auth/google/callback', '/api/auth/google/start', '/api/auth/signout', '/api/auth']) expect((await get(path)).status, path).toBe(401);
  });
});

describe('requestGuard: through tailscale serve', () => {
  afterEach(() => {
    delete process.env.OMNI_TAILSCALE_LOGIN;
  });
  const ts = { host: 'bens-mac.tail1234.ts.net', ...AUTH };

  it('needs only the token while no owner login is configured', async () => {
    process.env.OMNI_TAILSCALE_LOGIN = '';
    expect((await get('/api/threads', ts)).status).toBe(200);
  });

  it('needs the owner Tailscale login as well once one is', async () => {
    process.env.OMNI_TAILSCALE_LOGIN = 'ben@example.com, second@example.com';
    expect((await get('/api/threads', ts)).status).toBe(403);
    expect((await get('/api/threads', { ...ts, 'tailscale-user-login': 'mallory@example.com' })).status).toBe(403);
    expect((await get('/api/threads', { ...ts, 'tailscale-user-login': 'Ben@Example.com' })).status).toBe(200);
    expect((await get('/api/threads', { ...ts, 'tailscale-user-login': 'second@example.com' })).status).toBe(200);
    expect((await get('/api/threads', { ...ts, host: '100.101.102.103:4747' })).status).toBe(403);
    // The login is on top of the token, not instead of it.
    expect((await get('/api/threads', { host: ts.host, 'tailscale-user-login': 'ben@example.com' })).status).toBe(401);
    // Loopback clients (the Mac app, scripts) send no login.
    expect((await get('/api/threads', AUTH)).status).toBe(200);
  });

  it('needs the login when tailscale serve forwards the request, whatever Host the client names', async () => {
    process.env.OMNI_TAILSCALE_LOGIN = 'ben@example.com';
    // tailscale serve always sets X-Forwarded-Host; a client behind it picked Host: 127.0.0.1.
    const proxies: Record<string, string>[] = [{ 'x-forwarded-host': '127.0.0.1:4747' }, { 'x-forwarded-for': '100.101.1.2' }, { 'tailscale-funnel-request': '?1' }];
    for (const proxied of proxies) {
      expect((await get('/api/threads', { ...AUTH, ...proxied })).status, JSON.stringify(proxied)).toBe(403);
      expect((await get('/api/threads', { ...AUTH, ...proxied, 'tailscale-user-login': 'mallory@example.com' })).status).toBe(403);
      expect((await get('/api/threads', { ...AUTH, ...proxied, 'tailscale-user-login': 'ben@example.com' })).status).toBe(200);
    }
    // A plain loopback client with no proxy headers is not asked for one.
    expect((await get('/api/threads', AUTH)).status).toBe(200);
  });

  it('knows the tailnet by its Host', () => {
    for (const h of ['bens-mac.tail1234.ts.net', 'BENS-MAC.tail1234.ts.net.', '100.64.0.1', '100.127.1.1']) expect(viaTailnet(h), h).toBe(true);
    for (const h of ['127.0.0.1', 'localhost', '100.128.0.1', 'ts.net.evil.example']) expect(viaTailnet(h), h).toBe(false);
  });
});

describe('loadToken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-token-'));
  afterEach(() => rmSync(join(dir, 'api-token'), { force: true }));
  const file = join(dir, 'api-token');

  it('makes 32 random bytes, readable only by this account, and keeps them', () => {
    const made = loadToken(file, {});
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8').trim()).toBe(made);
    expect(loadToken(file, {})).toBe(made);
    rmSync(file);
    expect(loadToken(file, {})).not.toBe(made);
  });

  it('tightens a file other accounts can read', () => {
    writeFileSync(file, 'a'.repeat(64));
    chmodSync(file, 0o644);
    expect(loadToken(file, {})).toBe('a'.repeat(64));
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('takes OMNI_TOKEN over the file, unless it is too short to be one', () => {
    expect(loadToken(file, { OMNI_TOKEN: 'b'.repeat(40) })).toBe('b'.repeat(40));
    expect(loadToken(file, { OMNI_TOKEN: 'short' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('proves the token with an HMAC of the nonce, never the token itself', () => {
    const proof = proofFor('00ff', 4747, 'c'.repeat(64));
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(proof).not.toContain('c'.repeat(8));
    expect(proofFor('00ff', 4747, 'd'.repeat(64))).not.toBe(proof);
    // A server on another port, relayed to by a squatter, proves a different value.
    expect(proofFor('00ff', 4757, 'c'.repeat(64))).not.toBe(proof);
  });
});

describe('requestGuard', () => {
  it('lets the Mac app, the MCP and curl through: JSON, no Origin', async () => {
    expect((await send({ 'content-type': 'application/json' })).status).toBe(200);
    expect((await send({}, { method: 'GET', body: undefined })).status).toBe(200);
  });

  it('lets the Web UI through on its own origin, through vite and through tailscale serve', async () => {
    const same = { origin: 'http://127.0.0.1:4747', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    expect((await send(same)).status).toBe(200);
    expect((await send({ ...same, host: 'localhost:4748', origin: 'http://localhost:4748' })).status).toBe(200);
    expect((await send({ ...same, host: 'bens-mac.tail1234.ts.net', origin: 'https://bens-mac.tail1234.ts.net' })).status).toBe(200);
    const multipart = { ...same, 'content-type': 'multipart/form-data; boundary=x' };
    expect((await send(multipart, { body: '--x--' })).status).toBe(200);
  });

  it('refuses the no-cors text/plain POST from the report', async () => {
    const res = await send({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain;charset=UTF-8' });
    expect(res.status).toBe(403);
  });

  it('refuses a foreign Origin even without Sec-Fetch-Site (older Safari, Firefox)', async () => {
    expect((await send({ origin: 'https://evil.example', 'content-type': 'application/json' })).status).toBe(403);
    expect((await send({ origin: 'null', 'content-type': 'application/json' })).status).toBe(403);
    // Another local server on a different port is another origin.
    expect((await send({ origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' })).status).toBe(403);
  });

  it('refuses a cross-site form post without an Origin header', async () => {
    const res = await send({ 'sec-fetch-site': 'cross-site', 'content-type': 'multipart/form-data; boundary=x' }, { body: '--x--' });
    expect(res.status).toBe(403);
  });

  it('refuses text/plain and form-urlencoded bodies from any client', async () => {
    expect((await send({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await send({ 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
  });

  it('refuses a DNS-rebinding Host, reads included', async () => {
    const rebound = { host: 'rebind.evil.example:4747', origin: 'http://rebind.evil.example:4747', 'sec-fetch-site': 'same-origin' };
    expect((await send(rebound, { method: 'GET', body: undefined })).status).toBe(403);
    expect((await send({ ...rebound, 'content-type': 'application/json' })).status).toBe(403);
  });

  it('does not take X-Forwarded-Host for a host outside the allowlist', async () => {
    const res = await send({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });
});

describe('hostAllowed', () => {
  it('takes loopback, the tailnet and the extras', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', 'bens-mac.tail1234.ts.net', 'bens-mac.tail1234.ts.net.', '100.64.0.1', '100.127.255.255']) {
      expect(hostAllowed(h, []), h).toBe(true);
    }
    expect(hostAllowed('omni.lan', ['omni.lan'])).toBe(true);
  });

  it('refuses everything else', () => {
    for (const h of ['', 'evil.example', 'ts.net.evil.example', 'localhost.evil.example', '100.128.0.1', '100.63.0.1', '192.168.1.20', '0.0.0.0']) {
      expect(hostAllowed(h, []), h).toBe(false);
    }
  });
});
