import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Native app pairing through the HTTP API: a device with the token mints a one-time code, the app redeems it with no
// credentials for a session of its own, and that session works with no Google owner, shows as a pairing, registers a
// push token, and is cut off, streams and push token included, the moment it is revoked.

const r = await startRunner();
const { app } = await import('../app.ts');
const auth = await import('../google-auth.ts');
const pairing = await import('../app-pairing.ts');
const push = await import('../push-tokens.ts');
const { pushTargets } = await import('../push-preferences.ts');
const { sessionCookieName } = await import('../api-token.ts');

const MASTER = process.env.OMNI_TOKEN!;
const HOST = { host: '127.0.0.1:4747' };
const NONE = { authorization: '' };
const as = (token: string) => ({ authorization: `Bearer ${token}` });

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`http://127.0.0.1:4747/api${path}`, {
    method,
    headers: { ...HOST, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

const mint = async (headers: Record<string, string> = {}) => (await (await req('POST', '/auth/app-pairings', {}, headers)).json()) as { code: string; expiresAt: string };
const redeem = (code: string, name = 'Ben iPhone') => req('POST', '/auth/app-pairings/redeem', { code, name }, NONE);

async function pairApp(name = 'Ben iPhone') {
  const { code } = await mint();
  const res = await redeem(code, name);
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; sessionId: string };
}

const sessions = () => r.db.db.prepare('SELECT id, method, kind, sub, revoked_at FROM device_sessions').all() as { id: string; method: string; kind: string; sub: string; revoked_at: string | null }[];
const pushRows = () => r.db.db.prepare('SELECT session_id FROM push_tokens').all() as { session_id: string }[];

beforeEach(() => {
  pairing.resetPairings();
  auth.resetFlows();
  r.db.db.exec("UPDATE device_sessions SET revoked_at = datetime('now') WHERE revoked_at IS NULL; DELETE FROM push_tokens");
});
afterEach(() => {
  vi.useRealTimers();
});

describe('minting a code', () => {
  it('needs the token or a session', async () => {
    expect((await req('POST', '/auth/app-pairings', {}, NONE)).status).toBe(401);
    expect((await req('POST', '/auth/app-pairings', {}, as('nope'))).status).toBe(401);
  });

  it('returns a single-use high-entropy code that expires in 5 minutes', async () => {
    const before = Date.now();
    const a = await mint();
    const b = await mint();
    expect(a.code).toMatch(/^omni_p_[A-Za-z0-9_-]{27}$/);
    expect(a.code).not.toBe(b.code);
    const ttl = Date.parse(a.expiresAt) - before;
    expect(a.expiresAt).toBe(new Date(a.expiresAt).toISOString());
    expect(ttl).toBeGreaterThan(299_000);
    expect(ttl).toBeLessThanOrEqual(301_000);
  });

  it('refuses a body that is not an object', async () => {
    expect((await req('POST', '/auth/app-pairings', '[1]')).status).toBe(400);
  });

  it('caps the codes open at once, and says when to retry', async () => {
    for (let i = 0; i < 5; i++) await mint();
    const res = await req('POST', '/auth/app-pairings', {});
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: string }).error).toMatch(/unused pairing codes/);
  });

  it('caps the codes minted in a minute even when each is spent', async () => {
    for (let i = 0; i < 20; i++) expect((await redeem((await mint()).code)).status).toBe(200);
    const res = await req('POST', '/auth/app-pairings', {});
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('is refused for a paired app, so a stolen app token cannot mint its replacement', async () => {
    const app1 = await pairApp();
    const res = await req('POST', '/auth/app-pairings', {}, as(app1.token));
    expect(res.status).toBe(403);
  });

  it('is refused for a Google session, whose pairing would outlive the account being unlinked', async () => {
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ada', email: null, name: null });
    const google = auth.createSession('Browser', 'browser', 'user_ada');
    const appGoogle = auth.createSession('App', 'app', 'user_ada');
    for (const t of [google.token, appGoogle.token]) expect((await req('POST', '/auth/app-pairings', {}, as(t))).status).toBe(403);
    auth.unlinkOwner();
    expect(sessions().filter((x) => x.method === 'pairing' && !x.revoked_at)).toHaveLength(0);
  });

  it('cannot be reached by a paired app trading its session for the install token', async () => {
    const phone = await pairApp();
    const pair = await req('POST', '/auth/pair', {}, as(phone.token));
    expect(pair.status).toBe(403);
    expect(pair.headers.get('set-cookie')).toBeNull();
    expect(await pair.text()).not.toContain(MASTER);
    // Its session cookie is no better.
    const viaCookie = await req('POST', '/auth/pair', {}, { ...NONE, cookie: `${sessionCookieName()}=${phone.token}` });
    expect(viaCookie.headers.get('set-cookie')).toBeNull();
    const mintAgain = await req('POST', '/auth/app-pairings', {}, as(phone.token));
    expect(mintAgain.status).toBe(403);
    auth.revokeSession(phone.sessionId);
    expect((await req('GET', '/auth', undefined, as(phone.token))).status).toBe(401);
  });

  it('still pairs a browser that submits the install token', async () => {
    const res = await req('POST', '/auth/pair', {}, as(MASTER));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(MASTER);
    expect((await req('POST', '/auth/pair', {}, NONE)).status).toBe(401);
  });

  it('cannot be reached by a Google session trading itself for the install token', async () => {
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ada', email: null, name: null });
    const google = auth.createSession('Browser', 'browser', 'user_ada');
    const pair = await req('POST', '/auth/pair', {}, as(google.token));
    expect(pair.status).toBe(403);
    expect(pair.headers.get('set-cookie')).toBeNull();
    auth.unlinkOwner();
  });
});

describe('redeeming a code', () => {
  it('gives a session token, never the install token, and the code works once', async () => {
    const { code } = await mint();
    const res = await redeem(code);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { token: string; sessionId: string };
    expect(body.token).toMatch(/^omni_s_[0-9a-f]{64}$/);
    expect(body.token).not.toBe(MASTER);
    expect(text).not.toContain(MASTER);
    const again = await redeem(code);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'Invalid or expired pairing code' });
  });

  it('answers a code nobody minted exactly as one already spent', async () => {
    const { code } = await mint();
    await redeem(code);
    const spent = await (await redeem(code)).json();
    const unknown = await (await redeem('omni_p_AAAAAAAAAAAAAAAAAAAAAAAAAAA')).json();
    expect(unknown).toEqual(spent);
  });

  it('refuses a code after its 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { code } = await mint();
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect((await redeem(code)).status).toBe(404);
  });

  it('spends a code once when two apps race for it', async () => {
    const { code } = await mint();
    const results = await Promise.all([redeem(code, 'A'), redeem(code, 'B')]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 404]);
  });

  it('validates the body', async () => {
    const { code } = await mint();
    const bad = async (body: unknown) => (await req('POST', '/auth/app-pairings/redeem', body, NONE)).status;
    expect(await bad({ code })).toBe(400);
    expect(await bad({ name: 'x' })).toBe(400);
    expect(await bad({ code, name: '   ' })).toBe(400);
    expect(await bad({ code, name: 'x'.repeat(101) })).toBe(400);
    expect(await bad({ code, name: 'bad\u0000name' })).toBe(400);
    expect(await bad({ code: 'x'.repeat(201), name: 'x' })).toBe(400);
    expect(await bad({ code: 5, name: 'x' })).toBe(400);
    expect(await bad('not json{')).toBe(400);
    expect(await bad(null)).toBe(400);
    // None of that spent the code.
    expect((await redeem(code)).status).toBe(200);
  });

  it('stores the trimmed name, as a paired app session', async () => {
    const { sessionId } = await pairApp('  Ben iPhone  ');
    const list = (await (await req('GET', '/auth/devices')).json()) as { devices: { id: string; name: string; kind: string; method: string }[] };
    expect(list.devices.find((d) => d.id === sessionId)).toMatchObject({ name: 'Ben iPhone', kind: 'app', method: 'pairing' });
    expect(sessions().find((s) => s.id === sessionId)).toMatchObject({ method: 'pairing', sub: '' });
  });

  it('spends a code once when many apps race for it', async () => {
    const { code } = await mint();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => redeem(code, `App ${i}`)));
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    // The losers are told the code is bad, or, past ten of them from one source, to slow down. None gets a session.
    expect(results.filter((x) => x.status === 404 || x.status === 429)).toHaveLength(24);
    expect(sessions().filter((x) => x.method === 'pairing' && !x.revoked_at)).toHaveLength(1);
  });

  it('hands out each racing code its own session', async () => {
    const codes = await Promise.all([mint(), mint(), mint()]);
    const results = await Promise.all(codes.flatMap(({ code }, i) => [redeem(code, `A${i}`), redeem(code, `B${i}`)]));
    const ok = await Promise.all(results.filter((x) => x.status === 200).map((x) => x.json() as Promise<{ token: string; sessionId: string }>));
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((x) => x.token)).size).toBe(3);
    expect(new Set(ok.map((x) => x.sessionId)).size).toBe(3);
  });

  describe('guessing', () => {
    const from = (source: string, code: string) =>
      app.request('http://127.0.0.1:4747/api/auth/app-pairings/redeem', {
        method: 'POST',
        body: JSON.stringify({ code, name: 'x' }),
        headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', ...NONE, 'x-forwarded-for': source },
      });

    it('locks out the source that keeps failing, valid code included, until the minute passes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { code } = await mint();
      for (let i = 0; i < 10; i++) expect((await redeem(`omni_p_guess${i}`)).status).toBe(404);
      const locked = await redeem(code);
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
      vi.setSystemTime(Date.now() + 61_000);
      expect((await redeem(code)).status).toBe(200);
    });

    it('counts callers behind a proxy by the address the proxy saw, so one cannot lock out the rest', async () => {
      const { code } = await mint();
      for (let i = 0; i < 10; i++) expect((await from('100.64.0.1', `omni_p_guess${i}`)).status).toBe(404);
      expect((await from('100.64.0.1', code)).status).toBe(429);
      // A client cannot name another address by putting it first: the proxy appends the real one.
      expect((await from('100.64.0.9, 100.64.0.1', code)).status).toBe(429);
      expect((await from('100.64.0.2', code)).status).toBe(200);
    });

    it('counts a Tailscale user by login', async () => {
      const { code } = await mint();
      const as_ = (login: string, c: string) =>
        app.request('http://127.0.0.1:4747/api/auth/app-pairings/redeem', {
          method: 'POST',
          body: JSON.stringify({ code: c, name: 'x' }),
          headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', ...NONE, 'tailscale-user-login': login, 'x-forwarded-for': '100.64.0.7' },
        });
      for (let i = 0; i < 10; i++) await as_('Eve@example.com', `omni_p_guess${i}`);
      expect((await as_('eve@example.com', code)).status).toBe(429);
      expect((await as_('ben@example.com', code)).status).toBe(200);
    });

    it('does not let many spoofed sources lock a real one out of a valid code', async () => {
      const { code } = await mint();
      for (let i = 0; i < 300; i++) await from(`10.9.${i >> 8}.${i & 255}`, `omni_p_bad${i}`);
      expect((await from('100.64.2.1', code)).status).toBe(200);
    });

    it('forgets the oldest source rather than refusing a new one when too many are tracked', async () => {
      for (let i = 0; i < 1100; i++) await from(`10.8.${i >> 8}.${i & 255}`, 'omni_p_x');
      const { code } = await mint();
      expect((await from('100.64.3.1', code)).status).toBe(200);
    });

    it('keys a request through the Connect tunnel by Cloudflare\'s address, not the tunnel\'s', async () => {
      const guard = await import('../request-guard.ts');
      const { Hono } = await import('hono');
      guard.useConnectHost(() => 'omni.example.com');
      try {
        const lone = new Hono();
        lone.all('*', (c) => c.json({ key: guard.clientKey(c) }));
        const key = async (headers: Record<string, string>) =>
          ((await (await lone.request('http://omni.example.com/x', { headers: { host: 'omni.example.com', ...headers } })).json()) as { key: string }).key;
        expect(await key({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '203.0.113.5' })).toBe('connect:203.0.113.5');
        expect(await key({ 'x-forwarded-for': '10.0.0.1, 203.0.113.9' })).toBe('connect:203.0.113.9');
        // tailscale serve naming the Connect host is not the tunnel.
        expect(await key({ 'x-forwarded-for': '100.64.0.3', 'tailscale-user-login': 'a@b.c' })).toBe('proxy:a@b.c');
        expect(await key({ host: '127.0.0.1:4747' })).toBe('direct:local');
      } finally {
        guard.useConnectHost(() => null);
      }
    });
  });

  it('is behind the host, origin and JSON checks that guard the rest of /api', async () => {
    const { code } = await mint();
    const post = (headers: Record<string, string>, body = JSON.stringify({ code, name: 'x' })) =>
      app.request('http://127.0.0.1:4747/api/auth/app-pairings/redeem', { method: 'POST', body, headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', ...NONE, ...headers } });
    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ host: 'evil.example' })).status).toBe(403);
    expect((await post({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({})).status).toBe(200);
  });

  it('opens nothing else: the neighbouring routes still need auth', async () => {
    expect((await req('GET', '/auth/app-pairings/redeem', undefined, NONE)).status).toBe(401);
    expect((await req('POST', '/auth/app-pairings/other', {}, NONE)).status).toBe(401);
    expect((await req('PUT', '/auth/push-token', {}, NONE)).status).toBe(401);
    expect((await req('GET', '/capabilities', undefined, NONE)).status).toBe(401);
  });

  it('caps live paired apps', async () => {
    const max = pairing.MAX_PAIRED_APPS;
    r.db.db.prepare("UPDATE device_sessions SET revoked_at = datetime('now') WHERE revoked_at IS NULL").run();
    for (let i = 0; i < max; i++) auth.createSession(`app ${i}`, 'app', '', 'pairing');
    const { code } = await mint();
    const res = await redeem(code);
    expect(res.status).toBe(429);
    // The refused redeem kept the code.
    const first = sessions().find((s) => s.method === 'pairing' && !s.revoked_at)!;
    auth.revokeSession(first.id);
    expect((await redeem(code)).status).toBe(200);
  });
});

describe('a paired app session', () => {
  it('works with no Google owner linked, and is not mistaken for the token or a Google session', async () => {
    expect(auth.owner()).toBeNull();
    const { token, sessionId } = await pairApp();
    expect((await req('GET', '/auth', undefined, as(token))).status).toBe(200);
    const account = (await (await req('GET', '/auth/account', undefined, as(token))).json()) as Record<string, unknown>;
    expect(account).toMatchObject({ via: 'session', sessionMethod: 'pairing' });
    expect(await (await req('GET', '/auth/account')).json()).toMatchObject({ via: 'token', sessionMethod: null });
    const caps = await (await req('GET', '/capabilities', undefined, as(token))).json();
    expect(caps).toEqual({
      api: 1,
      auth: { via: 'session', method: 'pairing', sessionId },
      pairing: { app: true, codeTtlSeconds: 300 },
      push: { registration: true, delivery: false },
      streams: { sse: true, closeOnRevoke: true },
    });
    const list = (await (await req('GET', '/auth/devices', undefined, as(token))).json()) as { devices: { id: string; current: boolean }[] };
    expect(list.devices.find((d) => d.id === sessionId)?.current).toBe(true);
  });

  it('cannot change the linked Google account', async () => {
    const { token } = await pairApp();
    expect((await req('POST', '/auth/google/link', {}, as(token))).status).toBe(403);
    expect((await req('DELETE', '/auth/google', undefined, as(token))).status).toBe(403);
  });

  it('is the install token only for capabilities: it reports it as a token', async () => {
    const caps = (await (await req('GET', '/capabilities')).json()) as { auth: unknown };
    expect(caps.auth).toEqual({ via: 'token', method: null, sessionId: null });
  });

  it('stops working once revoked, and survives the Google owner being linked, changed and unlinked', async () => {
    const { token, sessionId } = await pairApp();
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ada', email: null, name: null });
    const ada = auth.createSession('Ada browser', 'browser', 'user_ada');
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_bob', email: null, name: null });
    expect((await req('GET', '/auth', undefined, as(ada.token))).status).toBe(401);
    expect((await req('GET', '/auth', undefined, as(token))).status).toBe(200);
    auth.unlinkOwner();
    expect((await req('GET', '/auth', undefined, as(token))).status).toBe(200);
    expect((await req('DELETE', `/auth/devices/${sessionId}`)).status).toBe(200);
    expect((await req('GET', '/auth', undefined, as(token))).status).toBe(401);
    expect((await req('DELETE', `/auth/devices/${sessionId}`)).status).toBe(404);
  });

  it('can end its own session but not another device\'s', async () => {
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ada', email: null, name: null });
    const google = auth.createSession('Owner laptop', 'browser', 'user_ada');
    const other = await pairApp('other');
    const phone = await pairApp('phone');
    expect((await req('DELETE', `/auth/devices/${other.sessionId}`, undefined, as(phone.token))).status).toBe(403);
    const gid = sessions().find((x) => x.sub === 'user_ada' && !x.revoked_at)!.id;
    expect((await req('DELETE', `/auth/devices/${gid}`, undefined, as(phone.token))).status).toBe(403);
    expect((await req('GET', '/auth', undefined, as(google.token))).status).toBe(200);
    expect((await req('GET', '/auth', undefined, as(other.token))).status).toBe(200);
    expect((await req('DELETE', `/auth/devices/${phone.sessionId}`, undefined, as(phone.token))).status).toBe(200);
    expect((await req('GET', '/auth', undefined, as(phone.token))).status).toBe(401);
    // The Google session and the install token still manage the rest.
    expect((await req('DELETE', `/auth/devices/${other.sessionId}`, undefined, as(google.token))).status).toBe(200);
    auth.unlinkOwner();
  });

  it('signs itself out', async () => {
    const { token } = await pairApp();
    expect((await req('POST', '/auth/signout', {}, as(token))).status).toBe(200);
    expect((await req('GET', '/auth', undefined, as(token))).status).toBe(401);
  });

  it('expires after 90 idle days', async () => {
    const { token, sessionId } = await pairApp();
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    r.db.db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(old, sessionId);
    expect((await req('GET', '/auth', undefined, as(token))).status).toBe(401);
  });
});

describe('push token', () => {
  const PUSH = { token: 'AB'.repeat(32), platform: 'ios', environment: 'sandbox', bundleId: 'com.omni.app' };
  const put = (token: string, body: unknown = PUSH) => req('PUT', '/auth/push-token', body, as(token));

  it('belongs to an app session: the install token and a browser session are refused', async () => {
    expect((await req('PUT', '/auth/push-token', PUSH)).status).toBe(403);
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ada', email: null, name: null });
    const browser = auth.createSession('Browser', 'browser', 'user_ada');
    expect((await put(browser.token)).status).toBe(403);
    expect((await req('GET', '/auth/push-token', undefined, as(browser.token))).status).toBe(403);
    expect((await req('DELETE', '/auth/push-token', undefined, as(browser.token))).status).toBe(403);
    auth.unlinkOwner();
  });

  it('registers, reads back without echoing the token, replaces and deletes', async () => {
    const { token } = await pairApp();
    expect(await (await req('GET', '/auth/push-token', undefined, as(token))).json()).toEqual({ registered: false });
    expect(await (await put(token)).json()).toEqual({ ok: true });
    const text = await (await req('GET', '/auth/push-token', undefined, as(token))).text();
    expect(JSON.parse(text)).toMatchObject({ registered: true, platform: 'ios', environment: 'sandbox', bundleId: 'com.omni.app' });
    expect(text.toLowerCase()).not.toContain(PUSH.token.toLowerCase());
    expect((await put(token, { ...PUSH, token: 'cd'.repeat(32), environment: 'production' })).status).toBe(200);
    expect(pushRows()).toHaveLength(1);
    expect((await req('DELETE', '/auth/push-token', undefined, as(token))).status).toBe(200);
    expect((await req('DELETE', '/auth/push-token', undefined, as(token))).status).toBe(200);
    expect(pushRows()).toHaveLength(0);
  });

  it('validates the body', async () => {
    const { token } = await pairApp();
    for (const body of [
      {},
      { ...PUSH, token: 'zz'.repeat(32) },
      { ...PUSH, token: 'ab' },
      { ...PUSH, token: 'ab'.repeat(201) },
      { ...PUSH, platform: 'android' },
      { ...PUSH, environment: 'staging' },
      { ...PUSH, bundleId: 'x'.repeat(201) },
      'nope{',
    ]) {
      expect((await put(token, body)).status).toBe(400);
    }
    expect(pushRows()).toHaveLength(0);
  });

  it('moves a token that another session held, so one install never has two registrations', async () => {
    const one = await pairApp('one');
    const two = await pairApp('two');
    await put(one.token);
    await put(two.token);
    expect(pushRows().map((x) => x.session_id)).toEqual([two.sessionId]);
  });

  it('is not stored when the session is revoked while the request body is still arriving', async () => {
    const phone = await pairApp();
    let release!: () => void;
    const gate = new Promise<void>((x) => (release = x));
    const body = new ReadableStream({
      async start(c) {
        await gate;
        c.enqueue(new TextEncoder().encode(JSON.stringify(PUSH)));
        c.close();
      },
    });
    const pending = app.request('http://127.0.0.1:4747/api/auth/push-token', {
      method: 'PUT',
      headers: { ...HOST, ...as(phone.token), 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    await new Promise((x) => setTimeout(x, 20));
    auth.revokeSession(phone.sessionId);
    release();
    expect((await pending).status).toBe(401);
    expect(pushRows()).toHaveLength(0);
  });

  it('refuses to store a token for a session already revoked or idle past its expiry', async () => {
    const phone = await pairApp();
    const input = push.PushTokenBody.parse(PUSH);
    auth.revokeSession(phone.sessionId);
    expect(push.setPushToken(phone.sessionId, input)).toBe(false);
    expect(pushRows()).toHaveLength(0);
  });

  it('is never offered to a sender once its session is revoked or expired from idleness', async () => {
    const live = await pairApp('live');
    const idle = await pairApp('idle');
    const gone = await pairApp('gone');
    await put(live.token, { ...PUSH, token: '11'.repeat(32) });
    await put(idle.token, { ...PUSH, token: '22'.repeat(32) });
    await put(gone.token, { ...PUSH, token: '33'.repeat(32) });
    expect(pushTargets('needsInput').map((x) => x.sessionId).sort()).toEqual([live.sessionId, idle.sessionId, gone.sessionId].sort());
    r.db.db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(new Date(Date.now() - 91 * 86_400_000).toISOString(), idle.sessionId);
    r.db.db.prepare('UPDATE device_sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), gone.sessionId);
    expect(pushTargets('needsInput').map((x) => x.sessionId)).toEqual([live.sessionId]);
  });

  it('is deleted when its session is revoked, however that happens', async () => {
    const one = await pairApp('one');
    const two = await pairApp('two');
    const three = await pairApp('three');
    await put(one.token, { ...PUSH, token: '01'.repeat(32) });
    await put(two.token, { ...PUSH, token: '02'.repeat(32) });
    await put(three.token, { ...PUSH, token: '03'.repeat(32) });
    expect((await req('DELETE', `/auth/devices/${one.sessionId}`)).status).toBe(200);
    expect(pushRows().map((x) => x.session_id).sort()).toEqual([two.sessionId, three.sessionId].sort());
    expect((await req('POST', '/auth/signout', {}, as(two.token))).status).toBe(200);
    expect(pushRows().map((x) => x.session_id)).toEqual([three.sessionId]);
    // A revoked session's token cannot register again.
    expect((await put(one.token)).status).toBe(401);
  });
});

/** Reads a response body in the background, and says when it ends. */
function watch(res: Response) {
  const reader = res.body!.getReader();
  let ended = false;
  const done = (async () => {
    try {
      for (;;) if ((await reader.read()).done) break;
    } catch {
      // A cancelled body.
    }
    ended = true;
  })();
  const closed = (ms = 1000) => Promise.race([done.then(() => true), new Promise<boolean>((x) => setTimeout(x, ms, false))]);
  return { closed, ended: () => ended, cancel: () => reader.cancel() };
}

describe('SSE streams end with their session', () => {
  const stream = (path: string, token: string) => app.request(`http://127.0.0.1:4747/api${path}`, { headers: { ...HOST, ...as(token), accept: 'text/event-stream' } });
  const thread = (id: string) =>
    r.db.threads.create({
      id, channel_id: 'scratch', title: id, status: 'done', role: null, model: null, session_id: id, cwd: r.tmp,
      branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });

  it('closes every stream the revoked session holds, and only those', async () => {
    thread('sse-t1');
    const doomed = await pairApp('doomed');
    const bystander = await pairApp('bystander');
    const feeds = [watch(await stream('/feed', doomed.token)), watch(await stream('/feed', doomed.token))];
    const threadStream = watch(await stream('/threads/sse-t1/stream', doomed.token));
    const other = watch(await stream('/feed', bystander.token));
    const master = watch(await stream('/feed', MASTER));
    await new Promise((x) => setTimeout(x, 50));
    for (const w of [...feeds, threadStream, other, master]) expect(w.ended()).toBe(false);

    const started = Date.now();
    expect((await req('DELETE', `/auth/devices/${doomed.sessionId}`)).status).toBe(200);
    for (const w of [...feeds, threadStream]) expect(await w.closed()).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
    expect(other.ended()).toBe(false);
    expect(master.ended()).toBe(false);

    // Reconnecting is refused, and the others are still live.
    expect((await req('GET', '/feed', undefined, as(doomed.token))).status).toBe(401);
    await other.cancel();
    await master.cancel();
  });

  it('detaches the route from the bus when its stream is cut', async () => {
    const { bus } = await import('../bus.ts');
    const before = bus.listenerCount('feed');
    const { token, sessionId } = await pairApp();
    const w = watch(await stream('/threads/sse-t1/stream', token));
    await new Promise((x) => setTimeout(x, 50));
    expect(bus.listenerCount('feed')).toBeGreaterThan(before);
    auth.revokeSession(sessionId);
    expect(await w.closed()).toBe(true);
    await new Promise((x) => setTimeout(x, 50));
    expect(bus.listenerCount('feed')).toBe(before);
  });

  it('closes on signout', async () => {
    const { token } = await pairApp();
    const w = watch(await stream('/feed', token));
    await req('POST', '/auth/signout', {}, as(token));
    expect(await w.closed()).toBe(true);
  });

  it('closes a Google session\'s streams when the owner changes or is unlinked, and leaves a paired app\'s', async () => {
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ada', email: null, name: null });
    const ada = auth.createSession('Ada', 'browser', 'user_ada');
    const paired = await pairApp();
    const adaStream = watch(await stream('/feed', ada.token));
    const pairedStream = watch(await stream('/feed', paired.token));
    auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_bob', email: null, name: null });
    expect(await adaStream.closed()).toBe(true);
    expect(pairedStream.ended()).toBe(false);

    const bob = auth.createSession('Bob', 'browser', 'user_bob');
    const bobStream = watch(await stream('/feed', bob.token));
    auth.unlinkOwner();
    expect(await bobStream.closed()).toBe(true);
    expect(pairedStream.ended()).toBe(false);
    await pairedStream.cancel();
  });

  it('closes the streams of a session that went stale without a revoke', async () => {
    const idle = await pairApp('idle');
    const revokedBehindOurBack = await pairApp('behind');
    const fresh = await pairApp('fresh');
    const w1 = watch(await stream('/feed', idle.token));
    const w2 = watch(await stream('/feed', revokedBehindOurBack.token));
    const w3 = watch(await stream('/feed', fresh.token));
    r.db.db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(new Date(Date.now() - 91 * 86_400_000).toISOString(), idle.sessionId);
    r.db.db.prepare('UPDATE device_sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), revokedBehindOurBack.sessionId);
    auth.reconcileStreams();
    expect(await w1.closed()).toBe(true);
    expect(await w2.closed()).toBe(true);
    expect(w3.ended()).toBe(false);
    await w3.cancel();
  });

  it('does not count an open stream as use: a connection held past the idle expiry ends', async () => {
    const { token, sessionId } = await pairApp();
    const w = watch(await stream('/feed', token));
    const stale = new Date(Date.now() - 80 * 86_400_000).toISOString();
    r.db.db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(stale, sessionId);
    auth.reconcileStreams();
    expect(w.ended()).toBe(false);
    auth.reconcileStreams(Date.now() + 11 * 86_400_000);
    expect(await w.closed()).toBe(true);
    expect((r.db.db.prepare('SELECT last_seen_at FROM device_sessions WHERE id = ?').get(sessionId) as { last_seen_at: string }).last_seen_at).toBe(stale);
  });

  it('notices on its own timer, with no further request', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { token, sessionId } = await pairApp();
    const idle = await pairApp('idle');
    const w = watch(await stream('/feed', token));
    const live = watch(await stream('/feed', idle.token));
    const stale = new Date(Date.now() - 89 * 86_400_000).toISOString();
    r.db.db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(stale, sessionId);
    vi.advanceTimersByTime(15_000);
    expect(w.ended()).toBe(false);
    // Two days later both sessions are past 90 days only if unused: this one was used, the other was not.
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    r.db.db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), idle.sessionId);
    vi.advanceTimersByTime(15_000);
    expect(await w.closed()).toBe(true);
    expect(live.ended()).toBe(false);
    await live.cancel();
  });

  it('refuses to start a stream for a session revoked while the route was getting ready', async () => {
    const { sse } = { sse: await import('../sse.ts') };
    const { Hono } = await import('hono');
    const { sessionId } = await pairApp();
    auth.revokeSession(sessionId);
    const lone = new Hono();
    lone.use('*', async (c, next) => {
      c.set('omniAuth', { via: 'session', session: sessionId, kind: 'app', method: 'pairing' });
      await next();
    });
    let ran = false;
    lone.get('/s', (c) =>
      sse.sessionSSE(c, async () => {
        ran = true;
      }),
    );
    const w = watch(await lone.request('http://127.0.0.1:4747/s'));
    expect(await w.closed()).toBe(true);
    expect(ran).toBe(false);
  });
});
