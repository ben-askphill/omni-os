import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';

// Pinned threads between two Macs in one process, each with its own data dir, through one in-memory relay.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../db.ts');
  const sync = await import('../sync/worker.ts');
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, worker };
}

const relay = new MemoryTransport();
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;
const home = homedir();

async function exchange() {
  for (const m of [a, b, a]) expect((await m.worker.syncNow()).error).toBeUndefined();
}

const thread = (id: string) => ({
  id, channel_id: 'volero', title: id, status: 'done' as const, role: null, model: null, session_id: id,
  cwd: join(home, 'work', 'volero'), branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null,
});
const pinnedOn = (m: typeof a) => m.db.threads.pinned().map((t) => t.id);

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: join(home, 'work') });
  a.db.threads.create(thread('t-1'));
  a.db.threads.create(thread('t-2'));
  await exchange();
});

describe('pins', () => {
  it('a thread pinned on A is pinned on B, in the same order, and unpinning travels back', async () => {
    a.db.threads.setPinned('t-1', true);
    await new Promise((done) => setTimeout(done, 5));
    a.db.threads.setPinned('t-2', true);
    await exchange();
    expect(pinnedOn(b)).toEqual(['t-2', 't-1']);
    expect(b.db.threads.get('t-1')!.pinned_at).toBe(a.db.threads.get('t-1')!.pinned_at);

    b.db.threads.setPinned('t-2', false);
    await exchange();
    expect(pinnedOn(a)).toEqual(['t-1']);
  });

  it('a change from a Mac on an older build, without pinned_at, keeps the pin', async () => {
    const { pinned_at: _drop, ...row } = relay.changes.findLast((c) => c.entity === 'thread' && c.entity_id === 't-1')!.data as any;
    await relay.push([{ machine_id: 'mac-old', entity: 'thread', entity_id: 't-1', op: 'upsert', ts: new Date(Date.now() + 1000).toISOString(), data: { ...row, title: 'from an old Mac' } }]);
    await exchange();
    expect(b.db.threads.get('t-1')).toMatchObject({ title: 'from an old Mac', pinned_at: expect.any(String) });
    expect(pinnedOn(b)).toEqual(['t-1']);
  });
});
