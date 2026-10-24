import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { serve } from '@hono/node-server';
import { startFakeGoogle } from '@omni/test-fixtures/fake-google.mjs';
import { createBroker } from '@omni/oauth-broker/handler.ts';
import { startRunner } from './runner-boot.ts';

// Sign in with Google (apps/server/sign-in.ts) against a fake Google (packages/test-fixtures/fake-google.mjs) and the
// real OAuth broker handler on a local port: a browser on this Mac (loopback), the Mac app, and a phone over Tailscale
// (broker). Google only says who someone is; the allowlist decides, and each sign-in gets its own revocable session.

const CLIENTS = { desktop: 'desktop-client.apps.googleusercontent.com', web: 'web-client.apps.googleusercontent.com' };
const LOCAL = '127.0.0.1:4747';
const PHONE = 'bens-mac.tail1234.ts.net';
const google = await startFakeGoogle({ clients: { [CLIENTS.desktop]: 'desktop-secret', [CLIENTS.web]: 'web-secret' } });
const broker = serve({ fetch: createBroker({ returnOrigins: [`https://${PHONE}`] }), port: 0, hostname: '127.0.0.1' });
await new Promise((ok) => broker.once('listening', ok));
const BROKER = `http://127.0.0.1:${(broker.address() as { port: number }).port}/omni-oauth-broker`;
afterAll(async () => {
  await google.close();
  await new Promise((ok) => broker.close(ok));
});

await startRunner({
  OMNI_GOOGLE_AUTH_URL: google.endpoints.auth,
  OMNI_GOOGLE_TOKEN_URL: google.endpoints.token,
  OMNI_GOOGLE_JWKS_URL: google.endpoints.jwks,
  OMNI_GOOGLE_CLIENT_SECRET: 'desktop-secret',
  OMNI_GOOGLE_WEB_CLIENT_SECRET: 'web-secret',
});
const { app } = await import('../app.ts');
const { auth, db } = await import('../db.ts');
const { updateUserConfig, userConfig } = await import('../user-config.ts');
const { verifyIdToken } = await import('../google.ts');
const { cookieName, sessionCookieName } = await import('../api-token.ts');
const { resetAttempts } = await import('../sign-in.ts');

function configure(auth: Partial<ReturnType<typeof userConfig>['auth']> = {}) {
  updateUserConfig({ auth: { googleClientId: CLIENTS.desktop, googleWebClientId: CLIENTS.web, brokerUrl: BROKER, allowedEmails: [], allowedHd: '', ...auth } });
}

beforeEach(() => {
  configure();
  resetAttempts();
  delete process.env.OMNI_TAILSCALE_LOGIN;
});
afterEach(() => vi.useRealTimers());

/** A browser: its own cookies, its Host, and no token unless it was paired. */
class Browser {
  jar = new Map<string, string>();
  constructor(
    readonly host = LOCAL,
    readonly https = false,
  ) {}

  pair() {
    this.jar.set(cookieName(), process.env.OMNI_TOKEN!);
    return this;
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(`${this.https ? 'https' : 'http'}://${this.host}${path}`, {
      method,
      headers: {
        host: this.host,
        authorization: '',
        ...(this.https ? { 'x-forwarded-proto': 'https', 'x-forwarded-host': this.host } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (/Max-Age=0/i.test(line) || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  async json(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
    const res = await this.request(method, path, body, headers);
    return { status: res.status, body: (await res.json()) as any, res };
  }
}

/** Google's consent page: the account picked, or cancelled. Returns where Google sends the browser back. */
async function consent(url: string, pick: { email?: string; deny?: boolean }) {
  const u = new URL(url);
  if (pick.email) u.searchParams.set('login_hint', pick.email);
  if (pick.deny) u.searchParams.set('deny', '1');
  const res = await fetch(u, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return res.headers.get('location')!;
}

/** The whole loopback dance for `browser`: start, Google, the callback on this server, finish. */
async function signInHere(browser: Browser, email: string) {
  const start = await browser.json('POST', '/api/auth/google/start', { client: 'web' });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const back = new URL(await consent(start.body.url, { email }));
  const callback = await browser.request('GET', back.pathname + back.search, undefined, { 'sec-fetch-site': 'cross-site' });
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toBe(`/#/?signin=${encodeURIComponent(start.body.attempt)}`);
  return browser.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt });
}

/** The phone's dance: start, Google, the broker, the callback here in the same browser, finish. */
async function signInPhone(phone: Browser, email: string) {
  const start = await phone.json('POST', '/api/auth/google/start', { client: 'web' });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const fromBroker = await fetch(await consent(start.body.url, { email }), { redirect: 'manual' });
  const back = new URL(fromBroker.headers.get('location')!);
  expect(back.origin).toBe(`https://${PHONE}`);
  const callback = await phone.request('GET', back.pathname + back.search, undefined, { 'sec-fetch-site': 'cross-site' });
  expect(callback.status).toBe(302);
  return { start, done: await phone.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt }) };
}

describe('the ID token check', () => {
  const account = google.accounts[0];
  const ok = { audience: CLIENTS.desktop, nonce: 'n-1' };

  it('takes a token Google signed for this client and this sign-in', async () => {
    const claims = await verifyIdToken(google.idTokenFor(account, CLIENTS.desktop, 'n-1'), ok);
    expect(claims).toMatchObject({ email: 'ada@example.com', sub: account.sub, email_verified: true });
  });

  it('refuses another client, another issuer, a stale token, another sign-in and an unverified address', async () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: 'https://accounts.google.com', aud: CLIENTS.desktop, sub: '1', email: 'ada@example.com', email_verified: true, nonce: 'n-1', iat: now, exp: now + 600 };
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['audience', { aud: CLIENTS.web }, /did not check out/],
      ['issuer', { iss: 'https://evil.example' }, /did not check out/],
      ['expiry', { exp: now - 3600, iat: now - 7200 }, /expired/],
      ['nonce', { nonce: 'n-2' }, /did not check out/],
      ['verified', { email_verified: false }, /not verified/],
    ];
    for (const [what, change, error] of cases) {
      await expect(verifyIdToken(google.signIdToken({ ...base, ...change }), ok), what).rejects.toThrow(error);
    }
  });

  it('refuses a token whose signature or algorithm does not hold', async () => {
    const good = google.idTokenFor(account, CLIENTS.desktop, 'n-1');
    const [head, , sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(good.split('.')[1], 'base64url').toString()), email: 'mallory@example.net' })).toString('base64url');
    await expect(verifyIdToken(`${head}.${forged}.${sig}`, ok)).rejects.toThrow(/did not check out/);
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyIdToken(google.signIdToken({ aud: CLIENTS.desktop, nonce: 'n-1' }, stranger), ok)).rejects.toThrow(/did not check out/);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${good.split('.')[1]}.`;
    await expect(verifyIdToken(none, ok)).rejects.toThrow(/did not check out/);
  });
});

describe('signing in on this Mac', () => {
  it('turns away a browser that does not hold the token while nobody owns the install', async () => {
    const stranger = new Browser();
    const can = await stranger.json('GET', '/api/auth/google');
    expect(can.body).toMatchObject({ mode: 'loopback', configured: true, available: false, reason: expect.stringMatching(/Pair with the install token/) });
    expect((await stranger.json('POST', '/api/auth/google/start', { client: 'web' })).status).toBe(403);
  });

  it('lets a paired browser sign in first and make its account the allowlist, trading the token cookie for a session', async () => {
    const paired = new Browser().pair();
    expect((await paired.json('GET', '/api/auth/google')).body).toMatchObject({ available: true });
    const done = await signInHere(paired, 'ada@example.com');
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, claimed: true, user: { email: 'ada@example.com', name: 'Ada Lovelace' }, device: { kind: 'browser' } });
    expect(userConfig().auth.allowedEmails).toEqual(['ada@example.com']);
    const cookie = done.res.headers.getSetCookie().find((l) => l.startsWith(`${sessionCookieName()}=`))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api(;|$)/);
    expect(Number(cookie.match(/Max-Age=(\d+)/)![1])).toBeGreaterThan(29 * 86_400);
    expect(paired.jar.has(cookieName())).toBe(false);
    const me = await paired.json('GET', '/api/auth');
    expect(me.body).toMatchObject({ via: 'session', user: { email: 'ada@example.com' }, device: { id: done.body.device.id }, google: { allowedEmails: ['ada@example.com'] } });
    // The session never reaches the database in the clear.
    const credential = paired.jar.get(sessionCookieName())!;
    expect(JSON.stringify(db.prepare('SELECT * FROM auth_sessions').all())).not.toContain(credential.split('.')[2]);
  });

  it('then signs in an allowed account from any browser here, and refuses the rest', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    expect((await signInHere(new Browser(), 'ada@example.com')).status).toBe(200);
    const mallory = new Browser();
    const refused = await signInHere(mallory, 'mallory@example.net');
    expect(refused).toMatchObject({ status: 403, body: { error: 'mallory@example.net is not allowed to sign in to this Omni.' } });
    expect(mallory.jar.has(sessionCookieName())).toBe(false);
    expect((await signInHere(new Browser(), 'unverified@example.com')).body.error).toMatch(/not verified/);
    // A paired browser cannot claim an install that already has an owner.
    expect((await signInHere(new Browser().pair(), 'mallory@example.net')).status).toBe(403);
    expect(userConfig().auth.allowedEmails).toEqual(['ada@example.com']);
  });

  it('admits a whole Workspace domain when auth.allowedHd names it, by the hd claim, not the address', async () => {
    configure({ allowedEmails: ['ada@example.com'], allowedHd: 'example.org' });
    expect((await signInHere(new Browser(), 'grace@example.org')).body).toMatchObject({ ok: true, user: { email: 'grace@example.org' } });
    expect((await signInHere(new Browser(), 'outsider@example.org')).body.error).toBe('outsider@example.org is not allowed to sign in to this Omni.');
  });

  it('narrows Google’s account chooser to the domain only when nobody else is on the allowlist', async () => {
    const hdOf = async () => new URL((await new Browser().json('POST', '/api/auth/google/start', { client: 'web' })).body.url).searchParams.get('hd');
    configure({ allowedEmails: ['ada@example.com'], allowedHd: 'example.org' });
    expect(await hdOf()).toBeNull();
    configure({ allowedHd: 'example.org' });
    expect(await hdOf()).toBe('example.org');
  });

  it('forgets an attempt after ten minutes, and the oldest of fifty when more start', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    vi.useFakeTimers({ toFake: ['Date'] });
    const late = new Browser();
    const start = await late.json('POST', '/api/auth/google/start', { client: 'web' });
    const back = new URL(await consent(start.body.url, { email: 'ada@example.com' }));
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    expect((await late.request('GET', back.pathname + back.search)).status).toBe(410);

    const first = new Browser();
    const oldest = await first.json('POST', '/api/auth/google/start', { client: 'web' });
    for (let i = 0; i < 50; i++) await new Browser().json('POST', '/api/auth/google/start', { client: 'web' });
    const gone = new URL(await consent(oldest.body.url, { email: 'ada@example.com' }));
    expect((await first.request('GET', gone.pathname + gone.search)).status).toBe(410);
  });

  it('says what is missing before sending anyone to Google when the client secret is not set', async () => {
    const kept = process.env.OMNI_GOOGLE_CLIENT_SECRET;
    delete process.env.OMNI_GOOGLE_CLIENT_SECRET;
    try {
      const res = await new Browser().pair().json('POST', '/api/auth/google/start', { client: 'web' });
      expect(res).toMatchObject({ status: 409, body: { error: expect.stringMatching(/GOOGLE_OAUTH_CLIENT_SECRET under Settings > Secrets/) } });
    } finally {
      process.env.OMNI_GOOGLE_CLIENT_SECRET = kept;
    }
  });

  it('will not claim an install whose config file does not parse, which would overwrite it with the defaults', async () => {
    const { writeFileSync, readFileSync } = await import('node:fs');
    const { configPath } = await import('../user-config.ts');
    configure();
    const good = readFileSync(configPath(), 'utf8');
    try {
      const paired = new Browser().pair();
      const start = await paired.json('POST', '/api/auth/google/start', { client: 'web' });
      const back = new URL(await consent(start.body.url, { email: 'ada@example.com' }));
      await paired.request('GET', back.pathname + back.search);
      writeFileSync(configPath(), good.replace('{', '{,'));
      const res = await paired.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt });
      expect(res).toMatchObject({ status: 409, body: { error: expect.stringMatching(/omni.config.json has an error/) } });
      expect(readFileSync(configPath(), 'utf8')).toBe(good.replace('{', '{,'));
    } finally {
      writeFileSync(configPath(), good);
    }
  });

  it('signs a browser that signs in again out of the session it had, so no device is left that nobody holds', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    const browser = new Browser();
    const first = await signInHere(browser, 'ada@example.com');
    const again = await signInHere(browser, 'ada@example.com');
    expect(again.status).toBe(200);
    const ids = auth.devices().map((d) => d.id);
    expect(ids).toContain(again.body.device.id);
    expect(ids).not.toContain(first.body.device.id);
  });

  it('finishes only in the browser that started, once, and says when Google was cancelled', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    const starter = new Browser();
    const start = await starter.json('POST', '/api/auth/google/start', { client: 'web' });
    const back = new URL(await consent(start.body.url, { email: 'ada@example.com' }));
    // Another browser following the same link (sent to it, say) has no binding cookie.
    const other = await new Browser().request('GET', back.pathname + back.search);
    expect(other.status).toBe(403);
    expect(await other.text()).toMatch(/started in another browser/);
    expect((await starter.request('GET', back.pathname + back.search)).status).toBe(302);
    expect((await starter.request('GET', back.pathname + back.search)).status).toBe(410);
    expect((await new Browser().json('POST', '/api/auth/google/finish', { attempt: start.body.attempt })).status).toBe(403);
    expect((await starter.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt })).status).toBe(200);
    expect((await starter.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt })).status).toBe(410);

    const cancelled = new Browser();
    const again = await cancelled.json('POST', '/api/auth/google/start', { client: 'web' });
    const denied = new URL(await consent(again.body.url, { deny: true }));
    expect((await cancelled.request('GET', denied.pathname + denied.search)).status).toBe(302);
    expect((await cancelled.json('POST', '/api/auth/google/finish', { attempt: again.body.attempt })).body.error).toBe('You cancelled signing in with Google.');
  });

  it('answers Google’s cross-site redirect only on an allowed Host and, through serve, for the owner’s Tailscale login', async () => {
    const res = await app.request(`http://evil.example/api/auth/google/callback?state=x&code=y`, { headers: { host: 'evil.example', authorization: '' } });
    expect(res.status).toBe(403);
    process.env.OMNI_TAILSCALE_LOGIN = 'ben@example.com';
    const viaServe = await app.request(`http://${LOCAL}/api/auth/google/callback?state=x&code=y`, { headers: { host: LOCAL, authorization: '', 'x-forwarded-for': '100.64.0.9' } });
    expect(viaServe.status).toBe(403);
    // The owner's own login gets through to the sign-in it started.
    configure({ allowedEmails: ['ada@example.com'] });
    const owner = new Browser(PHONE, true);
    const start = await owner.json('POST', '/api/auth/google/start', { client: 'web' }, { 'tailscale-user-login': 'ben@example.com' });
    expect(start.status).toBe(200);
    // Anything else under /api/auth/google still needs the token.
    expect((await new Browser().json('GET', '/api/auth/google/elsewhere')).status).toBe(401);
  });

  it('keeps every other guard on a session: no cross-site use, and no trading it for the install token', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    const browser = new Browser();
    await signInHere(browser, 'ada@example.com');
    const crossSite = await browser.request('POST', '/api/threads', { prompt: 'x' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(crossSite.status).toBe(403);
    expect((await browser.json('POST', '/api/auth/pair')).status).toBe(403);
    expect(browser.jar.has(cookieName())).toBe(false);
    expect((await browser.json('GET', '/api/threads')).status).toBe(200);
  });

  it('signs out by revoking the device, and taking the address off the allowlist locks every session out at once', async () => {
    configure({ allowedEmails: ['ada@example.com', 'grace@example.org'] });
    const one = new Browser();
    const two = new Browser();
    await signInHere(one, 'ada@example.com');
    await signInHere(two, 'grace@example.org');
    const kept = one.jar.get(sessionCookieName())!;
    expect((await one.json('POST', '/api/auth/signout')).status).toBe(200);
    expect(one.jar.has(sessionCookieName())).toBe(false);
    one.jar.set(sessionCookieName(), kept);
    expect((await one.json('GET', '/api/auth')).status).toBe(401);
    expect((await two.json('GET', '/api/auth')).status).toBe(200);
    configure({ allowedEmails: ['ada@example.com'] });
    expect((await two.json('GET', '/api/auth')).status).toBe(401);
  });
});

describe('sessions', () => {
  it('slide: a use five minutes on moves the expiry 30 days out and marks the device seen; an expired one is gone', () => {
    const user = auth.upsertUser({ sub: 'slide', email: 'ada@example.com' });
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const { credential, device } = auth.signIn({ userId: user.id, name: 'Test', kind: 'browser' }, t0);
    expect(auth.check(credential, t0 + 60_000)?.renewed).toBe(false);
    const later = auth.check(credential, t0 + 20 * 86_400_000)!;
    expect(later.renewed).toBe(true);
    expect(Date.parse(later.expiresAt)).toBe(t0 + 50 * 86_400_000);
    expect(auth.devices(t0 + 20 * 86_400_000).find((d) => d.id === device.id)?.last_seen_at).toBe(new Date(t0 + 20 * 86_400_000).toISOString());
    expect(auth.check(credential, t0 + 51 * 86_400_000)).toBeNull();
    expect(auth.check(credential.slice(0, -1) + 'x', t0 + 21 * 86_400_000)).toBeNull();
    expect(auth.check('omni_s1.nope.nope', t0)).toBeNull();
    // A month after it lapsed, the device leaves the table.
    auth.prune(t0 + 81 * 86_400_000);
    expect(db.prepare('SELECT 1 FROM auth_devices WHERE id = ?').get(device.id)).toBeUndefined();
  });
});

describe('the Mac app', () => {
  const mac = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://${LOCAL}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { host: LOCAL, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('signs in with the install token and a claim, through ASWebAuthenticationSession’s omni:// callback', async () => {
    expect((await new Browser().json('POST', '/api/auth/google/start', { client: 'mac' })).status).toBe(403);
    const start = (await (await mac('/api/auth/google/start', { client: 'mac', deviceName: "Ada's MacBook Pro" })).json()) as any;
    expect(start).toMatchObject({ mode: 'loopback', attempt: expect.any(String), claim: expect.any(String) });
    expect(new URL(start.url).searchParams.get('redirect_uri')).toBe(`http://${LOCAL}/api/auth/google/callback`);
    const back = new URL(await consent(start.url, { email: 'ada@example.com' }));
    const callback = await mac(back.pathname + back.search, undefined, { authorization: '' });
    expect(callback.headers.get('location')).toBe(`omni://signin?attempt=${encodeURIComponent(start.attempt)}`);
    expect((await mac('/api/auth/google/finish', { attempt: start.attempt, claim: 'wrong' })).status).toBe(403);
    const done = (await (await mac('/api/auth/google/finish', { attempt: start.attempt, claim: start.claim })).json()) as any;
    expect(done).toMatchObject({ ok: true, claimed: true, device: { kind: 'mac', name: "Ada's MacBook Pro" }, credential: expect.stringMatching(/^omni_s1\./) });
    const bearer = { authorization: `Bearer ${done.credential}` };
    expect(await (await mac('/api/auth', undefined, bearer)).json()).toMatchObject({ via: 'session', device: { kind: 'mac' } });
    expect((await mac('/api/auth/signout', {}, bearer)).status).toBe(200);
    expect((await mac('/api/auth', undefined, bearer)).status).toBe(401);
    // The install token keeps working for everything else.
    expect((await mac('/api/auth')).status).toBe(200);
  });
});

describe('a phone over Tailscale, through the broker', () => {
  it('lets Google return to the broker, which sends the same browser back here with the code', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    const phone = new Browser(PHONE, true);
    expect((await phone.json('GET', '/api/auth/google')).body).toEqual({ mode: 'broker', configured: true, available: true, reason: null });
    const start = await phone.json('POST', '/api/auth/google/start', { client: 'web' });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const authorize = new URL(start.body.url).searchParams;
    expect(authorize.get('redirect_uri')).toBe(`${BROKER}/callback`);
    expect(authorize.get('client_id')).toBe(CLIENTS.web);
    expect(authorize.get('state')).toBe(`${start.body.attempt}.${Buffer.from(`https://${PHONE}`).toString('base64url')}`);
    const toBroker = await consent(start.body.url, { email: 'ada@example.com' });
    expect(toBroker.startsWith(`${BROKER}/callback?`)).toBe(true);
    const fromBroker = await fetch(toBroker, { redirect: 'manual' });
    const back = new URL(fromBroker.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(`https://${PHONE}/api/auth/google/callback`);
    const callback = await phone.request('GET', back.pathname + back.search, undefined, { 'sec-fetch-site': 'cross-site' });
    expect(callback.headers.get('location')).toBe(`/#/?signin=${encodeURIComponent(start.body.attempt)}`);
    const done = await phone.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt });
    expect(done.body).toMatchObject({ ok: true, user: { email: 'ada@example.com' }, device: { kind: 'browser' } });
    expect(phone.jar.has(sessionCookieName())).toBe(true);
    expect(done.res.headers.getSetCookie().join()).toMatch(/Secure/);
    expect((await phone.json('GET', '/api/threads')).status).toBe(200);
  });

  it('gives nothing to someone who starts a sign-in and gets the owner to approve it at Google', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    const attacker = new Browser(PHONE, true);
    const start = await attacker.json('POST', '/api/auth/google/start', { client: 'web' });
    // The owner opens the Google link they were sent, approves, and the broker brings their browser back to Omni.
    const back = new URL((await fetch(await consent(start.body.url, { email: 'ada@example.com' }), { redirect: 'manual' })).headers.get('location')!);
    const owner = new Browser(PHONE, true);
    const refused = await owner.request('GET', back.pathname + back.search, undefined, { 'sec-fetch-site': 'cross-site' });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/started in another browser/);
    // The code never reached the attempt, so the one who started it is still waiting.
    expect((await attacker.json('POST', '/api/auth/google/finish', { attempt: start.body.attempt })).status).toBe(202);
    expect(attacker.jar.has(sessionCookieName())).toBe(false);
  });

  it('keeps the Mac app on localhost, where Google can send its sheet back to omni://', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    const res = await app.request(`https://${PHONE}/api/auth/google/start`, {
      method: 'POST',
      headers: { host: PHONE, 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'mac' }),
    });
    expect(res.status).toBe(400);
  });

  it('says why it cannot, with no broker set up', async () => {
    configure({ allowedEmails: ['ada@example.com'], brokerUrl: '' });
    const phone = new Browser(PHONE, true);
    expect((await phone.json('GET', '/api/auth/google')).body).toMatchObject({ mode: 'broker', configured: false, available: false, reason: expect.stringMatching(/broker/) });
    expect((await phone.json('POST', '/api/auth/google/start', { client: 'web' })).status).toBe(409);
  });
});

describe('Settings > Devices', () => {
  it('lists every signed-in browser and Mac with the one asking marked, and revokes one at a time', async () => {
    configure({ allowedEmails: ['ada@example.com'] });
    for (const d of auth.devices()) auth.revokeDevice(d.id);
    const phone = new Browser(PHONE, true);
    const laptop = new Browser();
    await signInHere(laptop, 'ada@example.com');
    await signInPhone(phone, 'ada@example.com');

    const listed = await laptop.json('GET', '/api/auth/devices');
    expect(listed.body).toHaveLength(2);
    expect(listed.body.find((d: any) => d.current)).toMatchObject({ kind: 'browser', email: 'ada@example.com', current: true });
    const other = listed.body.find((d: any) => !d.current);
    expect(other).toMatchObject({ name: 'Browser', createdAt: expect.any(String), lastSeenAt: expect.any(String), expiresAt: expect.any(String) });
    // The install token is not a device, and sees none of them as its own.
    expect((await app.request('/api/auth/devices')).status).toBe(200);
    expect(((await (await app.request('/api/auth/devices')).json()) as any[]).every((d) => !d.current)).toBe(true);

    expect(await laptop.json('DELETE', `/api/auth/devices/${other.id}`)).toMatchObject({ status: 200, body: { ok: true, current: false } });
    expect((await phone.json('GET', '/api/threads')).status).toBe(401);
    expect((await laptop.json('DELETE', `/api/auth/devices/${other.id}`)).status).toBe(404);

    const self = (await laptop.json('GET', '/api/auth/devices')).body[0];
    const out = await laptop.json('DELETE', `/api/auth/devices/${self.id}`);
    expect(out.body).toEqual({ ok: true, current: true });
    expect(laptop.jar.has(sessionCookieName())).toBe(false);
    expect(await (await app.request('/api/auth/devices')).json()).toEqual([]);
  });
});
