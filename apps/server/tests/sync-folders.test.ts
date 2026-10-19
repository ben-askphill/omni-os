import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';

// Sidebar folders between two Macs in one process, each with its own data dir, through one in-memory relay:
// the folders themselves, which folder a thread sits in, and a relay set up before folders synced.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../db.ts');
  const { bus } = await import('../bus.ts');
  const sync = await import('../sync/worker.ts');
  const feed: any[] = [];
  bus.on('feed', (e) => feed.push(e));
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, feed, worker };
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
const folderOf = (m: typeof a, id: string) => m.db.threads.get(id)!.folder_id;
const names = (m: typeof a) => m.db.folders.byChannel('volero').map((f) => f.name);

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: join(home, 'work') });
  await exchange();
});

describe('folders', () => {
  it('a folder made on A, with a thread in it, shows on B the same way, and open sidebars hear about it', async () => {
    const f = a.db.folders.create({ channel_id: 'volero', name: 'Checkout' });
    a.db.threads.create(thread('t-1'));
    a.db.folders.moveThread('t-1', f.id);
    b.feed.length = 0;
    await exchange();
    expect(b.db.folders.get(f.id)).toMatchObject({ name: 'Checkout', channel_id: 'volero' });
    expect(folderOf(b, 't-1')).toBe(f.id);
    expect(b.feed).toContainEqual({ type: 'channel', id: 'volero' });
  });

  it('renames and the manual order travel both ways', async () => {
    const [checkout] = a.db.folders.byChannel('volero');
    a.db.folders.create({ channel_id: 'volero', name: 'Admin' });
    await exchange();
    b.db.folders.rename(checkout!.id, 'Cart & checkout');
    await exchange();
    expect(names(a)).toEqual(['Admin', 'Cart & checkout']);
    a.db.folders.reorder('volero', a.db.folders.byChannel('volero').map((f) => f.id).reverse());
    await exchange();
    expect(names(b)).toEqual(['Cart & checkout', 'Admin']);
  });

  it('moving a thread out on B moves it out on A', async () => {
    b.db.folders.moveThread('t-1', null);
    await exchange();
    expect(folderOf(a, 't-1')).toBeNull();
  });

  it("collapsing is each Mac's own view", async () => {
    const [f] = a.db.folders.byChannel('volero');
    a.db.folders.setCollapsed(f!.id, true);
    b.db.folders.rename(f!.id, 'Renamed on B');
    await exchange();
    expect(b.db.folders.get(f!.id)).toMatchObject({ collapsed: 0 });
    expect(a.db.folders.get(f!.id)).toMatchObject({ collapsed: 1, name: 'Renamed on B' });
  });

  it('deleting a folder on A deletes it on B and puts its threads back in the ungrouped list', async () => {
    const f = a.db.folders.create({ channel_id: 'volero', name: 'Doomed' });
    a.db.threads.create(thread('t-2'));
    a.db.folders.moveThread('t-2', f.id);
    await exchange();
    expect(folderOf(b, 't-2')).toBe(f.id);
    a.db.folders.remove(f.id);
    await exchange();
    expect(b.db.folders.get(f.id)).toBeUndefined();
    expect(folderOf(b, 't-2')).toBeNull();
  });

  it('a change from a Mac on an older build, without folder_id, keeps the folder the thread sits in', async () => {
    const f = a.db.folders.create({ channel_id: 'volero', name: 'Kept' });
    a.db.folders.moveThread('t-1', f.id);
    await exchange();
    const { folder_id: _drop, ...row } = relay.changes.findLast((c) => c.entity === 'thread' && c.entity_id === 't-1')!.data as any;
    await relay.push([{ machine_id: 'mac-old', entity: 'thread', entity_id: 't-1', op: 'upsert', ts: new Date(Date.now() + 1000).toISOString(), data: { ...row, title: 'from an old Mac' } }]);
    await exchange();
    expect(b.db.threads.get('t-1')).toMatchObject({ title: 'from an old Mac', folder_id: f.id });
  });
});

describe('a relay set up before folders synced', () => {
  it('holds the folders and syncs the rest, then files the threads once the relay takes folders', async () => {
    relay.refuse.add('folder');
    const f = a.db.folders.create({ channel_id: 'volero', name: 'Later' });
    a.db.threads.create(thread('t-3'));
    a.db.folders.moveThread('t-3', f.id);
    await exchange();
    expect(a.worker.status()).toMatchObject({ refused: ['folder'], held: 1 });
    // The thread came, its folder did not: B shows it ungrouped for now, and sends it on with the folder it waits for.
    expect(folderOf(b, 't-3')).toBeNull();
    b.db.threads.update('t-3', { title: 'renamed while waiting' });
    await exchange();
    expect(folderOf(a, 't-3')).toBe(f.id);

    relay.refuse.clear();
    await exchange();
    expect(a.worker.status()).toMatchObject({ refused: [], held: 0 });
    expect(b.db.folders.get(f.id)).toMatchObject({ name: 'Later' });
    expect(folderOf(b, 't-3')).toBe(f.id);
  });

  it('a Mac that synced before this build sends its folders and the threads in them once', async () => {
    // As an older build left it: a folder and a filed thread that were never queued.
    a.db.db.prepare(`INSERT INTO folders (id, channel_id, name) VALUES ('f-old', 'volero', 'From before')`).run();
    a.db.threads.create(thread('t-old'));
    await exchange();
    a.db.db.prepare(`UPDATE threads SET folder_id = 'f-old' WHERE id = 't-old'`).run();
    a.db.db.prepare(`DELETE FROM kv WHERE key = 'sync.folders_seeded'`).run();
    a.db.outbox.arm();
    a.db.outbox.arm();
    await exchange();
    expect(b.db.folders.get('f-old')).toMatchObject({ name: 'From before' });
    expect(folderOf(b, 't-old')).toBe('f-old');
    expect(relay.changes.filter((c) => c.entity === 'folder' && c.entity_id === 'f-old')).toHaveLength(1);
  });
});
