import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport } from '../server/sync/transport.ts';

// With sync on, one Mac runs the scheduled automations: the one kv `automations.owner` names, a synced key, so
// both Macs agree. A Mac claims it when no owner has reached it by the end of its first sync, and can take it
// from Settings. Manual runs go anywhere. The other Mac is played by changes pushed to the relay as mac-b.

const dir = mkdtempSync(join(tmpdir(), 'omni-automations-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
writeFileSync(join(dir, 'nightly.yaml'), 'name: Nightly\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: tidy up\n');
const automations = await import('../server/automations.ts');
const sync = await import('../server/sync/worker.ts');
const { app } = await import('../server/app.ts');
const relay = new MemoryTransport();

const nightly = () => automations.loadAutomations().find((a) => a.id === 'nightly')!;
const runs = () => r.db.db.prepare(`SELECT trigger FROM automation_runs WHERE automation = 'nightly' ORDER BY id`).all().map((x: any) => x.trigger);
const status = async () => (await (await app.request('/api/sync/status')).json()) as any;
const takeOver = () => app.request('/api/sync/automations-owner', { method: 'POST' });
/** mac-b's write of the owner key, as it would reach the relay. */
const fromB = (owner: string, ts = new Date(Date.now() + 1_000).toISOString()) =>
  relay.push([{ machine_id: 'mac-b', entity: 'kv', entity_id: 'automations.owner', op: 'upsert', data: { value: owner }, ts }]);

describe('with sync off', () => {
  it('scheduled automations run here, as before', async () => {
    expect(await automations.fireScheduled(nightly())).not.toBeNull();
    expect(runs()).toEqual(['cron']);
    expect((await status()).automations).toEqual({ owner: null, isThisMac: true });
  });

  it('there is nothing to take over', async () => {
    expect((await takeOver()).status).toBe(409);
  });
});

describe('with sync on', () => {
  let worker: ReturnType<typeof sync.createSyncWorker>;

  it('before its first sync, with no owner yet, this Mac still runs them', async () => {
    worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    expect(r.db.kv.get('automations.owner')).toBeUndefined();
    expect(await automations.fireScheduled(nightly())).not.toBeNull();
  });

  it('claims them on its first sync when no other Mac has, and the claim goes to the relay in that sync', async () => {
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(r.db.kv.get('automations.owner')).toBe('mac-a');
    expect((await status()).automations).toEqual({ owner: 'mac-a', isThisMac: true });
    expect((await status()).pending).toBe(0);
    expect(relay.changes.some((c) => c.entity === 'kv' && c.entity_id === 'automations.owner' && (c.data as any).value === 'mac-a')).toBe(true);
  });

  it('once the other Mac takes them, a cron tick here does nothing; a manual run still goes', async () => {
    await fromB('mac-b');
    expect((await worker.syncNow()).error).toBeUndefined();
    expect((await status()).automations).toEqual({ owner: 'mac-b', isThisMac: false });
    const before = runs().length;
    expect(await automations.fireScheduled(nightly())).toBeNull();
    expect(runs().length).toBe(before);
    const manual = await app.request('/api/automations/nightly/run', { method: 'POST' });
    expect(manual.status).toBe(200);
    expect(runs().at(-1)).toBe('manual');
  });

  it('"Run them here" takes them back, and that reaches the relay', async () => {
    const res = await takeOver();
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status.automations).toEqual({ owner: 'mac-a', isThisMac: true });
    expect((await worker.syncNow()).error).toBeUndefined();
    const last = relay.changes.filter((c) => c.entity === 'kv' && c.entity_id === 'automations.owner').at(-1)!;
    expect(last).toMatchObject({ machine_id: 'mac-a', data: { value: 'mac-a' } });
    expect(await automations.fireScheduled(nightly())).not.toBeNull();
  });

  it('two claims at once settle on the later one on both Macs', async () => {
    // mac-b claimed a moment after mac-a's claim above: later wins, so mac-b owns them.
    await fromB('mac-b', new Date(Date.now() + 5_000).toISOString());
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(r.db.kv.get('automations.owner')).toBe('mac-b');
    expect(await automations.fireScheduled(nightly())).toBeNull();
    await worker.syncNow();
    // An older claim from mac-b does not move it back (a stale one arriving late).
    r.db.kv.set('automations.owner', 'mac-a');
    await fromB('mac-b', '2000-01-01T00:00:00.000Z');
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(r.db.kv.get('automations.owner')).toBe('mac-a');
  });
});

describe('a Mac joining a relay that already has an owner', () => {
  it('keeps the owner it pulls and does not claim', async () => {
    await sync.setActiveWorker(null);
    // A fresh cursor and no owner here: as a second Mac's first sync sees it.
    r.db.db.prepare(`DELETE FROM kv WHERE key = 'automations.owner'`).run();
    r.db.db.prepare(`DELETE FROM sync_meta WHERE entity = 'kv' AND entity_id = 'automations.owner'`).run();
    r.db.kv.set('sync.cursor', 0);
    const joined = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(joined);
    expect((await joined.syncNow()).error).toBeUndefined();
    expect(r.db.kv.get('automations.owner')).toBe('mac-b');
    expect(r.db.outbox.pending(100, ['kv']).filter((row) => row.entity_id === 'automations.owner')).toEqual([]);
    await sync.setActiveWorker(null);
  });
});
