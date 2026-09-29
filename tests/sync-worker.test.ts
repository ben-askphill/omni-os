import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport, type Change } from '../server/sync/transport.ts';
import { waitFor } from './support.ts';

// One machine against the in-memory relay. Remote changes are pushed straight into the relay as "mac-z".
let db: typeof import('../server/db.ts');
let sync: typeof import('../server/sync/worker.ts');
let apply: typeof import('../server/sync/apply.ts');
let api: typeof import('../server/sync-api.ts');

const relay = new MemoryTransport();
let worker: ReturnType<typeof sync.createSyncWorker>;

const remoteThread = (id: string, ts: string, patch: Record<string, unknown> = {}, machine = 'mac-z'): Change => ({
  machine_id: machine, entity: 'thread', entity_id: id, op: 'upsert', ts,
  data: {
    id, channel_id: 'inbox', title: `remote ${id}`, status: 'done', role: null, model: null, harness: 'claude-code', effort: '',
    session_id: id, has_run: 1, cwd: '~/x', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    last_text: null, created_at: ts, updated_at: ts, ...patch,
  },
});
const remoteEvent = (uid: string, threadId: string, text: string): Change => ({
  machine_id: 'mac-z', entity: 'event', entity_id: uid, op: 'upsert', ts: '2020-01-01T10:00:00.000Z',
  data: { uid, thread_id: threadId, kind: 'user', payload: { text }, created_at: '2020-01-01T10:00:00.000Z' },
});

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-sync-worker-'));
  db = await import('../server/db.ts');
  sync = await import('../server/sync/worker.ts');
  apply = await import('../server/sync/apply.ts');
  api = await import('../server/sync-api.ts');
});

describe('sync api with sync off', () => {
  it('reports sync as not configured and refuses a sync now', async () => {
    const status = await api.syncApi.request('/status');
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ configured: false, running: false, machineId: null });
    const now = await api.syncApi.request('/now', { method: 'POST' });
    expect(now.status).toBe(409);
    expect(await now.json()).toEqual({ error: 'sync is not configured' });
  });

  it('never arms the outbox on its own', () => {
    expect(db.outbox.machineId()).toBeNull();
  });
});

describe('sync worker', () => {
  beforeAll(() => {
    worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a', batchSize: 3 });
    sync.setActiveWorker(worker);
  });

  it('backs off exponentially after failures, up to a cap', () => {
    expect(sync.backoffMs(1)).toBe(5_000);
    expect(sync.backoffMs(2)).toBe(10_000);
    expect(sync.backoffMs(4)).toBe(40_000);
    expect(sync.backoffMs(50)).toBe(15 * 60_000);
  });

  it('pushes the outbox in batches and pulls in batches', async () => {
    db.threads.create({ id: 'l1', channel_id: 'inbox', title: 'local', status: 'done', role: null, model: null, session_id: 'l1', cwd: '/tmp', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null });
    for (let i = 0; i < 5; i++) db.events.add('l1', 'user', { text: `m${i}` });
    await relay.push(['r1', 'r2', 'r3', 'r4'].map((id) => remoteThread(id, '2020-01-01T09:00:00.000Z')));
    const r = await worker.syncNow();
    expect(r.error).toBeUndefined();
    const mine = relay.pushCalls.filter((c) => c[0].machine_id === 'mac-a');
    expect(mine.map((c) => c.length)).toEqual([3, 3, 2]); // the two seeded channels, the thread and five events
    expect(r.pulled).toBe(4);
    expect(db.threads.get('r4')?.title).toBe('remote r4');
    expect(db.kv.get<number>('sync.cursor')).toBe(relay.changes.filter((c) => c.machine_id === 'mac-z').at(-1)!.seq);
    expect(worker.status()).toMatchObject({ configured: true, pending: 0, failures: 0, lastError: null, machineId: 'mac-a' });
  });

  it('coalesces repeated writes to one thread into one change with the latest data', async () => {
    const n = relay.changes.length;
    db.threads.update('l1', { title: 'one' });
    db.threads.update('l1', { title: 'two' });
    await worker.syncNow();
    const mine = relay.changes.slice(n);
    expect(mine).toHaveLength(1);
    expect((mine[0].data as any).title).toBe('two');
  });

  it('joins a sync already running instead of starting a second one', async () => {
    const pulls = relay.pullCalls;
    const [x, y] = await Promise.all([worker.syncNow(), worker.syncNow()]);
    expect(x.error).toBeUndefined();
    expect(y.error).toBeUndefined();
    expect(relay.pullCalls - pulls).toBeLessThanOrEqual(2);
  });

  it('keeps the outbox and records the error when the relay is down, then recovers', async () => {
    db.threads.update('l1', { title: 'offline edit' });
    relay.failNext(1, 'relay unreachable');
    const r = await worker.syncNow();
    expect(r.error).toBe('relay unreachable');
    expect(worker.status()).toMatchObject({ failures: 1, lastError: 'relay unreachable', pending: 1 });
    const ok = await worker.syncNow();
    expect(ok.error).toBeUndefined();
    expect(worker.status()).toMatchObject({ failures: 0, lastError: null, pending: 0 });
    expect((relay.changes.at(-1)!.data as any).title).toBe('offline edit');
  });

  it('defers an event whose thread has not arrived, and applies it once the thread does', async () => {
    await relay.push([remoteEvent('e-late', 'r-late', 'early bird')]);
    await worker.syncNow();
    expect(worker.status().deferred).toBe(1);
    await relay.push([remoteThread('r-late', '2020-01-01T10:00:00.000Z')]);
    await worker.syncNow();
    expect(worker.status().deferred).toBe(0);
    expect(db.events.since('r-late').map((e) => JSON.parse(e.payload).text)).toEqual(['early bird']);
  });

  it('holds changes for an entity with no handler yet, without blocking the rest', async () => {
    const channel = apply.getHandler('channel')!;
    apply.unregisterHandler('channel');
    db.channels.create({ id: 'held', name: 'Held' });
    db.threads.update('l1', { title: 'after held' });
    await worker.syncNow();
    expect(relay.changes.some((c) => c.entity === 'channel' && c.entity_id === 'held')).toBe(false);
    expect((relay.changes.at(-1)!.data as any).title).toBe('after held');
    expect(worker.status()).toMatchObject({ pending: 0, held: 1 });
    // A handler registered later picks them up.
    apply.registerHandler('channel', channel);
    await worker.syncNow();
    expect(relay.changes.at(-1)).toMatchObject({ entity: 'channel', entity_id: 'held', data: { name: 'Held' } });
    expect(worker.status().held).toBe(0);
  });

  it('last writer wins by timestamp, then by machine id', () => {
    const ctx = { machineId: 'mac-a' };
    expect(apply.applyChange({ ...remoteThread('lww', '2020-01-01T11:00:00.000Z', { title: 'first' }), seq: 1001 }, ctx)).toBe('applied');
    expect(apply.applyChange({ ...remoteThread('lww', '2020-01-01T10:00:00.000Z', { title: 'older' }), seq: 1002 }, ctx)).toBe('skipped');
    expect(db.threads.get('lww')!.title).toBe('first');
    expect(apply.applyChange({ ...remoteThread('lww', '2020-01-01T11:00:00.000Z', { title: 'tie, lower id' }, 'mac-0'), seq: 1003 }, ctx)).toBe('skipped');
    expect(apply.applyChange({ ...remoteThread('lww', '2020-01-01T11:00:00.000Z', { title: 'tie, higher id' }, 'mac-zz'), seq: 1004 }, ctx)).toBe('applied');
    expect(db.threads.get('lww')!.title).toBe('tie, higher id');
    // A local write after that is newer than all of them.
    db.threads.update('lww', { title: 'local' });
    expect(apply.applyChange({ ...remoteThread('lww', '2020-01-01T12:00:00.000Z', { title: 'stale' }), seq: 1005 }, ctx)).toBe('skipped');
  });

  it('syncs on its timer and when the relay says another machine pushed', async () => {
    const timed = sync.createSyncWorker({ transport: relay, machineId: 'mac-a', intervalMs: 30 });
    timed.start();
    try {
      const pulls = relay.pullCalls;
      await waitFor(() => relay.pullCalls >= pulls + 3, 'timer syncs');
      await relay.push([remoteThread('rt', '2020-01-01T13:00:00.000Z')]);
      await waitFor(() => db.threads.get('rt'), 'realtime sync');
    } finally {
      timed.stop();
    }
    const after = relay.pullCalls;
    await new Promise((r) => setTimeout(r, 100));
    expect(relay.pullCalls).toBe(after);
  });

  it('serves status and sync now once a worker is active', async () => {
    const res = await api.syncApi.request('/now', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ pushed: expect.any(Number), pulled: expect.any(Number), status: { configured: true, machineId: 'mac-a' } });
    const status = await (await api.syncApi.request('/status')).json();
    expect(status).toMatchObject({ configured: true, enabled: true, machineId: 'mac-a', lastSyncAt: expect.any(String) });
  });

  it('module syncNow triggers the active worker', async () => {
    const spy = vi.spyOn(worker, 'syncNow');
    await sync.syncNow();
    expect(spy).toHaveBeenCalledOnce();
  });
});
