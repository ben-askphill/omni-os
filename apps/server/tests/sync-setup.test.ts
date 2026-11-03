import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import type { ClerkClient, DevicePoll } from '../clerk.ts';
import { MemoryTransport, RelayRefusedError, type RelayAuth } from '../sync/transport.ts';

// Sign-in, pause and resume through /api/sync, with a fake Clerk, a fake relay and a fake Keychain.
// Nothing reaches the network or the real Keychain.
let db: typeof import('../db.ts');
let sync: typeof import('../sync/worker.ts');
let setup: typeof import('../sync/setup.ts');
let auth: typeof import('../google-auth.ts');
let app: ReturnType<typeof import('../sync-api.ts').createSyncApi>;

const dir = mkdtempSync(join(tmpdir(), 'omni-sync-setup-'));
const ID_TOKEN = 'eyJ.id-token-from-clerk.sig';
const CLERK = { issuer: 'https://clerk.example.dev', clientId: 'omni-app' };
const relay = new MemoryTransport();
const keychain = new Map<string, string>();
const calls: string[] = [];
let user = 'user_1';
let clock = Date.parse('2026-11-01T12:00:00Z');
let clerkAnswer: DevicePoll = { state: 'pending' };
let relayInfo: { issuer: string | null; clientId: string | null } | Error = CLERK;
let exchangeError: Error | null = null;

const fakeClerk = {
  config: CLERK,
  async startDevice() {
    calls.push('clerk start');
    return { deviceCode: 'dev-1', userCode: 'WDJB-MJHT', verificationUri: 'https://clerk.example.dev/device', verificationUriComplete: null, expiresIn: 600, interval: 5 };
  },
  async pollDevice() {
    calls.push('clerk poll');
    return clerkAnswer;
  },
} as unknown as ClerkClient;

const fakeRelay: RelayAuth = {
  async info(url) {
    calls.push(`info ${url}`);
    if (relayInfo instanceof Error) throw relayInfo;
    return relayInfo;
  },
  async exchange(url, idToken, machine) {
    calls.push(`exchange ${url} ${idToken} ${machine}`);
    if (exchangeError) throw exchangeError;
    return { token: `omni_r_${user}.token`, user: { id: user, email: 'ben@example.com' } };
  },
  async revoke(url, token) {
    calls.push(`revoke ${url} ${token}`);
  },
};

const post = (path: string, body?: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const put = (path: string, body: unknown) =>
  app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const URL_ = 'https://omni-relay.ben.workers.dev';

/** Start a sign-in, let Clerk approve it, and poll once. */
async function signIn(url = URL_) {
  const start = await post('/setup', { url });
  expect(start.status).toBe(200);
  const { flow, secret } = await start.json();
  clerkAnswer = { state: 'done', identity: { issuer: CLERK.issuer, sub: user, email: 'ben@example.com', name: 'Ben' }, idToken: ID_TOKEN };
  clock += 5_000;
  return post('/setup/poll', { flow, secret });
}

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = dir;
  db = await import('../db.ts');
  sync = await import('../sync/worker.ts');
  setup = await import('../sync/setup.ts');
  auth = await import('../google-auth.ts');
  app = (await import('../sync-api.ts')).createSyncApi({
    relay: fakeRelay,
    clerk: () => CLERK,
    machineName: async () => 'Ben’s MacBook Air',
    flows: { clerk: () => fakeClerk, now: () => clock },
    async storeSecret(name, value) {
      keychain.set(name, value);
      db.db.prepare(`INSERT OR REPLACE INTO secrets (scope, name) VALUES ('global', ?)`).run(name);
    },
    readSecret: async (name) => keychain.get(name) ?? null,
    async deleteSecret(name) {
      keychain.delete(name);
      db.db.prepare(`DELETE FROM secrets WHERE scope = 'global' AND name = ?`).run(name);
    },
    async start() {
      if (!sync.syncConfigured() || db.kv.get('sync.enabled') === false) return null;
      const w = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
      sync.setActiveWorker(w);
      return w;
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  clerkAnswer = { state: 'pending' };
  relayInfo = CLERK;
  exchangeError = null;
  auth.resetFlows();
});

describe('sync setup input', () => {
  it.each([
    [{ url: 'not a url' }, /relay URL/],
    [{ url: 'http://omni-relay.ben.workers.dev' }, /https/],
    [{}, /relay URL/],
  ])('refuses %o', async (body, message) => {
    const res = await post('/setup', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(calls).toEqual([]);
  });

  it('takes http for a relay under wrangler dev on this machine', () => {
    expect(setup.checkRelayUrl({ url: 'http://127.0.0.1:8787/' })).toBe('http://127.0.0.1:8787');
  });
});

describe('before Clerk is asked', () => {
  it('refuses a URL that is not an Omni relay', async () => {
    relayInfo = new RelayRefusedError('https://example.com is not an Omni relay', 400);
    const res = await post('/setup', { url: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(calls).not.toContain('clerk start');
  });

  it('refuses a relay that trusts another Clerk app, or none yet', async () => {
    relayInfo = { issuer: 'https://other.clerk.dev', clientId: 'omni-app' };
    const other = await post('/setup', { url: URL_ });
    expect(other.status).toBe(409);
    expect((await other.json()).error).toMatch(/another Clerk app/);
    relayInfo = { issuer: null, clientId: null };
    const none = await post('/setup', { url: URL_ });
    expect((await none.json()).error).toMatch(/relay:config/);
    expect(calls).not.toContain('clerk start');
  });

  it('says so when the relay is out of reach', async () => {
    relayInfo = new Error('Cannot reach the relay');
    expect((await post('/setup', { url: URL_ })).status).toBe(502);
  });
});

describe('sync setup', () => {
  it('shows the code, and stays pending until Clerk approves', async () => {
    const res = await post('/setup', { url: URL_ });
    const start = await res.json();
    expect(start).toMatchObject({ userCode: 'WDJB-MJHT', verificationUri: 'https://clerk.example.dev/device', interval: 5 });
    clock += 5_000;
    expect(await (await post('/setup/poll', { flow: start.flow, secret: start.secret })).json()).toEqual({ state: 'pending' });
    expect((await post('/setup/poll', { flow: start.flow, secret: 'wrong' })).status).toBe(404);
    expect(keychain.size).toBe(0);
  });

  it('says why when the relay refuses the account, and stores nothing', async () => {
    exchangeError = new RelayRefusedError('ben@example.com (Clerk user user_1) may not use this relay', 403);
    const r = await (await signIn()).json();
    expect(r).toEqual({ state: 'refused', error: expect.stringMatching(/may not use this relay/) });
    expect(keychain.size).toBe(0);
    expect(sync.activeWorker()).toBeNull();
  });

  it('a relay sign-in is not a device sign-in: /api/auth/google/poll does not know it', async () => {
    const { flow, secret } = await (await post('/setup', { url: URL_ })).json();
    await expect(auth.pollFlow(flow, secret, { clerk: () => fakeClerk, now: () => clock })).rejects.toThrow(/No such sign-in/);
  });

  it('signs in, keeps only the URL and this machine’s token, and starts syncing', async () => {
    db.db.prepare(`INSERT OR REPLACE INTO secrets (scope, name) VALUES ('global', 'SUPABASE_URL'), ('global', 'SUPABASE_REFRESH_TOKEN')`).run();
    keychain.set('SUPABASE_URL', 'https://abc.supabase.co').set('SUPABASE_REFRESH_TOKEN', 'old');
    expect((await (await app.request('/status')).json()).legacyRelay).toBe(true);

    const res = await signIn();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'signed_in', email: 'ben@example.com', relayChanged: false, status: { configured: true, enabled: true, machineId: 'mac-a', legacyRelay: false } });
    expect(calls).toContain(`exchange ${URL_} ${ID_TOKEN} Ben’s MacBook Air`);
    // The Supabase credentials go with the move.
    expect(Object.fromEntries(keychain)).toEqual({ OMNI_RELAY_URL: URL_, OMNI_RELAY_TOKEN: 'omni_r_user_1.token' });
    expect(sync.activeWorker()?.machineId).toBe('mac-a');
  });

  it('never writes the ID token anywhere', async () => {
    expect([...keychain.values()]).not.toContain(ID_TOKEN);
    db.db.exec('PRAGMA wal_checkpoint(FULL)');
    for (const f of readdirSync(dir)) {
      if (f.startsWith('omni.db')) expect(readFileSync(join(dir, f)).includes(ID_TOKEN)).toBe(false);
    }
  });

  it('pauses and resumes, keeping the credentials', async () => {
    const off = await post('/disable');
    expect(off.status).toBe(200);
    expect((await off.json()).status).toMatchObject({ configured: true, enabled: false });
    expect(sync.activeWorker()).toBeNull();
    expect(keychain.size).toBe(2);
    expect((await post('/now')).status).toBe(409);

    const on = await post('/enable');
    expect(on.status).toBe(200);
    expect((await on.json()).status).toMatchObject({ configured: true, enabled: true });
    expect(sync.activeWorker()).not.toBeNull();
  });

  it('starts over from the beginning of a different relay', async () => {
    await sync.activeWorker()!.syncNow();
    db.kv.set('sync.cursor', 42);
    db.db.prepare(`INSERT INTO sync_deferred (seq, change, error) VALUES (7, '{}', 'x')`).run();
    const pending = db.outbox.counts(['thread']).pending;
    user = 'user_2';
    const res = await signIn('https://other-relay.ben.workers.dev');
    expect(await res.json()).toMatchObject({ state: 'signed_in', relayChanged: true });
    expect(db.kv.get('sync.cursor')).toBe(0);
    expect((await import('../sync/apply.ts')).deferredCount()).toBe(0);
    // Everything goes to the new relay again.
    expect(db.outbox.counts(['channel', 'thread', 'kv']).pending).toBeGreaterThan(pending);
  });

  it('signs out on the relay and forgets the credentials when asked', async () => {
    const res = await post('/disable', { forget: true });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toMatchObject({ configured: false, enabled: false });
    expect(calls).toEqual(['revoke https://other-relay.ben.workers.dev omni_r_user_2.token']);
    expect(keychain.size).toBe(0);
    expect((await post('/enable')).status).toBe(409);
  });
});

describe('signed out', () => {
  it('says so in the status until a sync succeeds again', async () => {
    const { SyncSignedOutError } = await import('../sync/transport.ts');
    const dead = new MemoryTransport();
    let refused = true;
    dead.pull = async (o) => {
      if (refused) throw new SyncSignedOutError('This machine is signed out of the relay');
      return MemoryTransport.prototype.pull.call(dead, o);
    };
    const w = sync.createSyncWorker({ transport: dead });
    await w.syncNow();
    expect(w.status()).toMatchObject({ signedOut: true, lastError: expect.stringMatching(/sign in again/) });
    refused = false;
    await w.syncNow();
    expect(w.status()).toMatchObject({ signedOut: false, lastError: null });
    expect(sync.syncStatus().signedOut).toBe(false);
  });
});

describe('path map', () => {
  it('reads and writes kv sync.path_map, and refuses paths that are not absolute or ~', async () => {
    expect(await (await app.request('/path-map')).json()).toEqual({ map: {} });
    const ok = await put('/path-map', { map: { '~/work/': '~/code', '/Volumes/old': '/Volumes/new' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ map: { '~/work': '~/code', '/Volumes/old': '/Volumes/new' } });
    expect(db.kv.get('sync.path_map')).toEqual({ '~/work': '~/code', '/Volumes/old': '/Volumes/new' });
    for (const map of [{ 'work': '~/code' }, { '~/a': '' }, ['~/a'], { '~/a': 3 }]) {
      const bad = await put('/path-map', { map });
      expect(bad.status).toBe(400);
    }
    expect(db.kv.get('sync.path_map')).toEqual({ '~/work': '~/code', '/Volumes/old': '/Volumes/new' });
  });
});

describe('wire fixture', () => {
  it('gets the status keys and types its hand-made fixture has', async () => {
    // The server must still send the shape of this fixture. Null reads as a string, the type of every nullable field.
    const path = join(WIRE_FIXTURES, 'sync-status.json');
    const shape = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? 'string' : typeof v]));
    const live = await (await app.request('/status')).json();
    expect(shape(live)).toEqual(shape(JSON.parse(readFileSync(path, 'utf8'))));
  });
});
