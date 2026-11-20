import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCollisions } from '@omni/shared/collisions.ts';
import { MemoryTransport } from '../sync/transport.ts';

// Collisions travel with the thread (ADR 0019): a flag raised on the Mac that runs a group thread, and its clearing,
// are rows of the thread's transcript, so the other Mac shows the same flags, and a dismissal there comes back.

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

const open = (m: typeof a) => openCollisions(m.db.events.collisions('t-1')).map((c) => [c.path, c.agents]);

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: join(home, 'work') });
  a.db.threads.create({
    id: 't-1', channel_id: 'volero', title: 't-1', status: 'done', role: 'builder', model: null, session_id: 't-1',
    cwd: join(home, 'work', 'volero'), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
  await exchange();
});

describe('collisions', () => {
  it('a flag raised on A shows on B, and B dismissing it clears it on A', async () => {
    a.db.events.add('t-1', 'collision', { key: 'k-1', path: 'src/cart.ts', agents: ['builder', 'designer'], head: 'abc' });
    await exchange();
    expect(open(b)).toEqual([['src/cart.ts', ['builder', 'designer']]]);
    // Dismissed on B, by the flag's key, which is the same on both Macs (row ids are each machine's own).
    const [flag] = openCollisions(b.db.events.collisions('t-1'));
    b.db.events.add('t-1', 'collision_cleared', { keys: [flag.key], by: 'dismiss' });
    await exchange();
    expect(open(b)).toEqual([]);
    expect(open(a)).toEqual([]);
  });
});
