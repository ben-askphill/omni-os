import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';

// Needs you between two Macs in one process, each with its own data dir, through one in-memory relay
// (apps/server/sync/handlers/needs-you.ts). A result is written once, by the Mac that ran the turn, and keeps its uid
// and place (n) on the other. A read moves a thread's watermark to the newest result read on either Mac, in any
// arrival order, and never touches the thread row. Not syncing stands in for a Mac that is offline.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../db.ts');
  const { bus } = await import('../bus.ts');
  const sync = await import('../sync/worker.ts');
  const feed: any[] = [];
  bus.on('feed', (e) => feed.push(e));
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  const signKey = await (await import('../sync/sign-key.ts')).signPublicKey();
  return { name, db, feed, worker, signKey };
}
type Mac = Awaited<ReturnType<typeof machine>>;

const relay = new MemoryTransport();
let a: Mac;
let b: Mac;

async function syncs(...macs: Mac[]) {
  for (const m of macs) expect((await m.worker.syncNow()).error).toBeUndefined();
}
const exchange = () => syncs(a, b, a);

const home = homedir();
/** A thread on `m`, mid-run there. */
function started(m: Mac, id: string) {
  m.db.threads.create({
    id, channel_id: 'volero', title: id, status: 'running', role: null, model: null, session_id: id,
    cwd: join(home, 'work', 'volero'), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
}
/** A turn of the thread runs on `m` and ends: its result. */
function turn(m: Mac, id: string) {
  if (m.db.threads.get(id)!.status !== 'running') m.db.threads.update(id, { status: 'running' });
  m.db.threads.update(id, { status: 'done' });
  return m.db.completions.latest(id)!;
}
/** The unread result Needs you lists for the thread on `m`, or null. */
const unread = (m: Mac, id: string) => m.db.needsYou().items.find((i) => i.thread.id === id)?.result?.uid ?? null;
const results = (m: Mac, id: string) => m.db.completions.forThread(id).map(({ seq: _, ...c }) => c);
const watermark = (m: Mac, id: string) => m.db.resultReads.get(id)?.uid ?? null;
/** What a read must never change: the thread row, who runs it, and its place in the lists. */
const row = (m: Mac, id: string) => ({ ...m.db.threads.get(id)!, run_machine: m.db.threads.runMachine(id) });

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: join(home, 'work') });
  await exchange();
});

describe('one result on both Macs', () => {
  it('reaches B as the same row, written once, and reading it on A clears it on B', async () => {
    started(a, 't-1');
    await exchange();
    const c = turn(a, 't-1');
    b.feed.length = 0;
    await exchange();
    // B took A's result, with its uid and place, and wrote none of its own for the status it applied.
    expect(results(b, 't-1')).toEqual(results(a, 't-1'));
    expect(results(b, 't-1')).toHaveLength(1);
    expect(unread(b, 't-1')).toBe(c.uid);
    expect(b.feed).toContainEqual({ type: 'needs_you', thread_id: 't-1' });

    const before = row(b, 't-1');
    b.feed.length = 0;
    a.db.resultReads.read(c.uid);
    await exchange();
    expect(unread(b, 't-1')).toBeNull();
    expect(b.db.resultReads.get('t-1')).toMatchObject({ uid: c.uid, n: 1 });
    // Open clients on B load their inbox again; the thread itself did not change.
    expect(b.feed).toEqual([{ type: 'needs_you', thread_id: 't-1' }]);
    expect(row(b, 't-1')).toEqual(before);
  });

  it('a turn B runs next continues the order, and reading it on B clears it on A', async () => {
    const c = turn(b, 't-1');
    expect(c.n).toBe(2);
    await exchange();
    expect(results(a, 't-1')).toEqual(results(b, 't-1'));
    expect(unread(a, 't-1')).toBe(c.uid);
    b.db.resultReads.read(c.uid);
    await exchange();
    expect(unread(a, 't-1')).toBeNull();
    expect(watermark(a, 't-1')).toBe(c.uid);
  });
});

describe('arrival order', () => {
  it('a read that arrives before its result: the result lands already read', async () => {
    started(a, 't-2');
    await exchange();
    const c = turn(a, 't-2');
    a.db.resultReads.read(c.uid);
    // The read goes out ahead of the result it names.
    a.db.db.prepare(`UPDATE sync_outbox SET id = id + 1000 WHERE entity = 'completion'`).run();
    const pulled = relay.changes.length;
    await exchange();
    const order = relay.changes.slice(pulled).map((ch) => ch.entity);
    expect(order.indexOf('result_read')).toBeLessThan(order.indexOf('completion'));
    expect(b.worker.status().deferred).toBe(0);
    expect(results(b, 't-2')).toEqual(results(a, 't-2'));
    expect(watermark(b, 't-2')).toBe(c.uid);
    expect(unread(b, 't-2')).toBeNull();
  });

  for (const first of ['reader', 'runner'] as const) {
    it(`a turn that ends while the read of the one before is on its way stays unread on both (${first} syncs first)`, async () => {
      const id = `t-3-${first}`;
      started(a, id);
      await exchange();
      const one = turn(a, id);
      await exchange();
      // B reads the first result while A's next turn ends, neither having heard from the other.
      b.db.resultReads.read(one.uid);
      const two = turn(a, id);
      await (first === 'reader' ? syncs(b, a, b) : syncs(a, b, a));
      for (const m of [a, b]) {
        expect(watermark(m, id)).toBe(one.uid);
        expect(unread(m, id)).toBe(two.uid);
      }
    });
  }

  it('a late older read never moves the watermark back, or reads a newer result', async () => {
    started(a, 't-4');
    await exchange();
    const one = turn(a, 't-4');
    await exchange();
    const staleRead = { n: one.n, uid: one.uid, read_at: new Date().toISOString() };
    const two = turn(a, 't-4');
    a.db.resultReads.read(two.uid);
    await exchange();
    expect(unread(b, 't-4')).toBeNull();
    // The read of the first result, held up somewhere, arrives last and stamped later than any write.
    await relay.push([
      { machine_id: 'mac-old', entity: 'result_read', entity_id: 't-4', op: 'upsert', ts: new Date(Date.now() + 60_000).toISOString(), data: staleRead },
    ]);
    b.feed.length = 0;
    await exchange();
    for (const m of [a, b]) {
      expect(watermark(m, 't-4')).toBe(two.uid);
      expect(unread(m, 't-4')).toBeNull();
    }
    // Nothing moved, so open clients have nothing to load.
    expect(b.feed).toEqual([]);
  });
});

describe('offline', () => {
  it('reads made on both Macs while apart converge on the newest, and never touch the thread rows', async () => {
    started(a, 't-5');
    await exchange();
    const one = turn(a, 't-5');
    const two = turn(a, 't-5');
    await exchange();
    expect(unread(b, 't-5')).toBe(two.uid);
    // A starts another turn, and B hears of it.
    a.db.threads.update('t-5', { status: 'running' });
    await exchange();
    const rowA = row(a, 't-5');
    const rowB = row(b, 't-5');
    expect(rowA).toMatchObject({ status: 'running', run_machine: 'mac-a' });
    expect(rowB).toEqual(rowA);
    // Apart: A reads the newer result, B only the older one. Then they meet.
    a.db.resultReads.read(two.uid);
    b.db.resultReads.read(one.uid);
    await exchange();
    for (const m of [a, b]) {
      expect(watermark(m, 't-5')).toBe(two.uid);
      expect(unread(m, 't-5')).toBeNull();
    }
    // Neither read changed who runs the thread, its status or when it last moved, on either Mac.
    expect(row(a, 't-5')).toEqual(rowA);
    expect(row(b, 't-5')).toEqual(rowB);
  });
});

describe('a question an agent asked', () => {
  const Q = { question: 'Which goal comes first?', options: [{ label: 'Acne POC', description: '' }, { label: 'KE go-live', description: '' }], multiSelect: false };
  const asked = (m: Mac) => m.db.needsYou().items.find((i) => i.thread.id === 't-q')?.blockers ?? [];

  it('waits in Needs you on both Macs, and an answer on either clears it on both', async () => {
    started(a, 't-q');
    await exchange();
    a.db.events.add('t-q', 'question', { id: 'q-1', questions: [Q] });
    b.feed.length = 0;
    await exchange();
    expect(asked(b)).toEqual([{ kind: 'question', detail: 'Which goal comes first?', count: 1 }]);
    expect(b.feed).toContainEqual({ type: 'needs_you', thread_id: 't-q' });

    b.db.events.add('t-q', 'question_answer', { id: 'q-1', state: 'answered', answers: [{ selected: ['KE go-live'], other: null }], via: 'tool' });
    a.feed.length = 0;
    await exchange();
    expect(asked(a)).toEqual([]);
    expect(asked(b)).toEqual([]);
    expect(a.feed).toContainEqual({ type: 'needs_you', thread_id: 't-q' });
  });
});
