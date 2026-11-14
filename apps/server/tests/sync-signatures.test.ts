import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner, stopRunners } from './runner-boot.ts';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { signChange, rawPublicKey } from '../sync/signing.ts';
import { keyOf, signAs } from './sync-sign.ts';
import { wireFixture } from './fixture-shape.ts';

// Signed sync end to end (PRD #667, S9, S20, S3): changes another machine pushes to the relay, pulled by this one. The
// other machine is played by changes pushed as mac-b; the relay hands them over as it got them.

const r = await startRunner();
const sync = await import('../sync/worker.ts');
const { app } = await import('../app.ts');
const relay = new MemoryTransport();
const worker = sync.createSyncWorker({ transport: relay, machineId: 'this-mac' });
await sync.setActiveWorker(worker);

r.db.threads.create({
  id: 't-signed', channel_id: 'inbox', title: 'Signed', status: 'done', role: null, model: 'sonnet', session_id: 't-signed',
  cwd: join(homedir(), 'work'), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
} as any);

let n = 0;
const later = () => new Date(Date.now() + 1_000 + n++).toISOString();
const command = (id: string, over: Record<string, unknown> = {}): Change => ({
  machine_id: 'mac-b', entity: 'remote_command', entity_id: id, op: 'upsert', ts: later(),
  // For a third machine, so this one only stores it.
  data: { thread_id: 't-signed', kind: 'message', state: 'sent', sender: 'mac-b', target: 'mac-c', target_name: 'Mac C', prompt: 'hi', expires_at: '2099-01-01T00:00:00.000Z', ...over },
});
const stored = (id: string) => !!r.db.db.prepare('SELECT 1 FROM remote_commands WHERE id = ?').get(id);
const refused = async () => (await (await app.request('/api/sync/refused?limit=50')).json()) as any[];
const devices = async () => (await (await app.request('/api/sync/devices')).json()) as any[];
const pull = async (...changes: Change[]) => {
  await relay.push(changes);
  expect((await worker.syncNow()).error).toBeUndefined();
};

afterEach(() => {
  delete process.env.OMNI_SYNC_SIGNATURES;
});
afterAll(async () => {
  // A sync's device announcement runs after it, on its own (sync/devices.ts): let the last one end before the db closes.
  await r.until('the last device announcement', () => r.db.kv.get('devices.this-mac') !== undefined, 5_000).catch(() => {});
  await new Promise((done) => setTimeout(done, 300));
  worker.stop();
  await sync.setActiveWorker(null);
  await stopRunners();
});

describe('action entities need a valid signature', () => {
  it('a signed remote command from a machine lands, and pins its key', async () => {
    await pull(signAs(command('cmd-signed')));
    expect(stored('cmd-signed')).toBe(true);
    expect(r.db.db.prepare('SELECT sign_key FROM sync_keys WHERE machine_id = ?').get('mac-b')).toEqual({ sign_key: rawPublicKey(keyOf('mac-b')) });
  });

  it('an unsigned remote command is refused and logged', async () => {
    await pull(command('cmd-unsigned'));
    expect(stored('cmd-unsigned')).toBe(false);
    expect(await refused()).toContainEqual(expect.objectContaining({ machine: 'mac-b', entity: 'remote_command', entityId: 'cmd-unsigned', reason: 'unsigned', applied: false }));
  });

  it('a command signed with another key than the pinned one is refused', async () => {
    const swapped = generateKeyPairSync('ed25519').privateKey;
    await pull(signChange(command('cmd-swapped'), swapped));
    expect(stored('cmd-swapped')).toBe(false);
    expect((await refused())[0]).toMatchObject({ entityId: 'cmd-swapped', reason: 'signature does not match the pinned key', applied: false });
  });

  it('a command signed by a machine that neither sent nor received it is refused', async () => {
    await pull(signAs({ ...command('cmd-bystander'), machine_id: 'mac-d' }));
    expect(stored('cmd-bystander')).toBe(false);
    expect((await refused())[0]).toMatchObject({ machine: 'mac-d', reason: 'signed by a machine that neither sent nor received the command' });
  });

  it('with syncSignatures set to log, an unsigned command from an older build still lands, logged', async () => {
    process.env.OMNI_SYNC_SIGNATURES = 'log';
    await pull(command('cmd-rollout'));
    expect(stored('cmd-rollout')).toBe(true);
    expect(await refused()).toContainEqual(expect.objectContaining({ entity: 'remote_command', reason: 'unsigned', applied: true }));
  });

  it('an unsigned automations owner claim does not move the owner', async () => {
    const before = r.db.kv.get('automations.owner');
    await pull({ machine_id: 'mac-b', entity: 'kv', entity_id: 'automations.owner', op: 'upsert', data: { value: 'mac-b' }, ts: later() });
    expect(r.db.kv.get('automations.owner')).toBe(before);
  });
});

describe('keys and deletes', () => {
  it('an unsigned record never pins a key: it waits for Ben, and no secret is sealed to it', async () => {
    const forged = rawPublicKey(generateKeyPairSync('ed25519').privateKey);
    await pull({ machine_id: 'mac-f', entity: 'kv', entity_id: 'devices.mac-f', op: 'upsert', ts: later(), data: { value: { id: 'mac-f', name: 'Mac F', tailscale: null, signKey: forged, sealKey: 'x'.repeat(43), at: later() } } });
    expect(r.db.db.prepare('SELECT sign_key, seen_sign_key FROM sync_keys WHERE machine_id = ?').get('mac-f')).toEqual({ sign_key: null, seen_sign_key: forged });
    expect((await devices()).find((d) => d.id === 'mac-f')).toMatchObject({ keyChanged: true, pinnedFingerprint: null });
    const res = await app.request('/api/secrets/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine: 'mac-f', scope: 'global', name: 'SOME_KEY', value: 'v' }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/not confirmed/);
  });

  it('a remote command is deleted only by its sender or target', async () => {
    await pull(signAs({ ...command('cmd-del'), op: 'delete', machine_id: 'mac-d', data: null }));
    expect(stored('cmd-signed')).toBe(true);
    await pull(signAs({ ...command('cmd-signed'), op: 'delete', machine_id: 'mac-d', data: null }));
    expect(stored('cmd-signed')).toBe(true);
    expect((await refused())[0]).toMatchObject({ entityId: 'cmd-signed', reason: 'deleted by a machine that had no part in it' });
    await pull(signAs({ ...command('cmd-signed'), op: 'delete', data: null }));
    expect(stored('cmd-signed')).toBe(false);
  });
});

describe('other entities', () => {
  it('an unsigned change from an older build still applies, and is logged once per machine and entity', async () => {
    await pull(
      { machine_id: 'mac-old', entity: 'kv', entity_id: 'note.one', op: 'upsert', data: { value: 1 }, ts: later() },
      { machine_id: 'mac-old', entity: 'kv', entity_id: 'note.two', op: 'upsert', data: { value: 2 }, ts: later() },
    );
    expect(r.db.kv.get('note.two')).toBe(2);
    const logged = (await refused()).filter((e) => e.machine === 'mac-old');
    expect(logged).toEqual([expect.objectContaining({ entity: 'kv', reason: 'unsigned', applied: true, count: 2 })]);
  });

  it('strict refuses them too', async () => {
    process.env.OMNI_SYNC_SIGNATURES = 'strict';
    await pull({ machine_id: 'mac-old', entity: 'kv', entity_id: 'note.three', op: 'upsert', data: { value: 3 }, ts: later() });
    expect(r.db.kv.get('note.three')).toBeUndefined();
  });

  it("a machine's record written by another machine is refused", async () => {
    await pull(signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-e', op: 'upsert', data: { value: { name: 'Fake', tailscale: null, at: later() } }, ts: later() }));
    expect(r.db.kv.get('devices.mac-e')).toBeUndefined();
  });
});

describe('synced paths', () => {
  it('a thread pointed at ~/.ssh is refused; one in the home folder lands', async () => {
    const row = (id: string, cwd: string) =>
      signAs({ machine_id: 'mac-b', entity: 'thread', entity_id: id, op: 'upsert', ts: later(), data: { id, channel_id: 'inbox', title: id, status: 'done', model: 'sonnet', session_id: id, source: 'manual', cwd, created_at: later(), updated_at: later() } });
    await pull(row('t-ssh', '~/.ssh'), row('t-home', '~/work/volero'));
    expect(r.db.threads.get('t-ssh')).toBeUndefined();
    expect(r.db.threads.get('t-home')?.cwd).toBe(join(homedir(), 'work', 'volero'));
    expect(await refused()).toContainEqual(expect.objectContaining({ entity: 'thread', entityId: 't-ssh', reason: 'cwd inside ~/.ssh' }));
  });

  it("a folder that leads into Omni's data folder through a symlink is refused", async () => {
    const link = join(mkdtempSync(join(tmpdir(), 'omni-link-')), 'data');
    symlinkSync(process.env.OMNI_DATA_DIR!, link);
    await pull(signAs({ machine_id: 'mac-b', entity: 'thread', entity_id: 't-link', op: 'upsert', ts: later(), data: { id: 't-link', channel_id: 'inbox', title: 'link', status: 'done', model: 'sonnet', session_id: 't-link', source: 'manual', cwd: link, created_at: later(), updated_at: later() } }));
    expect(r.db.threads.get('t-link')).toBeUndefined();
  });

  it("a channel moved into Omni's data folder is refused", async () => {
    const data = process.env.OMNI_DATA_DIR!;
    await pull(signAs({ machine_id: 'mac-b', entity: 'channel', entity_id: 'inbox', op: 'upsert', ts: later(), data: { name: 'Inbox', repo_path: data } }));
    expect(r.db.channels.get('inbox')?.repo_path).toBeNull();
  });
});

describe('signing keys in Sync settings', () => {
  const record = (key: string) =>
    signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-b', op: 'upsert', ts: later(), data: { value: { id: 'mac-b', name: 'Mac B', tailscale: null, signKey: key, at: later() } } });

  it('lists this machine first and each other machine with its pinned key', async () => {
    await pull(record(rawPublicKey(keyOf('mac-b'))));
    const list = await devices();
    expect(list[0]).toMatchObject({ id: 'this-mac', current: true, keyChanged: false });
    const b = list.find((d) => d.id === 'mac-b');
    expect(b).toMatchObject({ name: 'Mac B', current: false, keyChanged: false });
    expect(b.fingerprint).toBe(b.pinnedFingerprint);
    wireFixture('sync-devices.json', list);
    wireFixture('sync-refused.json', (await refused()).slice(0, 3));
  });

  it('flags a new key until Ben confirms it, and changes signed with it wait for that', async () => {
    const next = generateKeyPairSync('ed25519').privateKey;
    await pull(record(rawPublicKey(next)));
    const b = (await devices()).find((d) => d.id === 'mac-b');
    expect(b.keyChanged).toBe(true);
    expect(b.fingerprint).not.toBe(b.pinnedFingerprint);
    await pull(signChange(command('cmd-new-key'), next));
    expect(stored('cmd-new-key')).toBe(false);

    expect((await app.request('/api/sync/devices/mac-b/confirm-key', { method: 'POST' })).status).toBe(200);
    expect((await devices()).find((d) => d.id === 'mac-b')).toMatchObject({ keyChanged: false });
    await pull(signChange(command('cmd-after-confirm'), next));
    expect(stored('cmd-after-confirm')).toBe(true);
    expect((await app.request('/api/sync/devices/mac-b/confirm-key', { method: 'POST' })).status).toBe(404);
  });
});
