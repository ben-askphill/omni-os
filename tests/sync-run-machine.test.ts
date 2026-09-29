import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../server/sync/transport.ts';

// Which Mac runs a thread: the row says so itself (run_machine), so an edit from the other Mac, which carries
// the whole row back with a newer ts, never makes the running Mac think the run is elsewhere, and the other Mac
// is free again once the run ends there. Two Macs in one process, one in-memory relay, db and sync only.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../server/db.ts');
  const sync = await import('../server/sync/worker.ts');
  const guard = await import('../server/sync/guard.ts');
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, guard, worker };
}
type Mac = Awaited<ReturnType<typeof machine>>;

const relay = new MemoryTransport();
let a: Mac;
let b: Mac;

const sync = async (...macs: Mac[]) => {
  for (const m of macs) expect((await m.worker.syncNow()).error).toBeUndefined();
};
const thread = (id: string) => ({
  id, channel_id: 'inbox', title: 'Cart drawer', status: 'done' as const, role: null, model: null, session_id: id, cwd: '/tmp',
  branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null,
});
const elsewhere = (m: Mac, id: string) => m.guard.runningElsewhere(m.db.threads.get(id)!);

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
});

// Both ways round: mac-b sorts after mac-a, so a tie would go to it, and the fix must not lean on that.
for (const [runs, edits] of [['a', 'b'], ['b', 'a']] as const) {
  describe(`mac-${runs} runs the thread, mac-${edits} renames it mid-run`, () => {
    const id = `t-${runs}`;
    const mac = (k: 'a' | 'b') => (k === 'a' ? a : b);

    it('the running Mac keeps running it, takes the new title, and is not blocked', async () => {
      const r = mac(runs);
      const e = mac(edits);
      r.db.threads.create(thread(id));
      r.db.threads.update(id, { status: 'running' });
      await sync(r, e);
      expect(e.db.threads.get(id)!.status).toBe('running');
      expect(elsewhere(e, id)).toBe(true);
      expect(elsewhere(r, id)).toBe(false);

      e.db.threads.update(id, { title: 'Cart drawer flicker' });
      await sync(e, r);
      expect(r.db.threads.get(id)).toMatchObject({ title: 'Cart drawer flicker', status: 'running' });
      expect(elsewhere(r, id)).toBe(false);
      expect(elsewhere(e, id)).toBe(true);
    });

    it('the run ending there frees it on the other Mac', async () => {
      const r = mac(runs);
      const e = mac(edits);
      r.db.threads.update(id, { status: 'done' });
      await sync(r, e);
      expect(e.db.threads.get(id)).toMatchObject({ title: 'Cart drawer flicker', status: 'done' });
      expect(elsewhere(e, id)).toBe(false);
    });
  });
}

describe('a rename that crosses the end of the run', () => {
  it('still frees the thread on both Macs', async () => {
    a.db.threads.create(thread('t-cross'));
    a.db.threads.update('t-cross', { status: 'running' });
    await sync(a, b);
    // A finishes and pushes; B renames before it has pulled that, so its rename is newer and still says running.
    a.db.threads.update('t-cross', { status: 'done' });
    await sync(a);
    b.db.threads.update('t-cross', { title: 'Renamed late' });
    // A keeps its own status over B's and queues the row again; its next push takes it to B.
    await sync(b, a);
    expect(b.db.threads.get('t-cross')!.status).toBe('running');
    await sync(a, b);
    for (const m of [a, b]) {
      expect(m.db.threads.get('t-cross')).toMatchObject({ title: 'Renamed late', status: 'done' });
      expect(elsewhere(m, 't-cross')).toBe(false);
    }
  });
});

describe('a crash mid-run, after the other Mac renamed it', () => {
  it('the Mac that ran it fails it on restart; the other leaves it alone, then sees it failed', async () => {
    a.db.threads.create(thread('t-crash'));
    a.db.threads.update('t-crash', { status: 'running' });
    await sync(a, b);
    b.db.threads.update('t-crash', { title: 'Renamed mid-run' });
    await sync(b, a);
    expect(b.db.threads.failInterrupted()).toBe(0);
    expect(a.db.threads.failInterrupted()).toBe(1);
    expect(a.db.threads.get('t-crash')).toMatchObject({ title: 'Renamed mid-run', status: 'failed' });
    await sync(a, b);
    expect(b.db.threads.get('t-crash')!.status).toBe('failed');
    expect(elsewhere(b, 't-crash')).toBe(false);
  });

  it('a thread no Mac claims (sync never set up when it ran) is failed on restart', async () => {
    a.db.threads.create(thread('t-unclaimed'));
    a.db.db.prepare(`UPDATE threads SET status = 'running', run_machine = NULL WHERE id = 't-unclaimed'`).run();
    expect(elsewhere(a, 't-unclaimed')).toBe(false);
    expect(a.db.threads.failInterrupted()).toBe(1);
  });
});

describe('the API', () => {
  it('keeps run_machine out of the thread rows it reads', () => {
    a.db.threads.create(thread('t-api'));
    a.db.threads.update('t-api', { status: 'running' });
    expect(a.db.threads.get('t-api')).not.toHaveProperty('run_machine');
    expect(a.db.threads.runMachine('t-api')).toBe('mac-a');
    a.db.threads.update('t-api', { status: 'stopped' });
    expect(a.db.threads.runMachine('t-api')).toBeNull();
  });
});
