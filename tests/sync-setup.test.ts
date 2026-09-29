import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../server/sync/transport.ts';

// Sign-in, pause and resume through /api/sync, with a fake Supabase auth and a fake Keychain.
// Nothing reaches the network or the real Keychain.
let db: typeof import('../server/db.ts');
let sync: typeof import('../server/sync/worker.ts');
let setup: typeof import('../server/sync/setup.ts');
let syncApi: typeof import('../server/sync-api.ts');
let app: ReturnType<typeof import('../server/sync-api.ts').createSyncApi>;

const dir = mkdtempSync(join(tmpdir(), 'omni-sync-setup-'));
const PASSWORD = 'correct horse battery staple 1f9a';
const relay = new MemoryTransport();
const keychain = new Map<string, string>();
const calls: string[] = [];
let user = 'user-1';
let probeError: string | null = null;

const fakeAuth = (url: string, anonKey: string): import('../server/sync/setup.ts').SyncAuth => ({
  async signInWithPassword(email, password) {
    calls.push(`password ${url} ${anonKey} ${email}`);
    if (password !== PASSWORD) throw Object.assign(new Error('Invalid login credentials'), { status: 400 });
    return { refreshToken: 'refresh-from-password', userId: user, email };
  },
  async sendCode(email) {
    calls.push(`send ${email}`);
  },
  async verifyCode(email, code) {
    calls.push(`verify ${email} ${code}`);
    if (code !== '123456') throw Object.assign(new Error('Token has expired or is invalid'), { status: 403 });
    return { refreshToken: 'refresh-from-code', userId: user, email };
  },
  async probe() {
    if (probeError) throw new Error(probeError);
  },
});

const post = (path: string, body?: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const put = (path: string, body: unknown) =>
  app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const good = { url: 'https://abc.supabase.co/', anonKey: 'anon-key', email: 'ben@example.com' };

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = dir;
  db = await import('../server/db.ts');
  sync = await import('../server/sync/worker.ts');
  setup = await import('../server/sync/setup.ts');
  syncApi = await import('../server/sync-api.ts');
  app = syncApi.createSyncApi({
    auth: fakeAuth,
    async storeSecret(name, value) {
      keychain.set(name, value);
      db.db.prepare(`INSERT OR REPLACE INTO secrets (scope, name) VALUES ('global', ?)`).run(name);
    },
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
  probeError = null;
});

describe('sync setup input', () => {
  it.each([
    [{ ...good, url: 'not a url' }, /Supabase URL/],
    [{ ...good, url: 'http://abc.supabase.co' }, /https/],
    [{ ...good, anonKey: '' }, /anon key/],
    [{ ...good, anonKey: 'sb_secret_abc' }, /service-role|secret key/],
    [{ ...good, anonKey: `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y` }, /service-role/],
    [{ ...good, email: 'nope' }, /email/],
    [{ ...good, password: PASSWORD, code: '123456' }, /password or a code/],
  ])('refuses %o', async (body, message) => {
    const res = await post('/setup', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(calls).toEqual([]);
    expect(keychain.size).toBe(0);
  });

  it('takes http for a local Supabase', () => {
    expect(setup.checkSetup({ ...good, url: 'http://127.0.0.1:54321' }).url).toBe('http://127.0.0.1:54321');
  });
});

describe('sync setup', () => {
  it('reports a wrong password without storing anything', async () => {
    const res = await post('/setup', { ...good, password: 'wrong' });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid login credentials');
    expect(keychain.size).toBe(0);
    expect(sync.activeWorker()).toBeNull();
  });

  it('sends a code when no password or code is given', async () => {
    const res = await post('/setup', good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'code_sent', email: 'ben@example.com' });
    expect(calls).toEqual(['send ben@example.com']);
    expect(keychain.size).toBe(0);
  });

  it('says so when the relay has not been set up', async () => {
    probeError = 'relation "public.changes" does not exist';
    const res = await post('/setup', { ...good, code: '123456' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/changes.*README/s);
    expect(keychain.size).toBe(0);
  });

  it('signs in with a code, stores the credentials in the Keychain and starts syncing', async () => {
    const res = await post('/setup', { ...good, code: ' 123456 ' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ state: 'signed_in', email: 'ben@example.com', status: { configured: true, enabled: true, machineId: 'mac-a' } });
    expect(calls).toEqual(['verify ben@example.com 123456']);
    expect(Object.fromEntries(keychain)).toEqual({
      SUPABASE_URL: 'https://abc.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_REFRESH_TOKEN: 'refresh-from-code',
    });
    expect(sync.activeWorker()?.machineId).toBe('mac-a');
  });

  it('signs in with a password and never writes the password anywhere', async () => {
    const res = await post('/setup', { ...good, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(keychain.get('SUPABASE_REFRESH_TOKEN')).toBe('refresh-from-password');
    expect([...keychain.values()]).not.toContain(PASSWORD);
    db.db.exec('PRAGMA wal_checkpoint(FULL)');
    for (const f of readdirSync(dir)) {
      if (f.startsWith('omni.db')) expect(readFileSync(join(dir, f)).includes(PASSWORD)).toBe(false);
    }
  });

  it('pauses and resumes, keeping the credentials', async () => {
    const off = await post('/disable');
    expect(off.status).toBe(200);
    expect((await off.json()).status).toMatchObject({ configured: true, enabled: false });
    expect(sync.activeWorker()).toBeNull();
    expect(keychain.size).toBe(3);
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
    user = 'user-2';
    const res = await post('/setup', { ...good, url: 'https://other.supabase.co', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(db.kv.get('sync.cursor')).toBe(0);
    expect((await import('../server/sync/apply.ts')).deferredCount()).toBe(0);
    // Everything goes to the new relay again.
    expect(db.outbox.counts(['channel', 'thread', 'kv']).pending).toBeGreaterThan(pending);
  });

  it('forgets the credentials when asked', async () => {
    const res = await post('/disable', { forget: true });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toMatchObject({ configured: false, enabled: false });
    expect(keychain.size).toBe(0);
    expect((await post('/enable')).status).toBe(409);
  });
});

describe('signed out', () => {
  it('says so in the status until a sync succeeds again', async () => {
    const { SyncSignedOutError } = await import('../server/sync/transport.ts');
    const dead = new MemoryTransport();
    let refused = true;
    dead.pull = async (o) => {
      if (refused) throw new SyncSignedOutError('Invalid Refresh Token');
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

describe('Mac app', () => {
  it('gets the status keys and types its hand-made fixture has', async () => {
    // The Mac app's SyncStatus decodes this fixture; the server must still send the same shape. Null reads
    // as a string, the type of every nullable field.
    const path = join(import.meta.dirname, '..', 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures', 'sync-status.json');
    const shape = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? 'string' : typeof v]));
    const live = await (await app.request('/status')).json();
    expect(shape(live)).toEqual(shape(JSON.parse(readFileSync(path, 'utf8'))));
  });
});
