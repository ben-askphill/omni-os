import { describe, it, expect, beforeAll, vi } from 'vitest';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../server/sync/transport.ts';

// A data folder copied to another Mac carries this Mac's sync id with it, and each Mac skips the other's changes
// as its own. The folder also remembers which hardware armed it (kv sync.hardware_id, the IOPlatformUUID); a Mac
// that finds another hardware id there takes a new sync id and pulls the history again. OMNI_HARDWARE_ID plays
// the hardware. Two Macs in one process, one in-memory relay, db and sync only.

async function machine(name: string, hardware: string, dir = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`))) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = dir;
  process.env.OMNI_HARDWARE_ID = hardware;
  const db = await import('../server/db.ts');
  const sync = await import('../server/sync/worker.ts');
  const owner = await import('../server/sync/owner.ts');
  const hardwareMod = await import('../server/sync/hardware.ts');
  return { name, dir, db, sync, owner, hardware: hardwareMod, worker: null as unknown as ReturnType<typeof sync.createSyncWorker> };
}
type Mac = Awaited<ReturnType<typeof machine>>;

const relay = new MemoryTransport();
let a: Mac;
let b: Mac;

const sync = async (...macs: Mac[]) => {
  for (const m of macs) expect((await m.worker.syncNow()).error).toBeUndefined();
};
const thread = (id: string, title: string) => ({
  id, channel_id: 'inbox', title, status: 'done' as const, role: null, model: null, session_id: id, cwd: '/tmp',
  branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null,
});

beforeAll(async () => {
  a = await machine('mac-a', 'hw-a');
  a.worker = a.sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
  a.db.threads.create(thread('t-before', 'Made before the copy'));
  await sync(a);
});

describe('the first arm', () => {
  it('records the hardware it ran on', () => {
    expect(a.db.kv.get('sync.hardware_id')).toBe('hw-a');
    expect(a.db.kv.get('automations.owner')).toBe('mac-a');
  });

  it('a later start on the same hardware keeps the id', () => {
    const again = a.sync.createSyncWorker({ transport: relay });
    expect(again.machineId).toBe('mac-a');
  });

  it('an install armed before hardware ids just records its own', () => {
    a.db.db.prepare(`DELETE FROM kv WHERE key = 'sync.hardware_id'`).run();
    const again = a.sync.createSyncWorker({ transport: relay });
    expect(again.machineId).toBe('mac-a');
    expect(a.db.kv.get('sync.hardware_id')).toBe('hw-a');
  });
});

describe('a data folder copied to another Mac', () => {
  const warned: string[] = [];

  beforeAll(async () => {
    // Copy A's folder as it is on disk, the WAL folded in first, then keep working on A.
    a.db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const copy = mkdtempSync(join(tmpdir(), 'omni-sync-copy-'));
    cpSync(a.dir, copy, { recursive: true });
    a.db.threads.update('t-before', { title: 'Renamed on A after the copy' });
    b = await machine('mac-b', 'hw-b', copy);
    expect(b.db.outbox.machineId()).toBe('mac-a');
    const warn = vi.spyOn(console, 'warn').mockImplementation((line) => void warned.push(String(line)));
    b.worker = b.sync.createSyncWorker({ transport: relay });
    warn.mockRestore();
  });

  it('takes a new sync id, says so once, and starts the relay over', () => {
    expect(b.worker.machineId).not.toBe('mac-a');
    expect(b.db.outbox.machineId()).toBe(b.worker.machineId);
    expect(b.db.kv.get('sync.hardware_id')).toBe('hw-b');
    expect(b.db.kv.get('sync.cursor')).toBe(0);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/^\[sync\] this data folder was copied from another Mac/);
    // A second start on this Mac keeps the new id.
    expect(b.sync.createSyncWorker({ transport: relay }).machineId).toBe(b.worker.machineId);
  });

  it('leaves the scheduled automations with the Mac it was copied from', async () => {
    await sync(b);
    expect(b.db.kv.get('automations.owner')).toBe('mac-a');
    expect(b.owner.automationsOwner()).toEqual({ owner: 'mac-a', isThisMac: false });
  });

  it('gets what A did since, and its re-seeded copy never overwrites A', async () => {
    await sync(a, b);
    expect(b.db.threads.get('t-before')!.title).toBe('Renamed on A after the copy');
    expect(a.db.threads.get('t-before')!.title).toBe('Renamed on A after the copy');
    expect(a.db.kv.get('automations.owner')).toBe('mac-a');
  });

  it('then syncs both ways', async () => {
    b.db.threads.create(thread('t-on-b', 'Made on B'));
    a.db.threads.create(thread('t-on-a', 'Made on A'));
    await sync(b, a, b);
    expect(a.db.threads.get('t-on-b')?.title).toBe('Made on B');
    expect(b.db.threads.get('t-on-a')?.title).toBe('Made on A');
    b.db.threads.update('t-before', { title: 'Renamed on B' });
    await sync(b, a);
    expect(a.db.threads.get('t-before')!.title).toBe('Renamed on B');
  });
});

describe('reading the hardware id', () => {
  it('takes the IOPlatformUUID from ioreg', () => {
    const out = '+-o J316sAP  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformSerialNumber" = "X"\n      "IOPlatformUUID" = "3F2504E0-4F89-11D3-9A0C-0305E82C3301"\n    }\n';
    expect(a.hardware.parseIoreg(out)).toBe('3F2504E0-4F89-11D3-9A0C-0305E82C3301');
    expect(a.hardware.parseIoreg('nothing here')).toBeNull();
  });

  it('prefers OMNI_HARDWARE_ID', () => {
    process.env.OMNI_HARDWARE_ID = 'hw-z';
    expect(a.hardware.hardwareId()).toBe('hw-z');
  });
});
