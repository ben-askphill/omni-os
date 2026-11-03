import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_CLIENT_ID, FAKE_PUBLISHABLE_KEY } from './fake-clerk.ts';
import { wireFixture } from './fixture-shape.ts';
import { startRunner } from './runner-boot.ts';
import type { ConnectRelay } from '../connect/service.ts';
import type { EcJwk } from '../connect/jwt.ts';
import { TunnelSupervisor, type TunnelChild } from '../connect/tunnel.ts';

// Omni Connect on the server (apps/server/connect/, docs/adr/0009-omni-connect.md) through the API: turning it on
// against a fake relay, the relay's signed mint and health requests, a browser redeeming its code with a proof of its
// key, and the guard taking the Connect hostname. The browser's and relay's signatures are made with WebCrypto here,
// as apps/relay and the Web UI make them, so the two implementations are checked against each other.

const HOSTNAME = 'bens-mac-a1b2c3.omni-os.app';
const USER = 'user_ben';
const RELAY_TOKEN = `omni_r_${Buffer.from(USER).toString('base64url')}.${'ab'.repeat(32)}`;

let app: Awaited<typeof import('../app.ts')>['app'];
let service: typeof import('../connect/service.ts');
let jwt: typeof import('../connect/jwt.ts');
let auth: typeof import('../google-auth.ts');
let secrets: typeof import('../secrets.ts');
let db: typeof import('../db.ts');

/** The relay's key, as the fake relay hands it out. */
let relayKey: { privateJwk: JsonWebKey; publicJwk: EcJwk };
const relayCalls: { op: string; body?: unknown }[] = [];
let registered: { publicKey: EcJwk; port: number } | null = null;

const fakeRelay: ConnectRelay = {
  info: async () => ({ connect: true }),
  register: async (_url, token, body) => {
    expect(token).toBe(RELAY_TOKEN);
    relayCalls.push({ op: 'register', body });
    registered = body;
    return { hostname: HOSTNAME, connectorToken: 'connector-token', relayKey: relayKey.publicJwk };
  },
  remove: async (_url, _token, machineId) => void relayCalls.push({ op: 'remove', body: machineId }),
  machines: async () => [
    { id: 'mac-a', name: "Ben's Mac", hostname: HOSTNAME, online: true },
    { id: 'mac-b', name: 'Studio', hostname: 'studio-ffffff.omni-os.app', online: false, problem: 'The tunnel has no connector running' },
  ],
};

beforeAll(async () => {
  await startRunner({ OMNI_CLERK_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY, OMNI_CLERK_CLIENT_ID: FAKE_CLIENT_ID, OMNI_CLOUDFLARED: '/nonexistent/cloudflared', OMNI_SECRET_STORE: 'file' });
  ({ app } = await import('../app.ts'));
  service = await import('../connect/service.ts');
  jwt = await import('../connect/jwt.ts');
  auth = await import('../google-auth.ts');
  secrets = await import('../secrets.ts');
  db = await import('../db.ts');
  db.outbox.arm('mac-a');
  service.useConnectRelay(fakeRelay);
  relayKey = jwt.newKeyPair() as typeof relayKey;
});

beforeEach(async () => {
  service.resetConnect();
  relayCalls.length = 0;
  db.kv.set('sync.connect.enabled', false);
  auth.unlinkOwner();
  await secrets.setSecret('global', 'OMNI_RELAY_URL', 'https://relay.example.com');
  await secrets.setSecret('global', 'OMNI_RELAY_TOKEN', RELAY_TOKEN);
});

const req = (method: string, path: string, opts: { body?: unknown; host?: string; headers?: Record<string, string> } = {}) =>
  app.request(`http://${opts.host ?? '127.0.0.1:4747'}/api${path}`, {
    method,
    headers: { host: opts.host ?? '127.0.0.1:4747', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

/** What reaches the server through cloudflared: the public Host, and Cloudflare's headers. */
const tunneled = (headers: Record<string, string> = {}) => ({ host: HOSTNAME, headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-proto': 'https', authorization: '', ...headers } });

const enable = async () => {
  const res = await req('POST', '/connect/enable');
  expect(res.status).toBe(200);
  return (await res.json()) as { enabled: boolean; hostname: string; url: string; connectPage: string; tunnel: { state: string } };
};

const relayRequest = (typ: string, claims: Record<string, unknown> = {}) => {
  const iat = Math.floor(Date.now() / 1000);
  return jwt.sign(relayKey.privateJwk, typ, { iss: 'omni-relay', aud: 'mac-a', sub: USER, nonce: 'n-1', jti: crypto.randomUUID(), iat, exp: iat + 60, ...claims });
};

// ---------- the browser, in WebCrypto as the Web UI does it ----------

const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');

async function browserKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as EcJwk;
  const jwk = { kty: 'EC' as const, crv: 'P-256' as const, x: pub.x, y: pub.y };
  const jkt = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))));
  const proof = async (htu: string, claims: Record<string, unknown> = {}) => {
    const input = `${b64(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'dpop+jwt', jwk })))}.${b64(Buffer.from(JSON.stringify({ htm: 'POST', htu, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(), ...claims })))}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input));
    return `${input}.${b64(sig)}`;
  };
  return { jkt, proof };
}

const REDEEM = `https://${HOSTNAME}/api/connect/redeem`;

async function mintFor(jkt: string) {
  const res = await req('POST', '/connect/mint', { body: { request: relayRequest(jwt.MINT_REQUEST, { jkt }) }, ...tunneled() });
  expect(res.status).toBe(200);
  const { response } = (await res.json()) as { response: string };
  const claims = jwt.verify(response, registered!.publicKey, jwt.MINT_RESPONSE);
  expect(claims).toMatchObject({ iss: 'mac-a', aud: 'omni-relay', nonce: 'n-1', jkt });
  return claims!.code as string;
}

describe('turning Omni Connect on and off', () => {
  it('registers with the relay, makes the relay user the owner, and keeps the hostname', async () => {
    const s = await enable();
    expect(s).toMatchObject({ enabled: true, hostname: HOSTNAME, url: `https://${HOSTNAME}`, connectPage: 'https://relay.example.com/connect' });
    expect(s.tunnel.state).toBe('missing');
    expect(registered).toMatchObject({ port: expect.any(Number), publicKey: { kty: 'EC', crv: 'P-256' } });
    expect(registered!.publicKey).not.toHaveProperty('d');
    expect(auth.owner()?.sub).toBe(USER);
    expect(await secrets.globalSecret('OMNI_CONNECT_TUNNEL_TOKEN')).toBe('connector-token');
  });

  it('refuses when this Omni is linked to another Google account', async () => {
    auth.linkOwner({ issuer: 'https://fake-walrus.clerk.accounts.dev', sub: 'user_other', email: 'other@example.com', name: null });
    const res = await req('POST', '/connect/enable');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/other@example.com/);
  });

  it('refuses before sync sign-in', async () => {
    await secrets.deleteSecret('global', 'OMNI_RELAY_TOKEN');
    const res = await req('POST', '/connect/enable');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Sign in to sync/);
  });

  it('turning off asks the relay to delete the tunnel, and the hostname stops working', async () => {
    await enable();
    expect((await req('GET', '/connect/machines', tunneled({ authorization: '' }))).status).toBe(401);
    const res = await req('POST', '/connect/disable');
    expect(await res.json()).toMatchObject({ enabled: false, hostname: null });
    expect(relayCalls.at(-1)).toEqual({ op: 'remove', body: 'mac-a' });
    expect((await req('GET', '/auth/methods', tunneled())).status).toBe(403);
  });

  it('lists the machines, marking this one', async () => {
    await enable();
    const { machines } = (await (await req('GET', '/connect/machines')).json()) as { machines: { id: string; current: boolean; url: string; online: boolean }[] };
    expect(machines).toEqual([
      expect.objectContaining({ id: 'mac-a', current: true, online: true, url: `https://${HOSTNAME}` }),
      expect.objectContaining({ id: 'mac-b', current: false, online: false }),
    ]);
  });

  it('sends the status and machines shapes of their wire fixtures', async () => {
    // Recorded with Connect on.
    await enable();
    wireFixture('connect-status.json', await (await req('GET', '/connect')).json());
    wireFixture('connect-machines.json', await (await req('GET', '/connect/machines')).json());
  });

  it('signing out of sync stops Connect here too', async () => {
    await enable();
    await service.forgetConnect();
    expect(await (await req('GET', '/connect')).json()).toMatchObject({ enabled: false, hostname: null, tunnel: { state: 'off' } });
    expect(await secrets.globalSecret('OMNI_CONNECT_TUNNEL_TOKEN')).toBeNull();
    expect((await req('GET', '/auth/methods', tunneled())).status).toBe(403);
  });

  it('keeps the Connect credentials out of every thread', () => {
    expect(secrets.secretReachesThread('global', 'OMNI_CONNECT_KEY')).toBe(false);
    expect(secrets.secretReachesThread('global', 'OMNI_CONNECT_TUNNEL_TOKEN')).toBe(false);
  });
});

describe('the guard on the Connect hostname', () => {
  it('lets the hostname in with no Tailscale login, and still asks for the token or a session', async () => {
    await enable();
    expect((await req('GET', '/auth', tunneled())).status).toBe(401);
    const methods = (await (await req('GET', '/auth/methods', tunneled())).json()) as { connect: unknown };
    expect(methods.connect).toEqual({ relay: 'https://relay.example.com', machine: 'mac-a', hostname: HOSTNAME });
  });

  it('keeps the Tailscale login check for a tailnet peer that names the Connect hostname', async () => {
    await enable();
    process.env.OMNI_TAILSCALE_LOGIN = 'ben@example.com';
    try {
      const token = (await import('../api-token.ts')).apiToken();
      const bearer = { authorization: `Bearer ${token}` };
      // Through Cloudflare: the client's public address last. No login to check.
      expect((await req('GET', '/auth', tunneled({ ...bearer, 'x-forwarded-for': '203.0.113.9' }))).status).toBe(200);
      // Through tailscale serve with a forged Host: the peer's tailnet address, or its login header.
      expect((await req('GET', '/auth', { host: HOSTNAME, headers: { ...bearer, 'x-forwarded-for': '100.101.102.103' } })).status).toBe(403);
      expect((await req('GET', '/auth', { host: HOSTNAME, headers: { ...bearer, 'tailscale-user-login': 'mallory@example.com' } })).status).toBe(403);
    } finally {
      delete process.env.OMNI_TAILSCALE_LOGIN;
    }
  });

  it('names Connect on the pairing screen only on the Connect hostname', async () => {
    await enable();
    const local = (await (await req('GET', '/auth/methods')).json()) as { connect: unknown };
    expect(local.connect).toBeNull();
  });
});

describe('mint, health and redeem', () => {
  beforeEach(enable);

  it('a browser redeems its code with a proof of its key and gets a session that works', async () => {
    const browser = await browserKey();
    const code = await mintFor(browser.jkt);
    const res = await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: await browser.proof(REDEEM) }) });
    expect(res.status).toBe(200);
    const cookie = /omni_session_\d+=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(res.headers.get('set-cookie')).toMatch(/Secure/);
    const again = await req('GET', '/auth', tunneled({ cookie: `${cookie![0]}` }));
    expect(again.status).toBe(200);
    expect(auth.listSessions()[0].name).toMatch(/via Omni Connect/);
  });

  it('a code is single use', async () => {
    const browser = await browserKey();
    const code = await mintFor(browser.jkt);
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: await browser.proof(REDEEM) }) })).status).toBe(200);
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: await browser.proof(REDEEM) }) })).status).toBe(401);
  });

  it('another key cannot redeem the code, and trying does not spend it', async () => {
    const browser = await browserKey();
    const thief = await browserKey();
    const code = await mintFor(browser.jkt);
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: await thief.proof(REDEEM) }) })).status).toBe(401);
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled() })).status).toBe(401);
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: await browser.proof('https://evil.example/api/connect/redeem') }) })).status).toBe(401);
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: await browser.proof(REDEEM) }) })).status).toBe(200);
  });

  it('a stale proof is refused', async () => {
    const browser = await browserKey();
    const code = await mintFor(browser.jkt);
    const stale = await browser.proof(REDEEM, { iat: Math.floor(Date.now() / 1000) - 600 });
    expect((await req('POST', '/connect/redeem', { body: { code }, ...tunneled({ dpop: stale }) })).status).toBe(401);
  });

  it('refuses a request signed by another key, replayed, for another machine, or for another user', async () => {
    const jkt = (await browserKey()).jkt;
    const other = jwt.newKeyPair();
    const iat = Math.floor(Date.now() / 1000);
    const forged = jwt.sign(other.privateJwk, jwt.MINT_REQUEST, { iss: 'omni-relay', aud: 'mac-a', sub: USER, nonce: 'n', jti: 'j-forged', iat, exp: iat + 60, jkt });
    expect((await req('POST', '/connect/mint', { body: { request: forged }, ...tunneled() })).status).toBe(401);

    const once = relayRequest(jwt.MINT_REQUEST, { jkt });
    expect((await req('POST', '/connect/mint', { body: { request: once }, ...tunneled() })).status).toBe(200);
    expect((await req('POST', '/connect/mint', { body: { request: once }, ...tunneled() })).status).toBe(401);

    expect((await req('POST', '/connect/mint', { body: { request: relayRequest(jwt.MINT_REQUEST, { jkt, aud: 'mac-b' }) }, ...tunneled() })).status).toBe(401);
    expect((await req('POST', '/connect/mint', { body: { request: relayRequest(jwt.MINT_REQUEST, { jkt, sub: 'user_other' }) }, ...tunneled() })).status).toBe(403);
    expect((await req('POST', '/connect/mint', { body: { request: relayRequest(jwt.MINT_REQUEST, { jkt, exp: iat + 3600 }) }, ...tunneled() })).status).toBe(401);
    expect((await req('POST', '/connect/mint', { body: { request: relayRequest(jwt.HEALTH_REQUEST, { jkt }) }, ...tunneled() })).status).toBe(401);
  });

  it('answers a health request signed for the relay', async () => {
    const res = await req('POST', '/connect/health', { body: { request: relayRequest(jwt.HEALTH_REQUEST) }, ...tunneled() });
    const { response } = (await res.json()) as { response: string };
    expect(jwt.verify(response, registered!.publicKey, jwt.HEALTH_RESPONSE)).toMatchObject({ iss: 'mac-a', aud: 'omni-relay', nonce: 'n-1' });
  });

  it('verifies a request signed with WebCrypto, as the relay signs it', async () => {
    const key = await crypto.subtle.importKey('jwk', relayKey.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const iat = Math.floor(Date.now() / 1000);
    const input = `${b64(Buffer.from(JSON.stringify({ alg: 'ES256', typ: jwt.HEALTH_REQUEST })))}.${b64(Buffer.from(JSON.stringify({ iss: 'omni-relay', aud: 'mac-a', sub: USER, nonce: 'w', jti: 'webcrypto', iat, exp: iat + 60 })))}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
    expect((await req('POST', '/connect/health', { body: { request: `${input}.${b64(sig)}` }, ...tunneled() })).status).toBe(200);
  });
});

describe('TunnelSupervisor', () => {
  function fakeSpawn() {
    const children: { lines: ((l: string) => void)[]; exit: ((c: number | null) => void)[]; killed: boolean; token: string }[] = [];
    const spawn = (_bin: string, token: string): TunnelChild => {
      const c = { lines: [] as ((l: string) => void)[], exit: [] as ((c: number | null) => void)[], killed: false, token };
      children.push(c);
      return { onLine: (fn) => void c.lines.push(fn), onExit: (fn) => void c.exit.push(fn), kill: () => void (c.killed = true) };
    };
    return { children, spawn };
  }

  it('is connected once cloudflared registers a connection, and stops the child on stop', () => {
    const { children, spawn } = fakeSpawn();
    const t = new TunnelSupervisor(async () => null, () => '/bin/cloudflared', spawn, Date.now, () => setTimeout(() => {}, 0));
    t.start('tok');
    expect(t.current.state).toBe('starting');
    children[0].lines.forEach((fn) => fn('2026-11-01T12:00:00Z INF Registered tunnel connection connIndex=0'));
    expect(t.current).toMatchObject({ state: 'connected', cloudflared: '/bin/cloudflared' });
    t.stop();
    expect(children[0].killed).toBe(true);
    expect(t.current.state).toBe('off');
  });

  it('restarts with backoff, and asks for a fresh tunnel after five exits', async () => {
    const { children, spawn } = fakeSpawn();
    const waits: number[] = [];
    let recovered = 0;
    const t = new TunnelSupervisor(
      async () => (recovered++, 'fresh'),
      () => '/bin/cloudflared',
      spawn,
      Date.now,
      (fn, ms) => {
        waits.push(ms);
        queueMicrotask(fn);
        return setTimeout(() => {}, 0);
      },
    );
    t.start('tok');
    for (let i = 0; i < 5; i++) {
      children.at(-1)!.exit.forEach((fn) => fn(1));
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(waits.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(recovered).toBe(1);
    expect(children.at(-1)!.token).toBe('fresh');
    t.stop();
  });

  it('says cloudflared is missing', () => {
    const t = new TunnelSupervisor(async () => null, () => null, () => {
      throw new Error('not called');
    }, Date.now, () => setTimeout(() => {}, 0));
    t.start('tok');
    expect(t.current).toMatchObject({ state: 'missing', error: expect.stringMatching(/brew install cloudflared/) });
    t.stop();
  });
});
