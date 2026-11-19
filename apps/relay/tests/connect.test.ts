import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CLIENT_PREFIX, newToken, RelayError, sha256, tokenUser } from '../src/auth.ts';
import { CloudflareApi, hostnameFor } from '../src/cloudflare.ts';
import { ConnectStore, type Caller } from '../src/connect.ts';
import { HEALTH_REQUEST, HEALTH_RESPONSE, MINT_REQUEST, MINT_RESPONSE, newKeyPair, REGISTER_PROOF, RELAY_ISSUER, sign, thumbprint, verify, type EcJwk } from '../src/jwt.ts';
import { SigninStore } from '../src/signin.ts';
import type { Sql } from '../src/store.ts';

function sqlOn(db: DatabaseSync): Sql {
  return {
    exec: (q, ...b) => {
      const rows = (/^(SELECT|PRAGMA)/.test(q.trim().toUpperCase()) ? db.prepare(q).all(...b) : (db.prepare(q).run(...b), [])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
}

/** Cloudflare's API as far as provisioning goes: tunnels, their configs and tokens, and DNS records. One account and zone, shared by every user of a relay. */
function fakeCloudflare() {
  const tunnels = new Map<string, { name: string; deleted: boolean; config?: { ingress: { hostname?: string; service: string }[] } }>();
  const records = new Map<string, { name: string; content: string }>();
  const calls: string[] = [];
  /** `METHOD /path` prefixes that fail once each, with this status (500 when added with add()), as an interrupted request would. */
  const failures = new Map<string, number>();
  const failOnce = { add: (prefix: string, status = 500) => failures.set(prefix, status) };
  /** `METHOD /path` prefixes whose change is made but whose answer is lost, once each. */
  const lostOnce = new Set<string>();
  /** `METHOD /path` prefixes that wait for this promise first. */
  const holds = new Map<string, Promise<void>>();
  let n = 0;
  const ok = (result: unknown) => Response.json({ success: true, result });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const call = `${method} ${url.pathname.replace('/client/v4', '')}`;
    for (const [f, hold] of holds) if (call.startsWith(f)) await hold;
    calls.push(call);
    for (const [f, status] of failures)
      if (call.startsWith(f)) {
        failures.delete(f);
        return Response.json({ success: false, errors: [{ code: 1000, message: 'interrupted' }] }, { status });
      }
    const res = answer(url, method, init);
    for (const f of lostOnce)
      if (call.startsWith(f)) {
        lostOnce.delete(f);
        return Response.json({ success: false, errors: [{ code: 1000, message: 'lost' }] }, { status: 504 });
      }
    return res;
  }) as typeof fetch;
  const answer = (url: URL, method: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace('/client/v4', '');
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/accounts\/acct\/cfd_tunnel$/))) {
      if (method === 'POST') {
        if ([...tunnels.values()].some((t) => t.name === body.name && !t.deleted)) return Response.json({ success: false, errors: [{ code: 1013, message: 'name taken' }] }, { status: 409 });
        const id = `t${++n}`;
        tunnels.set(id, { name: body.name, deleted: false });
        return ok({ id, name: body.name });
      }
      const name = url.searchParams.get('name');
      return ok([...tunnels].filter(([, t]) => t.name === name && !t.deleted).map(([id, t]) => ({ id, name: t.name })));
    }
    if ((m = path.match(/^\/accounts\/acct\/cfd_tunnel\/([\w-]+)(\/(configurations|token))?$/))) {
      const t = tunnels.get(m[1]);
      if (!t) return Response.json({ success: false, errors: [{ code: 1003, message: 'not found' }] }, { status: 404 });
      if (m[3] === 'configurations' && method === 'PUT') return ok((t.config = body.config));
      if (m[3] === 'configurations') return ok({ tunnel_id: m[1], config: t.config ?? null });
      if (m[3] === 'token') return ok(`token-for-${m[1]}`);
      if (method === 'DELETE') return ok((t.deleted = true));
      return ok({ id: m[1], name: t.name, deleted_at: t.deleted ? '2026-11-01' : null });
    }
    if ((m = path.match(/^\/zones\/zone\/dns_records(\/([\w-]+))?$/))) {
      if (method === 'GET') return ok([...records].filter(([, r]) => r.name === url.searchParams.get('name')).map(([id, r]) => ({ id, ...r })));
      if (method === 'POST') {
        if ([...records.values()].some((r) => r.name === body.name)) return Response.json({ success: false, errors: [{ code: 81053, message: 'record exists' }] }, { status: 400 });
        const id = `r${++n}`;
        records.set(id, { name: body.name, content: body.content });
        return ok({ id });
      }
      if (method === 'PATCH') return ok(Object.assign(records.get(m[2])!, body));
      if (method === 'DELETE') return ok(records.delete(m[2]));
    }
    return Response.json({ success: false, errors: [{ code: 0, message: `no fake for ${method} ${path}` }] }, { status: 400 });
  };
  /** The calls that change something on Cloudflare. */
  const writes = () => calls.filter((c) => !c.startsWith('GET '));
  return { fetchImpl, tunnels, records, calls, failOnce, lostOnce, holds, writes };
}

const cfConfig = { token: 't', accountId: 'acct', zoneId: 'zone', zone: 'omni-os.app' };

/** A machine's relay token as the Durable Object sees it: its id, its hash, and the sync machine it pushes as. */
async function caller(tokenId: string, machine: string | null = null): Promise<Caller> {
  return { tokenId, tokenHash: await sha256(`bearer-${tokenId}`), machine };
}

/** What a machine signs with its enrolled key to register again under a new relay token. */
async function registerProof(privateJwk: JsonWebKey, o: { machineId: string; user: string; tokenId: string; publicKey: EcJwk; iat?: number; exp?: number }) {
  const iat = o.iat ?? Math.floor(Date.now() / 1000);
  return sign(privateJwk, REGISTER_PROOF, {
    iss: o.machineId,
    aud: RELAY_ISSUER,
    sub: o.user,
    tkh: await sha256(`bearer-${o.tokenId}`),
    jkt: await thumbprint(o.publicKey),
    iat,
    exp: o.exp ?? iat + 60,
  });
}

/** A machine behind its tunnel: checks the relay's request with the pinned key and answers signed. */
async function fakeMachine(opts: { relayKey: () => EcJwk; machineId: string; owner: string }) {
  const keys = await newKeyPair();
  const seen = new Set<string>();
  const override: { response?: (claims: Record<string, unknown>) => Promise<string> } = {};
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const kind = url.pathname === '/api/connect/mint' ? 'mint' : 'health';
    const { request } = JSON.parse(String(init!.body));
    const claims = await verify(request, opts.relayKey(), kind === 'mint' ? MINT_REQUEST : HEALTH_REQUEST);
    if (!claims || claims.aud !== opts.machineId || claims.sub !== opts.owner || seen.has(String(claims.jti))) return Response.json({ error: 'refused' }, { status: 403 });
    seen.add(String(claims.jti));
    const now = Math.floor(Date.now() / 1000);
    const answer = { iss: opts.machineId, aud: RELAY_ISSUER, nonce: claims.nonce, exp: now + 60, ...(kind === 'mint' ? { jkt: claims.jkt, code: 'code_abcdefghijklmnopqrstuvwxyz' } : {}) };
    const response = override.response ? await override.response(answer) : await sign(keys.privateJwk, kind === 'mint' ? MINT_RESPONSE : HEALTH_RESPONSE, answer);
    return Response.json({ response });
  }) as typeof fetch;
  return { keys, fetchImpl, override };
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  const cf = fakeCloudflare();
  let relayKey: EcJwk | null = null;
  const machine = await fakeMachine({ relayKey: () => relayKey!, machineId: 'mac-1', owner: 'user_ben' });
  const store = new ConnectStore(sqlOn(db), new CloudflareApi(cfConfig, cf.fetchImpl), 'omni-os.app', 'user_ben', machine.fetchImpl);
  const register = async (port = 4747, name = "Ben's MacBook Pro") => {
    const r = await store.register({ machineId: 'mac-1', name, publicKey: machine.keys.publicJwk, port }, await caller('tok-1', 'mac-1'));
    relayKey = r.relayKey;
    return r;
  };
  return { db, cf, machine, store, register };
}

describe('hostnameFor', () => {
  it('is the name as one DNS label plus 6 hex, under the zone', async () => {
    const h = await hostnameFor('omni-os.app', 'user_ben', 'mac-1', "Ben's MacBook Pro");
    expect(h).toMatch(/^ben-s-macbook-pro-[0-9a-f]{6}\.omni-os\.app$/);
    expect(await hostnameFor('omni-os.app', 'user_ben', 'mac-1', 'Other name')).toMatch(h.slice(-17));
    expect(await hostnameFor('omni-os.app', 'user_ben', 'mac-1', '日本')).toMatch(/^omni-[0-9a-f]{6}\.omni-os\.app$/);
  });
});

describe('ConnectStore.register', () => {
  it('makes a tunnel, its ingress and a proxied CNAME, and answers with the connector token and the relay key', async () => {
    const { cf, register } = await setup();
    const r = await register();
    expect(r.hostname).toMatch(/\.omni-os\.app$/);
    expect(r.connectorToken).toBe('token-for-t1');
    expect(r.relayKey).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(cf.tunnels.get('t1')).toMatchObject({ name: expect.stringMatching(/^omni-[0-9a-f]{12}-mac-1-[0-9a-f]{8}$/), config: { ingress: [{ hostname: r.hostname, service: 'http://127.0.0.1:4747' }, { service: 'http_status:404' }] } });
    expect([...cf.records.values()]).toEqual([{ name: r.hostname, content: 't1.cfargotunnel.com' }]);
  });

  it('registering again keeps the hostname and tunnel, and moves the ingress to the new port', async () => {
    const { cf, register } = await setup();
    const first = await register(4747);
    const again = await register(4800, 'Renamed');
    expect(again.hostname).toBe(first.hostname);
    expect(cf.tunnels.size).toBe(1);
    expect(cf.records.size).toBe(1);
    expect((cf.tunnels.get('t1')!.config as { ingress: { service: string }[] }).ingress[0].service).toBe('http://127.0.0.1:4800');
  });

  it('makes a new tunnel when the recorded one was deleted, and points the DNS record at it', async () => {
    const { cf, register } = await setup();
    const first = await register();
    cf.tunnels.get('t1')!.deleted = true;
    const again = await register();
    expect(again.connectorToken).not.toBe(first.connectorToken);
    expect([...cf.records.values()][0].content).toMatch(/^t\d+\.cfargotunnel\.com$/);
    expect([...cf.records.values()][0].content).not.toBe('t1.cfargotunnel.com');
  });

  it('keeps the recorded tunnel when Cloudflare fails to answer for it, and replaces it only once Cloudflare says it is gone', async () => {
    const { cf, register } = await setup();
    await register();
    cf.failOnce.add('GET /accounts/acct/cfd_tunnel/t1', 500);
    await expect(register()).rejects.toMatchObject({ code: 'cloudflare' });
    expect(cf.tunnels.size).toBe(1);
    expect((await register()).connectorToken).toBe('token-for-t1');
    cf.failOnce.add('GET /accounts/acct/cfd_tunnel/t1', 404);
    expect((await register()).connectorToken).not.toBe('token-for-t1');
    expect(cf.tunnels.size).toBe(2);
  });

  it('refuses a private key, a bad id or port', async () => {
    const { store, machine } = await setup();
    const t = await caller('t');
    await expect(store.register({ machineId: 'mac-1', publicKey: { ...machine.keys.publicJwk, d: 'x' }, port: 4747 }, t)).rejects.toThrow(/publicKey/);
    await expect(store.register({ machineId: '../x', publicKey: machine.keys.publicJwk, port: 4747 }, t)).rejects.toThrow(/machineId/);
    await expect(store.register({ machineId: 'm', publicKey: machine.keys.publicJwk, port: 0 }, t)).rejects.toThrow(/port/);
  });

  it('answers connect_not_configured without Cloudflare secrets', async () => {
    const store = new ConnectStore(sqlOn(new DatabaseSync(':memory:')), null, null, 'user_ben');
    await expect(store.register({}, await caller('t'))).rejects.toMatchObject({ status: 503, code: 'connect_not_configured' });
  });
});

describe('ConnectStore.register: who may register a machine id', () => {
  const row = (db: DatabaseSync, id: string) => db.prepare('SELECT public_key, token_id FROM connect_machines WHERE id = ?').get(id) as { public_key: string; token_id: string } | undefined;

  it("refuses another machine's token for a registered id, before any Cloudflare call, and keeps the registration", async () => {
    const { db, cf, store, register } = await setup();
    await register();
    const before = row(db, 'mac-1');
    const sibling = await newKeyPair();
    const callsBefore = cf.calls.length;
    await expect(store.register({ machineId: 'mac-1', name: 'Sibling', publicKey: sibling.publicJwk, port: 4747 }, await caller('tok-2', null))).rejects.toMatchObject({
      status: 403,
      code: 'not_this_machine',
    });
    expect(cf.calls.length).toBe(callsBefore);
    expect(row(db, 'mac-1')).toEqual(before);
  });

  it("refuses a proof signed by another key, for another token, or expired, even from the machine's own id", async () => {
    const { db, cf, store, register, machine } = await setup();
    await register();
    const before = row(db, 'mac-1');
    const sibling = await newKeyPair();
    const body = (proof: string) => ({ machineId: 'mac-1', name: 'Sibling', publicKey: sibling.publicJwk, port: 4747, proof });
    const base = { machineId: 'mac-1', user: 'user_ben', tokenId: 'tok-2', publicKey: sibling.publicJwk };
    const callsBefore = cf.calls.length;
    const tries = [
      await registerProof(sibling.privateJwk, base),
      await registerProof(machine.keys.privateJwk, { ...base, tokenId: 'tok-other' }),
      await registerProof(machine.keys.privateJwk, { ...base, user: 'user_eve' }),
      await registerProof(machine.keys.privateJwk, { ...base, machineId: 'mac-2' }),
      await registerProof(machine.keys.privateJwk, { ...base, publicKey: machine.keys.publicJwk }),
      await registerProof(machine.keys.privateJwk, { ...base, iat: Math.floor(Date.now() / 1000) - 600, exp: Math.floor(Date.now() / 1000) - 540 }),
    ];
    for (const proof of tries) await expect(store.register(body(proof), await caller('tok-2'))).rejects.toMatchObject({ status: 403, code: 'not_this_machine' });
    expect(cf.calls.length).toBe(callsBefore);
    expect(row(db, 'mac-1')).toEqual(before);
  });

  it('lets the machine itself register again under a new relay token by signing with the key it enrolled', async () => {
    const { db, cf, store, register, machine } = await setup();
    const first = await register();
    const proof = await registerProof(machine.keys.privateJwk, { machineId: 'mac-1', user: 'user_ben', tokenId: 'tok-2', publicKey: machine.keys.publicJwk });
    const again = await store.register({ machineId: 'mac-1', name: "Ben's MacBook Pro", publicKey: machine.keys.publicJwk, port: 4747, proof }, await caller('tok-2', 'mac-1'));
    expect(again.hostname).toBe(first.hostname);
    expect(again.connectorToken).toBe(first.connectorToken);
    expect(cf.tunnels.size).toBe(1);
    expect(row(db, 'mac-1')!.token_id).toBe('tok-2');
    // The new token owns it now: signing the old one out leaves it, the new one can turn it off.
    await store.removeForToken('tok-1');
    expect(store.list()).toHaveLength(1);
    await store.remove('mac-1', 'tok-2');
    expect(store.list()).toEqual([]);
  });

  it('refuses a token that pushes as another machine, even for an id no one has registered', async () => {
    const { cf, store } = await setup();
    const m = await newKeyPair();
    await expect(store.register({ machineId: 'mac-2', name: 'Studio', publicKey: m.publicJwk, port: 4747 }, await caller('tok-1', 'mac-1'))).rejects.toMatchObject({
      status: 403,
      code: 'not_this_machine',
    });
    expect(cf.calls).toEqual([]);
    expect(store.list()).toEqual([]);
  });

  it('claims a new id once: of two first registrations at the same time, one gets the tunnel and the other is refused', async () => {
    const { cf, store } = await setup();
    const a = await newKeyPair();
    const b = await newKeyPair();
    const results = await Promise.allSettled([
      store.register({ machineId: 'mac-9', name: 'A', publicKey: a.publicJwk, port: 4747 }, await caller('tok-a')),
      store.register({ machineId: 'mac-9', name: 'B', publicKey: b.publicJwk, port: 4747 }, await caller('tok-b')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 403, code: 'not_this_machine' });
    expect(cf.tunnels.size).toBe(1);
    expect(store.list()).toMatchObject([{ id: 'mac-9', name: 'A' }]);
  });

  it("refuses an id whose hostname is another machine's, before any Cloudflare call, and leaves the id free", async () => {
    const { db, cf, store, register } = await setup();
    await register();
    // Another row that already holds the hostname mac-2 would get, as a ground id and name would.
    const taken = await hostnameFor('omni-os.app', 'user_ben', 'mac-2', 'Studio');
    db.prepare(`UPDATE connect_machines SET hostname = ? WHERE id = 'mac-1'`).run(taken);
    const callsBefore = cf.calls.length;
    const m = await newKeyPair();
    await expect(store.register({ machineId: 'mac-2', name: 'Studio', publicKey: m.publicJwk, port: 4747 }, await caller('tok-2'))).rejects.toMatchObject({
      status: 409,
      code: 'hostname_taken',
    });
    expect(cf.calls.length).toBe(callsBefore);
    expect(store.list().map((x) => x.id)).toEqual(['mac-1']);
  });

  it('finishes an interrupted first registration with the tunnel it made, and lists the machine only once it is up', async () => {
    const { cf, store, register } = await setup();
    cf.failOnce.add('PUT /accounts/acct/cfd_tunnel/t1/configurations');
    await expect(register()).rejects.toMatchObject({ code: 'cloudflare' });
    expect(cf.tunnels.size).toBe(1);
    expect(store.list()).toEqual([]);
    await expect(store.open('mac-1', 'A'.repeat(43))).rejects.toMatchObject({ status: 404 });
    const r = await register();
    expect(cf.tunnels.size).toBe(1);
    expect(r.connectorToken).toBe('token-for-t1');
    expect(store.list()).toMatchObject([{ id: 'mac-1' }]);
  });
});

describe('ConnectStore.register: users sharing one Cloudflare account', () => {
  async function twoUsers() {
    const cf = fakeCloudflare();
    const api = new CloudflareApi(cfConfig, cf.fetchImpl);
    const ben = new ConnectStore(sqlOn(new DatabaseSync(':memory:')), api, 'omni-os.app', 'user_ben');
    const eve = new ConnectStore(sqlOn(new DatabaseSync(':memory:')), api, 'omni-os.app', 'user_eve');
    const benKey = await newKeyPair();
    const eveKey = await newKeyPair();
    const benR = await ben.register({ machineId: 'mac-1', name: "Ben's Mac", publicKey: benKey.publicJwk, port: 4747 }, await caller('tok-ben', 'mac-1'));
    return { cf, ben, eve, benR, eveKey };
  }

  it("never selects another user's tunnel for a matching machine id", async () => {
    const { cf, eve, benR, eveKey } = await twoUsers();
    const benTunnel = [...cf.tunnels.entries()][0];
    const benConfig = JSON.stringify(benTunnel[1].config);
    const eveR = await eve.register({ machineId: 'mac-1', name: "Eve's Mac", publicKey: eveKey.publicJwk, port: 4800 }, await caller('tok-eve', 'mac-1'));
    expect(eveR.connectorToken).not.toBe(benR.connectorToken);
    expect(cf.tunnels.size).toBe(2);
    expect(JSON.stringify(cf.tunnels.get(benTunnel[0])!.config)).toBe(benConfig);
    const names = [...cf.tunnels.values()].map((t) => t.name);
    expect(names[0]).not.toBe(names[1]);
  });

  it("refuses a hostname whose DNS record another user's machine holds, without changing anything on Cloudflare", async () => {
    const { cf, eve, benR, eveKey } = await twoUsers();
    // Eve's id and name land on Ben's hostname (ground offline in practice; set up directly here).
    const eveHost = await hostnameFor('omni-os.app', 'user_eve', 'mac-7', 'x');
    const benRecord = [...cf.records.entries()].find(([, r]) => r.name === benR.hostname)!;
    const benContent = benRecord[1].content;
    cf.records.set('r-collide', { name: eveHost, content: benContent });
    const writesBefore = cf.writes().length;
    await expect(eve.register({ machineId: 'mac-7', name: 'x', publicKey: eveKey.publicJwk, port: 4747 }, await caller('tok-eve', 'mac-7'))).rejects.toMatchObject({
      status: 409,
      code: 'hostname_taken',
    });
    expect(cf.writes().length).toBe(writesBefore);
    expect(cf.records.get('r-collide')!.content).toBe(benContent);
    expect(eve.list()).toEqual([]);
  });
});

describe('ConnectStore: registrations made before tunnel names carried the user', () => {
  /** The table and a machine as the earlier relay left them: a tunnel named omni-<id>, its id and DNS record kept. */
  async function legacy(opts: { tunnelName?: string; ingressHost?: string } = {}) {
    const db = new DatabaseSync(':memory:');
    const cf = fakeCloudflare();
    const key = await newKeyPair();
    const hostname = await hostnameFor('omni-os.app', 'user_ben', 'mac-1', "Ben's Mac");
    db.exec(`CREATE TABLE connect_machines (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, hostname TEXT NOT NULL UNIQUE, port INTEGER NOT NULL,
      tunnel_id TEXT, dns_record_id TEXT, token_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    cf.tunnels.set('t-old', { name: opts.tunnelName ?? 'omni-mac-1', deleted: false, config: { ingress: [{ hostname: opts.ingressHost ?? hostname, service: 'http://127.0.0.1:4747' }, { service: 'http_status:404' }] } });
    cf.records.set('r-old', { name: hostname, content: 't-old.cfargotunnel.com' });
    db.prepare(`INSERT INTO connect_machines VALUES ('mac-1', ?, ?, ?, 4747, 't-old', 'r-old', 'tok-1', '2026-11-01', '2026-11-01')`).run("Ben's Mac", JSON.stringify(key.publicJwk), hostname);
    const store = new ConnectStore(sqlOn(db), new CloudflareApi(cfConfig, cf.fetchImpl), 'omni-os.app', 'user_ben');
    const register = async () => store.register({ machineId: 'mac-1', name: "Ben's Mac", publicKey: key.publicJwk, port: 4747 }, await caller('tok-1', 'mac-1'));
    return { db, cf, store, register, hostname };
  }

  it('keeps working: adopts its recorded tunnel once, records it, and does not check it again', async () => {
    const { cf, store, register, hostname } = await legacy();
    expect(store.list()).toMatchObject([{ id: 'mac-1', hostname }]);
    const r = await register();
    expect(r).toMatchObject({ hostname, connectorToken: 'token-for-t-old' });
    expect(cf.tunnels.size).toBe(1);
    expect(cf.calls.filter((c) => c === 'GET /accounts/acct/cfd_tunnel/t-old/configurations')).toHaveLength(1);
    await register();
    expect(cf.calls.filter((c) => c === 'GET /accounts/acct/cfd_tunnel/t-old/configurations')).toHaveLength(1);
    expect(cf.calls.some((c) => c.startsWith('GET /accounts/acct/cfd_tunnel?'))).toBe(false);
  });

  it("does not adopt a recorded tunnel whose ingress serves another hostname: it makes its own and leaves that one alone", async () => {
    const { cf, register, hostname } = await legacy({ ingressHost: 'someone-else-abcdef.omni-os.app' });
    const r = await register();
    expect(r.connectorToken).not.toBe('token-for-t-old');
    expect(cf.tunnels.get('t-old')!.config!.ingress[0].hostname).toBe('someone-else-abcdef.omni-os.app');
    expect(cf.tunnels.get('t-old')!.deleted).toBe(false);
    expect(cf.records.get('r-old')).toMatchObject({ name: hostname, content: `${r.connectorToken.replace('token-for-', '')}.cfargotunnel.com` });
  });

  it("turning Connect off deletes the row's DNS record but not a recorded tunnel that fails the check", async () => {
    const { cf, store } = await legacy({ ingressHost: 'someone-else-abcdef.omni-os.app' });
    await store.remove('mac-1', 'tok-1');
    expect(cf.records.has('r-old')).toBe(false);
    expect(cf.tunnels.get('t-old')!.deleted).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('turning Connect off deletes a recorded tunnel that passes the check', async () => {
    const { cf, store } = await legacy();
    await store.remove('mac-1', 'tok-1');
    expect(cf.tunnels.get('t-old')!.deleted).toBe(true);
  });

  it('does not adopt a recorded tunnel with a name the relay never gave it', async () => {
    const { cf, register } = await legacy({ tunnelName: 'omni-mac-2' });
    const r = await register();
    expect(r.connectorToken).not.toBe('token-for-t-old');
    expect(cf.tunnels.get('t-old')!.config!.ingress[0].service).toBe('http://127.0.0.1:4747');
  });
});

describe('ConnectStore.open', () => {
  const jkt = 'A'.repeat(43);

  it('gets a code the machine minted for this key and sends the browser to the machine', async () => {
    const { store, register } = await setup();
    const { hostname } = await register();
    const r = await store.open('mac-1', jkt);
    expect(r.url).toBe(`https://${hostname}/#/connect?code=code_abcdefghijklmnopqrstuvwxyz`);
  });

  it('refuses an answer signed by another key: a different process behind the hostname', async () => {
    const { store, register, machine } = await setup();
    await register();
    const impostor = await newKeyPair();
    machine.override.response = (claims) => sign(impostor.privateJwk, MINT_RESPONSE, claims);
    await expect(store.open('mac-1', jkt)).rejects.toMatchObject({ code: 'machine_untrusted' });
  });

  it('refuses an answer for another nonce or key, as a replay would be', async () => {
    const { store, register, machine } = await setup();
    await register();
    machine.override.response = (claims) => sign(machine.keys.privateJwk, MINT_RESPONSE, { ...claims, nonce: 'old' });
    await expect(store.open('mac-1', jkt)).rejects.toMatchObject({ code: 'machine_untrusted' });
    machine.override.response = (claims) => sign(machine.keys.privateJwk, MINT_RESPONSE, { ...claims, jkt: 'B'.repeat(43) });
    await expect(store.open('mac-1', jkt)).rejects.toMatchObject({ code: 'machine_untrusted' });
  });

  it('says a machine that does not answer is offline, and lists it that way', async () => {
    const { db, cf } = await setup();
    const down = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const store = new ConnectStore(sqlOn(db), new CloudflareApi(cfConfig, cf.fetchImpl), 'omni-os.app', 'user_ben', down);
    const m = await newKeyPair();
    await store.register({ machineId: 'mac-2', name: 'Studio', publicKey: m.publicJwk, port: 4747 }, await caller('tok'));
    await expect(store.open('mac-2', jkt)).rejects.toMatchObject({ code: 'machine_offline' });
    expect(await store.listWithStatus()).toMatchObject([{ id: 'mac-2', online: false, problem: null }]);
  });

  it('lists an answering machine as online', async () => {
    const { store, register } = await setup();
    await register();
    expect(await store.listWithStatus()).toMatchObject([{ id: 'mac-1', name: "Ben's MacBook Pro", online: true }]);
  });

  it('refuses a bad jkt and an unknown machine', async () => {
    const { store, register } = await setup();
    await register();
    await expect(store.open('mac-1', 'short')).rejects.toThrow(/jkt/);
    await expect(store.open('nope', jkt)).rejects.toMatchObject({ status: 404 });
  });
});

describe('ConnectStore.remove', () => {
  it('deletes the DNS record, the tunnel and the row', async () => {
    const { store, cf, register } = await setup();
    await register();
    await store.remove('mac-1');
    expect(cf.records.size).toBe(0);
    expect(cf.tunnels.get('t1')!.deleted).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('only the token that registered a machine can remove it', async () => {
    const { store, cf, register } = await setup();
    await register();
    await expect(store.remove('mac-1', 'tok-other')).rejects.toMatchObject({ status: 403 });
    expect(cf.records.size).toBe(1);
    await store.remove('mac-1', 'tok-1');
    expect(store.list()).toEqual([]);
  });

  it('turning Connect off after a first registration lost the DNS answer deletes that record too, so registering again works', async () => {
    const { cf, store, register } = await setup();
    cf.lostOnce.add('POST /zones/zone/dns_records');
    await expect(register()).rejects.toMatchObject({ code: 'cloudflare' });
    expect(cf.records.size).toBe(1);
    await store.remove('mac-1', 'tok-1');
    expect(cf.records.size).toBe(0);
    const r = await register();
    expect(store.list()).toMatchObject([{ id: 'mac-1', hostname: r.hostname }]);
  });

  it('turning Connect off after a re-registration lost the answer to its replacement DNS record deletes that record too', async () => {
    const { cf, store, register } = await setup();
    await register();
    cf.records.clear();
    cf.lostOnce.add('POST /zones/zone/dns_records');
    await expect(register()).rejects.toMatchObject({ code: 'cloudflare' });
    expect(cf.records.size).toBe(1);
    await store.remove('mac-1', 'tok-1');
    expect(cf.records.size).toBe(0);
    const r = await register();
    expect(store.list()).toMatchObject([{ id: 'mac-1', hostname: r.hostname }]);
  });

  it("an old token signing out while the machine registers again under a new one leaves the new registration", async () => {
    const { cf, store, register, machine } = await setup();
    await register();
    let release!: () => void;
    cf.holds.set('PUT /accounts/acct/cfd_tunnel/t1/configurations', new Promise<void>((r) => (release = r)));
    const proof = await registerProof(machine.keys.privateJwk, { machineId: 'mac-1', user: 'user_ben', tokenId: 'tok-2', publicKey: machine.keys.publicJwk });
    const again = store.register({ machineId: 'mac-1', name: "Ben's MacBook Pro", publicKey: machine.keys.publicJwk, port: 4747, proof }, await caller('tok-2', 'mac-1'));
    await new Promise((r) => setTimeout(r, 10));
    const signout = store.removeForToken('tok-1');
    release();
    await again;
    await signout;
    expect(store.list()).toMatchObject([{ id: 'mac-1' }]);
    expect(cf.tunnels.get('t1')!.deleted).toBe(false);
  });

  it('removes the machines of a relay token that signs out', async () => {
    const { store, register } = await setup();
    await register();
    await store.removeForToken('other');
    expect(store.list()).toHaveLength(1);
    await store.removeForToken('tok-1');
    expect(store.list()).toEqual([]);
  });
});

describe('Connect page sessions', () => {
  it('a session works until it is removed or expires', async () => {
    const db = new DatabaseSync(':memory:');
    let clock = Date.parse('2026-11-01T12:00:00Z');
    const store = new ConnectStore(sqlOn(db), null, null, 'user_ben', fetch, () => clock);
    const token = newToken('user_ben', CLIENT_PREFIX);
    expect(tokenUser(token, CLIENT_PREFIX)).toBe('user_ben');
    expect(tokenUser(token)).toBeNull();
    await store.addClient(token, 'ben@example.com');
    expect(await store.checkClient(token)).toEqual({ email: 'ben@example.com' });
    clock += 31 * 86_400_000;
    await expect(store.checkClient(token)).rejects.toBeInstanceOf(RelayError);
    const other = newToken('user_ben', CLIENT_PREFIX);
    await store.addClient(other, null);
    await store.removeClient(other);
    await expect(store.checkClient(other)).rejects.toMatchObject({ code: 'signed_out' });
  });
});

describe('SigninStore', () => {
  function fakeClerk(answers: Record<string, unknown>[]) {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration'))
        return Response.json({ device_authorization_endpoint: 'https://clerk.test/oauth/device', token_endpoint: 'https://clerk.test/oauth/token' });
      if (url.endsWith('/oauth/device')) return Response.json({ device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://clerk.test/device', interval: 5, expires_in: 600 });
      const answer = answers.shift() ?? { error: 'authorization_pending' };
      return Response.json(answer, { status: 'error' in answer ? 400 : 200 });
    }) as typeof fetch;
  }
  const trust = { issuer: 'https://clerk.test', clientId: 'client' };

  it('keeps the device code and hands out a flow and secret; a poll with the wrong secret is refused', async () => {
    const store = new SigninStore(sqlOn(new DatabaseSync(':memory:')), trust, fakeClerk([{ error: 'authorization_pending' }, { id_token: 'id.token.here' }]));
    const f = await store.start();
    expect(f).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://clerk.test/device', interval: 5 });
    expect(JSON.stringify(f)).not.toContain('"dev"');
    await expect(store.poll(f.flow, 'wrong')).rejects.toMatchObject({ status: 404 });
    expect(await store.poll(f.flow, f.secret)).toEqual({ state: 'pending' });
    expect(await store.poll(f.flow, f.secret)).toEqual({ state: 'done', idToken: 'id.token.here' });
    await expect(store.poll(f.flow, f.secret)).rejects.toMatchObject({ status: 404 });
  });

  it('ends a declined flow', async () => {
    const store = new SigninStore(sqlOn(new DatabaseSync(':memory:')), trust, fakeClerk([{ error: 'access_denied' }]));
    const f = await store.start();
    expect(await store.poll(f.flow, f.secret)).toEqual({ state: 'denied' });
  });
});

describe('jwt', () => {
  it('thumbprint is RFC 7638 for a P-256 key', async () => {
    // RFC 7638 has no EC example; this pins our canonical form so the server's copy can be checked against it.
    expect(await thumbprint({ kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' })).toBe(
      'oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U',
    );
  });
});

describe('default fetch', () => {
  it('is called without the API object as `this`, which Workers refuse (Illegal invocation)', async () => {
    const real = globalThis.fetch;
    let seenThis: unknown = 'unset';
    globalThis.fetch = function (this: unknown) {
      seenThis = this;
      return Promise.resolve(Response.json({ success: true, result: [] }));
    } as typeof fetch;
    try {
      await new CloudflareApi(cfConfig).findTunnel('t').catch(() => undefined);
    } finally {
      globalThis.fetch = real;
    }
    expect(seenThis === undefined || seenThis === globalThis).toBe(true);
  });
});
