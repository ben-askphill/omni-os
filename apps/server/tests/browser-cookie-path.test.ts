import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { startRunner } from './runner-boot.ts';

// A browser paired over plain HTTP holds its session in a cookie, and cookies ignore ports: whatever the browser sends
// Omni on 127.0.0.1 it also sends every other service on 127.0.0.1 whose path matches. Two real listeners on this host
// play it out: Omni, and a sibling service that writes down every cookie a browser sends it and replays them to Omni.
// The browser is a cookie jar with the RFC 6265 rules a browser applies: host-only cookies match the host whatever
// the port, and a cookie goes with every request whose path is under its Path.

const h = await startRunner();
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const { sessionCookieName } = await import('../api-token.ts');
const auth = await import('../google-auth.ts');

const omni = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(omni, 'listening');
const OMNI = `http://127.0.0.1:${(omni.address() as AddressInfo).port}`;

/** What the sibling service was sent: one Cookie header per request. */
const seen: string[] = [];
const sibling = createServer((req, res) => {
  if (req.headers.cookie) seen.push(req.headers.cookie);
  res.end('ok');
});
sibling.listen(0, '127.0.0.1');
await once(sibling, 'listening');
const SIBLING = `http://127.0.0.1:${(sibling.address() as AddressInfo).port}`;

afterAll(() => {
  omni.close();
  sibling.close();
  omni.closeAllConnections();
});

type Cookie = { name: string; value: string; host: string; path: string; secure: boolean };

/** A browser's cookie jar for host-only cookies (RFC 6265 5.3 and 5.4): the port takes no part in matching. */
class Jar {
  cookies: Cookie[] = [];
  take(url: string, res: Response) {
    const u = new URL(url);
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const attr = (k: string) => attrs.find((a) => a.toLowerCase().startsWith(`${k}=`))?.slice(k.length + 1);
      const path = attr('path') ?? (u.pathname.replace(/\/[^/]*$/, '') || '/');
      const gone = Number(attr('max-age') ?? '1') <= 0;
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.host === u.hostname && c.path === path));
      if (!gone) this.cookies.push({ name, value, host: u.hostname, path, secure: attrs.some((a) => a.toLowerCase() === 'secure') });
    }
  }
  /** The Cookie header a browser sends to `url`: longer paths first. */
  header(url: string): string {
    const u = new URL(url);
    const pathMatch = (p: string) => u.pathname === p || (u.pathname.startsWith(p) && (p.endsWith('/') || u.pathname[p.length] === '/'));
    return this.cookies
      .filter((c) => c.host === u.hostname && pathMatch(c.path) && (!c.secure || u.protocol === 'https:' || u.hostname === '127.0.0.1'))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }
  /** A request the page makes, with whatever the jar holds for that URL. */
  async fetch(url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const cookie = this.header(url);
    const res = await fetch(url, { redirect: 'manual', ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
    this.take(url, res);
    return res;
  }
  session() {
    return this.cookies.find((c) => c.name === sessionCookieName());
  }
}

/** What the Web UI's own fetches carry, on Omni's origin. */
const fromPage = { origin: OMNI, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' };

/** A browser that pairs the way the pairing screen does, and the base it was told to use. */
async function pairedBrowser() {
  const jar = new Jar();
  const res = await jar.fetch(`${OMNI}/api/auth/pair`, { method: 'POST', headers: { ...fromPage, authorization: `Bearer ${process.env.OMNI_TOKEN}` } });
  expect(res.status).toBe(200);
  const api = ((await res.json()) as { api?: string }).api ?? '/api';
  return { jar, api };
}

/** The browser visits pages on the sibling service, at the paths an Omni cookie could match. */
async function visitSibling(jar: Jar) {
  seen.length = 0;
  for (const path of ['/', '/api', '/api/threads', '/api/auth', `/api/k/${randomBytes(16).toString('hex')}/threads`]) {
    await jar.fetch(`${SIBLING}${path}`, { headers: { 'sec-fetch-site': 'same-origin' } });
  }
  return [...seen];
}

/** The sibling sends a captured Cookie header to Omni itself, naming Omni's own Host, as any process on this host can. */
const replay = (cookie: string, path = '/api/channels') => fetch(`${OMNI}${path}`, { headers: { cookie } });

describe("a paired browser's session cookie, with another service on a sibling port", () => {
  it('works for the browser on Omni, never reaches the sibling, and the sibling has nothing to replay', async () => {
    const { jar, api } = await pairedBrowser();
    expect((await jar.fetch(`${OMNI}${api}/channels`, { headers: fromPage })).status).toBe(200);

    const captured = await visitSibling(jar);
    expect(captured.join('\n')).not.toContain(sessionCookieName());

    for (const cookie of captured) {
      expect((await replay(cookie)).status).toBe(401);
      expect((await replay(cookie, '/api/auth')).status).toBe(401);
    }
  });

  it("refuses the cookie's value sent from anywhere without its path, as a cookie or as a bearer token", async () => {
    const { jar, api } = await pairedBrowser();
    const value = jar.session()!.value;
    const cookie = `${sessionCookieName()}=${value}`;
    expect((await replay(cookie)).status).toBe(401);
    expect((await replay(cookie, `/api/k/${randomBytes(16).toString('hex')}/channels`)).status).toBe(401);
    expect((await fetch(`${OMNI}/api/channels`, { headers: { authorization: `Bearer ${value}` } })).status).toBe(401);
    expect((await replay(cookie, `${api}/channels`)).status).toBe(200);
  });

  it('moves a browser paired before the keyed path onto one at its next check, keeping its device and ending the old cookie', async () => {
    const old = auth.createSession('Chrome', 'browser', '', 'token');
    const jar = new Jar();
    jar.cookies.push({ name: sessionCookieName(), value: old.token, host: '127.0.0.1', path: '/api', secure: false });
    // Until the page next loads, the old cookie keeps working: an open tab is not sent to the pairing screen.
    expect((await jar.fetch(`${OMNI}/api/channels`, { headers: fromPage })).status).toBe(200);

    const res = await jar.fetch(`${OMNI}/api/auth`, { headers: fromPage });
    expect(res.status).toBe(200);
    const { api } = (await res.json()) as { api: string };
    expect(api).toMatch(/^\/api\/k\/[0-9a-f]{32}$/);
    expect(jar.cookies.filter((c) => c.name === sessionCookieName()).map((c) => c.path)).toEqual([api]);
    expect(auth.listSessions().filter((s) => s.id === old.id)).toHaveLength(1);

    expect((await replay(`${sessionCookieName()}=${old.token}`)).status).toBe(401);
    expect((await jar.fetch(`${OMNI}${api}/channels`, { headers: fromPage })).status).toBe(200);
    expect((await visitSibling(jar)).join('\n')).not.toContain(sessionCookieName());
  });

  it("pairs the desktop app's window on a keyed path and keeps one session across its loads", async () => {
    const jar = new Jar();
    const pair = async () => {
      const { nonce } = (await (await fetch(`${OMNI}/api/auth/desktop-nonce`, { method: 'POST', headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}` } })).json()) as { nonce: string };
      const res = await jar.fetch(`${OMNI}/api/auth/desktop-pair?nonce=${nonce}`, { headers: { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' } });
      expect(res.status).toBe(302);
      return new URL(res.headers.get('location')!, OMNI).searchParams.get('api');
    };
    const before = auth.listSessions().length;
    const api = await pair();
    expect(api).toMatch(/^\/api\/k\/[0-9a-f]{32}$/);
    const device = jar.cookies.find((c) => c.name.startsWith('omni_device_'))!;
    expect(device.path).toBe('/api/auth/desktop-pair');
    expect(await pair()).toBe(api);
    expect(auth.listSessions()).toHaveLength(before + 1);
    expect((await jar.fetch(`${OMNI}${api}/channels`, { headers: fromPage })).status).toBe(200);
    expect((await visitSibling(jar)).join('\n')).not.toContain(sessionCookieName());

    // The id cookie is set only with the session cookie, so the two run out together. Once both have, the window gets a
    // session it holds again rather than a path whose cookie is gone.
    const reuse = await fetch(`${OMNI}/api/auth/desktop-nonce`, { method: 'POST', headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}` } });
    const { nonce } = (await reuse.json()) as { nonce: string };
    const again = await fetch(`${OMNI}/api/auth/desktop-pair?nonce=${nonce}`, { redirect: 'manual', headers: { cookie: jar.header(`${OMNI}/api/auth/desktop-pair`), 'sec-fetch-site': 'none' } });
    expect(again.headers.getSetCookie()).toEqual([]);
    jar.cookies = [];
    const fresh = await pair();
    expect(fresh).not.toBe(api);
    expect((await jar.fetch(`${OMNI}${fresh}/channels`, { headers: fromPage })).status).toBe(200);
  });

  // A phone's browser that opens the pairing QR's link (auth-api.ts GET /pair-link) gets the same keyed cookie, and
  // learns its path from the answer's body, never from an address or a cookie the sibling could be sent.
  it("pairs a phone's browser from the QR link on a keyed path that never reaches the sibling", async () => {
    const { mintPairing } = await import('../app-pairing.ts');
    const jar = new Jar();
    const res = await jar.fetch(`${OMNI}/api/auth/pair-link?code=${encodeURIComponent(mintPairing().code)}`, { headers: { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const api = /localStorage\.setItem\("omni\.api","(\/api\/k\/[0-9a-f]{32})"\)/.exec(await res.text())?.[1];
    expect(api).toBeTruthy();
    expect(jar.session()?.path).toBe(api);
    expect((await jar.fetch(`${OMNI}${api}/channels`, { headers: fromPage })).status).toBe(200);
    expect((await jar.fetch(`${OMNI}/api/channels`, { headers: fromPage })).status).toBe(401);

    const captured = await visitSibling(jar);
    expect(captured.join('\n')).not.toContain(sessionCookieName());
    expect(captured.join('\n')).not.toContain(api!.slice('/api/k/'.length));
    for (const cookie of captured) expect((await replay(cookie)).status).toBe(401);
  });

  it('sends a document load on the keyed path to a signed address for that one URL, which shows no key', async () => {
    const { jar, api } = await pairedBrowser();
    const frame = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
    const res = await jar.fetch(`${OMNI}${api}/channels?x=1`, { headers: frame });
    expect(res.status).toBe(303);
    const to = res.headers.get('location')!;
    expect(to).toMatch(/^\/api\/channels\?x=1&omni_doc=/);
    expect(to).not.toContain(api.slice('/api/k/'.length));

    // The signed address needs no cookie, and opens nothing but itself.
    expect((await fetch(`${OMNI}${to}`, { headers: frame })).status).toBe(200);
    expect((await fetch(`${OMNI}${to.replace('/api/channels', '/api/threads')}`, { headers: frame })).status).toBe(401);
    expect((await fetch(`${OMNI}${to.replace('x=1', 'x=2')}`, { headers: frame })).status).toBe(401);

    // Never one for /api/auth, which names the session's path.
    const authLoad = await jar.fetch(`${OMNI}${api}/auth`, { headers: frame });
    expect(authLoad.status).toBe(303);
    expect((await fetch(`${OMNI}${authLoad.headers.get('location')}`, { headers: frame })).status).toBe(401);
  });

  // A thread's own token (thread-tokens.ts, #832) is a bearer for loopback calls. It never stands in for a browser: it
  // gets no session cookie, no keyed path and no signed document address, and put in a cookie it counts for nothing.
  it("gives a thread's token no cookie, no keyed path and no signed address, and refuses it as a cookie", async () => {
    const { mintThreadToken } = await import('../thread-tokens.ts');
    h.db.db.prepare('INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'cookie-path-thread', 'scratch', 'Thread', 'done', 'cookie-path-thread', h.tmp, 'manual',
    );
    const { token } = mintThreadToken('cookie-path-thread');
    const bearer = { authorization: `Bearer ${token}` };

    const check = await fetch(`${OMNI}/api/auth`, { headers: bearer });
    expect(check.status).toBe(200);
    expect(((await check.json()) as { api: string }).api).toBe('/api');
    expect(check.headers.getSetCookie()).toEqual([]);
    const pair = await fetch(`${OMNI}/api/auth/pair`, { method: 'POST', headers: bearer });
    expect(pair.status).toBe(403);
    expect(pair.headers.getSetCookie()).toEqual([]);

    // A document load with it on a keyed path is not sent to a signed address: that is only for a browser's session.
    const { api } = await pairedBrowser();
    const load = await fetch(`${OMNI}${api}/channels`, { redirect: 'manual', headers: { ...bearer, 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' } });
    expect(load.status).not.toBe(303);
    expect(load.headers.get('location')).toBeNull();

    for (const path of ['/api/channels', `${api}/channels`]) {
      expect((await replay(`${sessionCookieName()}=${token}`, path)).status).toBe(401);
    }
  });

  it('keeps a Secure cookie on /api behind HTTPS, where plain-HTTP services never get it', async () => {
    const jar = new Jar();
    const res = await jar.fetch(`${OMNI}/api/auth/pair`, { method: 'POST', headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}`, 'x-forwarded-proto': 'https' } });
    expect(((await res.json()) as { api: string }).api).toBe('/api');
    expect(jar.session()).toMatchObject({ path: '/api', secure: true });
  });
});
