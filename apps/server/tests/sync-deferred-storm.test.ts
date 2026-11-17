import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import type { SyncEntity } from '../db.ts';

// A deferred change that can never apply (an event whose thread is not on this machine) must not cost a disk commit on
// every sync, nor a try on every sync forever. On 2026-11-16 the live server held 624 such changes from older builds,
// retried each one every sync and logged each retry in sync_refused: about 137 fsynced commits a second.

let db: typeof import('../db.ts');
let sync: typeof import('../sync/worker.ts');
let apply: typeof import('../sync/apply.ts');
let walPath: string;

const relay = new MemoryTransport();
let worker: ReturnType<typeof sync.createSyncWorker>;

const OLD = '2020-01-01T10:00:00.000Z';
/** An event from an older build (unsigned). */
const remoteEvent = (uid: string, threadId = 'never-here', machine = 'mac-old'): Change => ({
  machine_id: machine, entity: 'event', entity_id: uid, op: 'upsert', ts: OLD,
  data: { uid, thread_id: threadId, kind: 'user', payload: { text: uid }, created_at: OLD },
});
const remoteThread = (id: string, channel = 'inbox'): Change => ({
  machine_id: 'mac-old', entity: 'thread', entity_id: id, op: 'upsert', ts: OLD,
  data: {
    id, channel_id: channel, title: `remote ${id}`, status: 'done', role: null, model: null, harness: 'claude-code', effort: '',
    session_id: id, has_run: 1, cwd: '~/x', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    last_text: null, created_at: OLD, updated_at: OLD,
  },
});
const remoteChannel = (id: string): Change => ({
  machine_id: 'mac-old', entity: 'channel', entity_id: id, op: 'upsert', ts: OLD, data: { id, name: id, created_at: OLD },
});

/**
 * Commits in the WAL so far, read from the file itself: a frame whose header carries the database size ends a
 * transaction. Frames left over from before the WAL last restarted carry old salts and are not counted.
 */
function walCommits(): number {
  const wal = readFileSync(walPath);
  if (wal.length < 32) return 0;
  const pageSize = wal.readUInt32BE(8);
  const salt1 = wal.readUInt32BE(16);
  const salt2 = wal.readUInt32BE(20);
  let commits = 0;
  for (let at = 32; at + 24 + pageSize <= wal.length; at += 24 + pageSize) {
    if (wal.readUInt32BE(at + 8) !== salt1 || wal.readUInt32BE(at + 12) !== salt2) break;
    if (wal.readUInt32BE(at + 4) !== 0) commits++;
  }
  return commits;
}

const syncOk = async () => expect((await worker.syncNow()).error).toBeUndefined();

/** Commits each of `cycles` syncs makes with nothing new on the relay. */
async function commitsPerIdleSync(cycles: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < cycles; i++) {
    const before = walCommits();
    await syncOk();
    out.push(walCommits() - before);
  }
  return out;
}

const refusedCount = (machine: string, entity: string) =>
  (db.db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM sync_refused WHERE machine = ? AND entity = ?').get(machine, entity) as { n: number }).n;
const isDeferred = (id: string) => apply.deferredChanges().some((c) => c.entity_id === id);
const eventTexts = (threadId: string) => db.events.since(threadId).map((e) => JSON.parse(e.payload).text as string);

/** How many times each handler was asked to apply a change, by entity id. */
const tries = new Map<string, number>();
function countTries(entity: SyncEntity) {
  const h = apply.getHandler(entity)!;
  apply.registerHandler(entity, { ...h, apply: (c, ctx) => (tries.set(c.entity_id, (tries.get(c.entity_id) ?? 0) + 1), h.apply(c, ctx)) });
}
/** Tries of `id` in one sync at `at`. */
async function triesAt(at: number, id: string): Promise<number> {
  vi.setSystemTime(at);
  const before = tries.get(id) ?? 0;
  await syncOk();
  return (tries.get(id) ?? 0) - before;
}

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-sync-storm-'));
  db = await import('../db.ts');
  sync = await import('../sync/worker.ts');
  apply = await import('../sync/apply.ts');
  const { paths } = await import('../config.ts');
  walPath = `${paths.db}-wal`;
  // Keep every frame in the WAL, so walCommits sees them all.
  db.db.exec('PRAGMA wal_autocheckpoint = 0');
  worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
  await sync.setActiveWorker(worker);
  countTries('event');
  countTries('thread');
  // Settle the first sync's one-off writes (machine id, automations owner claim).
  await syncOk();
  await syncOk();
});

describe('a deferred change that never applies', () => {
  it('costs the same commits per sync whether 10 or 200 are stuck', async () => {
    await relay.push(Array.from({ length: 10 }, (_, i) => remoteEvent(`few-${i}`)));
    await syncOk();
    expect(apply.deferredCount()).toBe(10);
    const few = await commitsPerIdleSync(5);

    await relay.push(Array.from({ length: 190 }, (_, i) => remoteEvent(`many-${i}`, 'never-here', 'mac-older')));
    await syncOk();
    expect(apply.deferredCount()).toBe(200);
    const many = await commitsPerIdleSync(5);

    console.log(`[storm] commits per idle sync: 10 stuck ${JSON.stringify(few)}, 200 stuck ${JSON.stringify(many)}`);
    expect(many).toEqual(few);
    expect(Math.max(...many)).toBeLessThanOrEqual(2);
  });

  it('logs an unsigned change once, when it applies, not on every retry while it waits', async () => {
    await relay.push([remoteEvent('log-e', 'log-t', 'mac-log')]);
    await syncOk();
    await commitsPerIdleSync(3);
    expect(refusedCount('mac-log', 'event')).toBe(0);
    await relay.push([remoteThread('log-t')]);
    await syncOk();
    expect(eventTexts('log-t')).toEqual(['log-e']);
    expect(refusedCount('mac-log', 'event')).toBe(1);
  });
});

describe('the counts older builds inflated', () => {
  it('start over at one for applied rows, once, and leave refusals and held actions alone', async () => {
    const { migrate } = await import('../db/migrate.ts');
    const row = db.db.prepare(
      `INSERT INTO sync_refused (key, machine, entity, entity_id, reason, applied, count, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    row.run('inflated', 'mac-inflated', 'event', 'e-1', 'unsigned', 1, 12_345_678, OLD);
    row.run('held', 'mac-inflated', 'remote_command', 'cmd-1', 'waiting for Trust', 0, 3, OLD);
    const counts = () =>
      db.db.prepare(`SELECT key, count, at FROM sync_refused WHERE machine = 'mac-inflated' ORDER BY key`).all() as { key: string; count: number; at: string }[];
    // As an older build left it: the migration not run yet.
    db.db.prepare(`DELETE FROM kv WHERE key = 'sync.migrated.refused_retry_counts'`).run();
    migrate();
    expect(counts()).toEqual([
      { key: 'held', count: 3, at: OLD },
      { key: 'inflated', count: 1, at: OLD },
    ]);
    // Once only: what this build counts afterwards stays.
    db.db.prepare(`UPDATE sync_refused SET count = 4 WHERE key = 'inflated'`).run();
    migrate();
    expect(counts().find((r) => r.key === 'inflated')!.count).toBe(4);
  });
});

describe('a change whose thread is not here', () => {
  let t0: number;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    t0 = Date.now();
  });
  afterEach(() => vi.useRealTimers());
  const min = 60_000;

  it('is tried on every sync for ten minutes, then at most every tenth of its wait, and at least hourly', async () => {
    await relay.push([remoteEvent('slow-e')]);
    await triesAt(t0, 'slow-e');
    expect(await triesAt(t0 + 5 * min, 'slow-e')).toBe(1);
    expect(await triesAt(t0 + 5 * min + 1_000, 'slow-e')).toBe(1);
    // Ten minutes in: the next try waits a tenth of that.
    expect(await triesAt(t0 + 10 * min, 'slow-e')).toBe(1);
    expect(await triesAt(t0 + 10 * min + 30_000, 'slow-e')).toBe(0);
    expect(await triesAt(t0 + 11 * min, 'slow-e')).toBe(1);
    // A day in: a tenth would be over two hours, so it waits the hour.
    expect(await triesAt(t0 + 24 * 60 * min, 'slow-e')).toBe(1);
    expect(await triesAt(t0 + 24 * 60 * min + 59 * min, 'slow-e')).toBe(0);
    expect(await triesAt(t0 + 25 * 60 * min, 'slow-e')).toBe(1);
    expect(isDeferred('slow-e')).toBe(true);
  });

  it('lands within a tenth of its wait once its thread comes', async () => {
    await relay.push([remoteEvent('late-e', 'late-t')]);
    await triesAt(t0, 'late-e');
    await triesAt(t0 + 100 * min, 'late-e');
    vi.setSystemTime(t0 + 101 * min);
    await relay.push([remoteThread('late-t')]);
    await syncOk();
    expect(isDeferred('late-e')).toBe(true);
    vi.setSystemTime(t0 + 110 * min);
    await syncOk();
    expect(isDeferred('late-e')).toBe(false);
    expect(eventTexts('late-t')).toEqual(['late-e']);
  });

  it('is tried at once when a retry lands something it may wait for', async () => {
    await relay.push([remoteEvent('chain-e', 'chain-t')]);
    await triesAt(t0, 'chain-e');
    await triesAt(t0 + 100 * min, 'chain-e');
    // Its thread comes, but for a channel this machine does not have yet: the thread waits too.
    vi.setSystemTime(t0 + 101 * min);
    await relay.push([remoteThread('chain-t', 'chain-c')]);
    await syncOk();
    expect(isDeferred('chain-t')).toBe(true);
    // The channel lands, the retry lands the thread, and the event, backed off until t0 + 110 min, comes with it.
    vi.setSystemTime(t0 + 102 * min);
    await relay.push([remoteChannel('chain-c')]);
    await syncOk();
    expect(isDeferred('chain-t')).toBe(false);
    expect(eventTexts('chain-t')).toEqual(['chain-e']);
  });

  it('a change held before its handler runs (no handler here yet) is still tried on every sync', async () => {
    const kv = apply.getHandler('kv')!;
    apply.unregisterHandler('kv');
    try {
      await relay.push([{ machine_id: 'mac-old', entity: 'kv', entity_id: 'note.held', op: 'upsert', ts: OLD, data: { value: 'held' } }]);
      await syncOk();
      vi.setSystemTime(t0 + 5 * 60 * min);
      await syncOk();
      expect(isDeferred('note.held')).toBe(true);
    } finally {
      apply.registerHandler('kv', kv);
    }
    vi.setSystemTime(t0 + 5 * 60 * min + 1_000);
    await syncOk();
    expect(db.kv.get('note.held')).toBe('held');
  });

  // Last in the file: it leaves this machine on another relay.
  it('a change from a new relay starts over, even with the seq a backed-off change had on the old one', async () => {
    /** Move to another relay, as sync/setup.ts finishRelaySignIn does: the old sync ends, the cursor goes back and the parked changes go. */
    const moveTo = async (next: MemoryTransport) => {
      await sync.setActiveWorker(null);
      db.kv.set('sync.cursor', 0);
      db.db.exec('DELETE FROM sync_deferred');
      worker = sync.createSyncWorker({ transport: next, machineId: 'mac-a' });
      await sync.setActiveWorker(worker);
    };
    // Each relay numbers its changes from 1. Pushed before this machine's first sync with it, the orphan is seq 1.
    const relayA = new MemoryTransport();
    await relayA.push([remoteEvent('switch-a', 'switch-t')]);
    await moveTo(relayA);
    expect(await triesAt(t0, 'switch-a')).toBe(2);
    expect(await triesAt(t0 + 100 * min, 'switch-a')).toBe(1);
    expect(await triesAt(t0 + 100 * min + 1_000, 'switch-a')).toBe(0);

    const relayB = new MemoryTransport();
    await relayB.push([remoteEvent('switch-b', 'switch-t')]);
    await moveTo(relayB);
    await triesAt(t0 + 101 * min, 'switch-b');
    expect(apply.deferredChanges()).toEqual([expect.objectContaining({ entity_id: 'switch-b', seq: 1 })]);
    // A minute old: tried on every sync, not left waiting on the old change's backoff.
    expect(await triesAt(t0 + 101 * min + 1_000, 'switch-b')).toBe(1);
    expect(await triesAt(t0 + 102 * min, 'switch-b')).toBe(1);
  });
});
