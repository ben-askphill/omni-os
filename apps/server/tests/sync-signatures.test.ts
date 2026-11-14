import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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
/** A command sent by another machine than mac-b. */
const commandFrom = (machine: string, id: string): Change => {
  const c = command(id);
  return { ...c, machine_id: machine, data: { ...(c.data as object), sender: machine } };
};
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

const trust = (id: string) => app.request(`/api/sync/devices/${id}/confirm-key`, { method: 'POST' });
const sendSecret = (machine: string) =>
  app.request('/api/secrets/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine, scope: 'global', name: 'SOME_KEY', value: 'v' }) });

const trusted = (id: string) => r.db.db.prepare('SELECT sign_key FROM sync_trusted WHERE machine_id = ?').get(id) as { sign_key: string } | undefined;
const record = (id: string, key: string, over: Record<string, unknown> = {}) =>
  signAs({ machine_id: id, entity: 'kv', entity_id: `devices.${id}`, op: 'upsert', ts: later(), data: { value: { id, name: id.toUpperCase(), tailscale: null, signKey: key, at: later(), ...over } } });

describe('a paired machine is trusted with its first key', () => {
  it("pins and trusts a new machine's first signed key, so its remote command applies at once", async () => {
    await pull(
      record('mac-b', rawPublicKey(keyOf('mac-b')), { name: 'Mac B' }),
      signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'note.new-machine', op: 'upsert', data: { value: 'hello' }, ts: later() }),
      signAs(command('cmd-first')),
    );
    expect(r.db.kv.get('note.new-machine')).toBe('hello');
    expect(stored('cmd-first')).toBe(true);
    expect(trusted('mac-b')).toEqual({ sign_key: rawPublicKey(keyOf('mac-b')) });
    expect((await devices()).find((d) => d.id === 'mac-b')).toMatchObject({ trusted: true, keyChanged: false, held: 0 });
    expect((await refused()).filter((e) => e.machine === 'mac-b')).toEqual([]);
    // Nothing waits, so there is nothing to confirm, and a machine never seen cannot be trusted ahead of time.
    expect((await trust('mac-b')).status).toBe(404);
    expect((await trust('mac-never-seen')).status).toBe(404);
    expect((await trust('this-mac')).status).toBe(404);
  });

  it('trusts a machine whose first signed change comes before its record', async () => {
    await pull(signAs(commandFrom('mac-e', 'cmd-before-record')));
    expect(stored('cmd-before-record')).toBe(true);
    expect(trusted('mac-e')).toEqual({ sign_key: rawPublicKey(keyOf('mac-e')) });
  });

  it('sends a secret to a newly paired machine', async () => {
    const sealKey = rawPublicKey(generateKeyPairSync('x25519').privateKey);
    await pull(record('mac-n', rawPublicKey(keyOf('mac-n')), { sealKey }));
    expect(r.db.db.prepare('SELECT seal_key FROM sync_keys WHERE machine_id = ?').get('mac-n')).toEqual({ seal_key: sealKey });
    expect((await sendSecret('mac-n')).status).toBe(200);
  });

  it('holds the actions of a machine trusted with another key and discards them when Ben trusts it', async () => {
    await pull(record('mac-s', rawPublicKey(keyOf('mac-s'))));
    // Trusted once with a key that is not the pinned one, as a confirmed-but-not-trusted key could leave it.
    r.db.db.prepare('UPDATE sync_trusted SET sign_key = ? WHERE machine_id = ?').run('an-older-key', 'mac-s');
    await pull(signAs(commandFrom('mac-s', 'cmd-stale')));
    expect(stored('cmd-stale')).toBe(false);
    expect(await refused()).toContainEqual(expect.objectContaining({ machine: 'mac-s', entityId: 'cmd-stale', reason: 'waiting for Trust', applied: false }));
    // Held, not dropped: the next sync does not log it again.
    await pull();
    expect((await refused()).filter((e) => e.entityId === 'cmd-stale')).toEqual([expect.objectContaining({ count: 1 })]);
    expect((await devices()).find((d) => d.id === 'mac-s')).toMatchObject({ trusted: false, keyChanged: false, held: 1 });
    expect((await sendSecret('mac-s')).status).toBe(409);
    expect((await trust('mac-s')).status).toBe(200);
    await pull();
    expect(stored('cmd-stale')).toBe(false);
    expect(await refused()).toContainEqual(expect.objectContaining({ entityId: 'cmd-stale', reason: 'discarded when the key was confirmed; send again if still needed', applied: false }));
  });

  it('the migration trusts machines already pinned before this build and lets their held commands apply', async () => {
    // A machine from the Trust-click build: pinned, never trusted, its command held.
    await pull(record('mac-m', rawPublicKey(keyOf('mac-m'))));
    r.db.db.prepare('DELETE FROM sync_trusted WHERE machine_id = ?').run('mac-m');
    await pull(signAs(commandFrom('mac-m', 'cmd-held')));
    expect(stored('cmd-held')).toBe(false);
    // And one whose key changed and waits for Ben: the migration leaves it alone.
    await pull(record('mac-k', rawPublicKey(keyOf('mac-k'))));
    r.db.db.prepare('DELETE FROM sync_trusted WHERE machine_id = ?').run('mac-k');
    await pull(record('mac-k', rawPublicKey(generateKeyPairSync('ed25519').privateKey)));
    expect(r.db.db.prepare('SELECT seen_sign_key IS NOT NULL AS seen FROM sync_keys WHERE machine_id = ?').get('mac-k')).toEqual({ seen: 1 });

    r.db.migrate();
    expect(trusted('mac-m')).toEqual({ sign_key: rawPublicKey(keyOf('mac-m')) });
    expect(trusted('mac-k')).toBeUndefined();
    expect((await refused()).filter((e) => e.entityId === 'cmd-held')).toEqual([]);
    await pull();
    expect(stored('cmd-held')).toBe(true);
  });
});

describe('first-key pairing evidence from the relay', () => {
  const keys = (id: string) => r.db.db.prepare('SELECT sign_key, seen_sign_key FROM sync_keys WHERE machine_id = ?').get(id);

  it('keeps the first key of a machine missing from Connect seen only, syncs its data and holds its actions, including after a restart migration', async () => {
    const list = vi.spyOn(relay, 'pairedMachines').mockResolvedValue(new Set());
    try {
      await pull(
        signAs(commandFrom('not-paired', 'cmd-not-paired')),
        signAs({ machine_id: 'not-paired', entity: 'kv', entity_id: 'note.not-paired', op: 'upsert', data: { value: 'data' }, ts: later() }),
        record('not-paired', rawPublicKey(keyOf('not-paired'))),
      );
      expect(keys('not-paired')).toEqual({ sign_key: null, seen_sign_key: rawPublicKey(keyOf('not-paired')) });
      expect(r.db.kv.get('note.not-paired')).toBe('data');
      expect(trusted('not-paired')).toBeUndefined();
      expect(stored('cmd-not-paired')).toBe(false);
      expect((await devices()).find((d) => d.id === 'not-paired')).toMatchObject({ trusted: false, pinnedFingerprint: null, held: 1 });
      r.db.migrate();
      await pull();
      expect(trusted('not-paired')).toBeUndefined();
      expect(stored('cmd-not-paired')).toBe(false);
      // A later relay registration is enough. The first signed action can still precede the device record.
      list.mockResolvedValue(new Set(['not-paired']));
      await pull();
      expect(stored('cmd-not-paired')).toBe(true);
      expect(trusted('not-paired')).toEqual({ sign_key: rawPublicKey(keyOf('not-paired')) });
      expect((await devices()).find((d) => d.id === 'not-paired')).toMatchObject({ trusted: true, keyChanged: false, held: 0 });
    } finally {
      list.mockRestore();
    }
  });

  it('keeps syncing trusted machines when the registration list is unavailable, and Ben can trust the new machine by hand', async () => {
    const list = vi.spyOn(relay, 'pairedMachines').mockRejectedValue(new Error('registration list unavailable'));
    try {
      await pull(signAs(commandFrom('offline-list', 'cmd-offline-list')), signAs(command('cmd-trusted-while-offline')));
      expect(stored('cmd-trusted-while-offline')).toBe(true);
      expect(trusted('offline-list')).toBeUndefined();
      expect(stored('cmd-offline-list')).toBe(false);
      expect(await refused()).toContainEqual(expect.objectContaining({ machine: 'offline-list', entityId: 'cmd-offline-list', reason: 'waiting for Trust', applied: false }));
      expect((await trust('offline-list')).status).toBe(200);
      expect(trusted('offline-list')).toEqual({ sign_key: rawPublicKey(keyOf('offline-list')) });
      await pull(signAs(commandFrom('offline-list', 'cmd-after-trust')));
      expect(stored('cmd-offline-list')).toBe(false);
      expect(stored('cmd-after-trust')).toBe(true);
    } finally {
      list.mockRestore();
    }
  });
});

describe('forged changes', () => {
  it("refuses a change that names this machine: the relay never hands a machine its own", async () => {
    // A relay that follows the protocol never sends it (MemoryTransport filters it out), so the gate is asked directly.
    const { gateChange } = await import('../sync/verify.ts');
    const forged = { ...signAs({ machine_id: 'this-mac', entity: 'kv', entity_id: 'note.self', op: 'upsert', data: { value: 'forged' }, ts: later() }), seq: 1 } as const;
    expect(gateChange(forged as any)).toMatchObject({ kind: 'refuse', reason: 'names this machine' });
    expect(r.db.db.prepare('SELECT 1 FROM sync_keys WHERE machine_id = ?').get('this-mac')).toBeUndefined();
  });
});

describe('action entities need a valid signature', () => {

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
    const res = await sendSecret('mac-f');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/not confirmed/);
  });

  it('a remote command is deleted only by its sender or target', async () => {
    await pull(signAs({ ...command('cmd-del'), op: 'delete', machine_id: 'mac-d', data: null }));
    expect(stored('cmd-first')).toBe(true);
    await pull(signAs({ ...command('cmd-first'), op: 'delete', machine_id: 'mac-d', data: null }));
    expect(stored('cmd-first')).toBe(true);
    expect((await refused())[0]).toMatchObject({ entityId: 'cmd-first', reason: 'deleted by a machine that had no part in it' });
    await pull(signAs({ ...command('cmd-first'), op: 'delete', data: null }));
    expect(stored('cmd-first')).toBe(false);
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
  const keys = (id: string) => r.db.db.prepare('SELECT sign_key, seen_sign_key FROM sync_keys WHERE machine_id = ?').get(id);
  const recordB = (key: string) => record('mac-b', key, { name: 'Mac B' });

  it('lists this machine first and each other machine with its pinned key', async () => {
    await pull(recordB(rawPublicKey(keyOf('mac-b'))));
    const list = await devices();
    expect(list[0]).toMatchObject({ id: 'this-mac', current: true, keyChanged: false });
    const b = list.find((d) => d.id === 'mac-b');
    expect(b).toMatchObject({ name: 'Mac B', current: false, keyChanged: false });
    expect(b.fingerprint).toBe(b.pinnedFingerprint);
    wireFixture('sync-devices.json', list);
    wireFixture('sync-refused.json', (await refused()).slice(0, 3));
  });

  it('flags a new key until Ben confirms it, discards held actions and accepts future actions', async () => {
    const before = trusted('mac-b');
    const next = generateKeyPairSync('ed25519').privateKey;
    await pull(recordB(rawPublicKey(next)));
    const b = (await devices()).find((d) => d.id === 'mac-b');
    expect(b.keyChanged).toBe(true);
    expect(b.fingerprint).not.toBe(b.pinnedFingerprint);
    // A changed key never inherits trust by itself: the old key stays the trusted one.
    expect(trusted('mac-b')).toEqual(before);
    await pull(signChange(command('cmd-new-key'), next));
    expect(stored('cmd-new-key')).toBe(false);
    expect(await refused()).toContainEqual(expect.objectContaining({ machine: 'mac-b', entityId: 'cmd-new-key', reason: 'waiting for the new key to be confirmed', applied: false }));
    expect((await devices()).find((d) => d.id === 'mac-b')).toMatchObject({ keyChanged: true, held: 1 });
    // A third key that is neither pinned nor announced is still refused outright.
    await pull(signChange(command('cmd-other-key'), generateKeyPairSync('ed25519').privateKey));
    expect(await refused()).toContainEqual(expect.objectContaining({ entityId: 'cmd-other-key', reason: 'signature does not match the pinned key' }));

    expect((await trust('mac-b')).status).toBe(200);
    expect(trusted('mac-b')).toEqual({ sign_key: rawPublicKey(next) });
    expect((await devices()).find((d) => d.id === 'mac-b')).toMatchObject({ keyChanged: false, trusted: true, held: 0 });
    await pull(signChange(command('cmd-after-confirm'), next));
    expect(stored('cmd-new-key')).toBe(false);
    expect(await refused()).toContainEqual(expect.objectContaining({ entityId: 'cmd-new-key', reason: 'discarded when the key was confirmed; send again if still needed', applied: false }));
    expect(stored('cmd-after-confirm')).toBe(true);
    expect(stored('cmd-other-key')).toBe(false);
    expect((await trust('mac-b')).status).toBe(404);
  });

  it('drains actions the relay holds before confirming, and confirms nothing when that sync fails', async () => {
    const machine = 'drain-mac';
    const old = rawPublicKey(keyOf(machine));
    const next = generateKeyPairSync('ed25519').privateKey;
    await pull(record(machine, old));
    await pull(record(machine, rawPublicKey(next)), signChange(commandFrom(machine, 'cmd-drain-pulled'), next));
    // Pushed after the last pull: this machine has not seen it when Ben clicks.
    await relay.push([signChange(commandFrom(machine, 'cmd-drain-unpulled'), next)]);
    await worker.settled();
    const deferredIds = () => (r.db.db.prepare('SELECT change FROM sync_deferred').all() as { change: string }[]).map((row) => JSON.parse(row.change).entity_id);

    const failing = vi.spyOn(relay, 'pull').mockRejectedValueOnce(new Error('relay down'));
    const res = await trust(machine);
    failing.mockRestore();
    expect(res.status).toBe(503);
    expect(keys(machine)).toEqual({ sign_key: old, seen_sign_key: rawPublicKey(next) });
    expect(trusted(machine)).toEqual({ sign_key: old });
    expect(deferredIds()).toContain('cmd-drain-pulled');

    const [a, b] = await Promise.all([trust(machine), trust(machine)]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    await worker.settled();
    expect(trusted(machine)).toEqual({ sign_key: rawPublicKey(next) });
    expect(stored('cmd-drain-pulled')).toBe(false);
    expect(stored('cmd-drain-unpulled')).toBe(false);
    expect(deferredIds()).not.toContain('cmd-drain-unpulled');
    const log = await refused();
    for (const id of ['cmd-drain-pulled', 'cmd-drain-unpulled'])
      expect(log).toContainEqual(expect.objectContaining({ entityId: id, reason: 'discarded when the key was confirmed; send again if still needed' }));
  });

  it('stops a confirm when the machine announces another key during its sync', async () => {
    const machine = 'swap-mac';
    await pull(record(machine, rawPublicKey(keyOf(machine))));
    const next = rawPublicKey(generateKeyPairSync('ed25519').privateKey);
    await pull(record(machine, next));
    const third = rawPublicKey(generateKeyPairSync('ed25519').privateKey);
    await relay.push([record(machine, third)]);
    await worker.settled();
    expect((await trust(machine)).status).toBe(409);
    expect(keys(machine)).toEqual({ sign_key: rawPublicKey(keyOf(machine)), seen_sign_key: third });
    expect(trusted(machine)).toEqual({ sign_key: rawPublicKey(keyOf(machine)) });
    expect((await trust(machine)).status).toBe(200);
    expect(trusted(machine)).toEqual({ sign_key: third });
  });

  it('discards every held action for the confirmed machine, keeping other machines and ordinary deferred data', async () => {
    const { applyChange, getHandler, registerHandler, unregisterHandler } = await import('../sync/apply.ts');
    const { keyring } = await import('../sync/keyring.ts');
    const machine = 'discard-all';
    const other = 'discard-other';
    await pull(record(machine, rawPublicKey(keyOf(machine))), record(other, rawPublicKey(keyOf(other))));
    const next = generateKeyPairSync('ed25519').privateKey;
    await pull(record(machine, rawPublicKey(next)));
    // A different machine has its own held action. Confirming this one must not discard it.
    r.db.db.prepare('DELETE FROM sync_trusted WHERE machine_id = ?').run(other);
    await pull(signAs(commandFrom(other, 'cmd-keep-other')));
    const actions: Change[] = [
      commandFrom(machine, 'cmd-discard-all'),
      { machine_id: machine, entity: 'assignment', entity_id: 't-held-assignment', op: 'upsert', data: {}, ts: later() },
      ...['update.ask.discard', 'automations.owner', 'secretdrop.discard', 'secretack.discard'].map((entity_id): Change =>
        ({ machine_id: machine, entity: 'kv', entity_id, op: 'upsert', data: { value: { sender: machine } }, ts: later() })),
    ];
    await pull(...actions.map((c) => signChange(c, next)));
    // Also cover an action signed with the old pinned key but held on a missing thread, not on the key gate.
    const missing = commandFrom(machine, 'cmd-missing-thread');
    missing.data = { ...(missing.data as object), thread_id: 'not-here' };
    await pull(signAs(missing));
    // An ordinary change held for a missing handler must survive confirmation.
    const artifactHandler = getHandler('artifact')!;
    unregisterHandler('artifact');
    const ordinary = { machine_id: machine, entity: 'artifact', entity_id: 'held-artifact', op: 'upsert', data: {}, ts: later() } as const;
    expect(applyChange({ ...signChange(ordinary, next), seq: 900_000 }, { machineId: 'this-mac' })).toBe('deferred');
    expect((await trust(machine)).status).toBe(200);
    // Checking the persisted queue also proves these drops survive worker restarts.
    const deferred = () => (r.db.db.prepare('SELECT change FROM sync_deferred').all() as { change: string }[]).map((r) => JSON.parse(r.change));
    expect(deferred().filter((c) => c.machine_id === machine)).toEqual([expect.objectContaining({ entity: 'artifact' })]);
    expect(deferred()).toContainEqual(expect.objectContaining({ entity_id: 'cmd-keep-other' }));
    expect(keyring.trusted(machine)).toBe(true);
    const log = await refused();
    for (const c of [...actions, missing]) expect(log).toContainEqual(expect.objectContaining({ machine, entityId: c.entity_id, applied: false, reason: 'discarded when the key was confirmed; send again if still needed' }));
    // Repeated confirmation is a no-op and cannot start anything either.
    expect((await trust(machine)).status).toBe(404);
    await pull(signChange(commandFrom(machine, 'cmd-future'), next));
    expect(stored('cmd-discard-all')).toBe(false);
    expect(stored('cmd-missing-thread')).toBe(false);
    expect(stored('cmd-future')).toBe(true);
    // Restore the handler registration for any later sync.
    registerHandler('artifact', artifactHandler);
  });
});
