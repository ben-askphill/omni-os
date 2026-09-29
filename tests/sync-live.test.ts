import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport, type Change } from '../server/sync/transport.ts';
import { addressKey, watchNetwork } from '../server/sync/network.ts';
import { waitFor, sleep } from './support.ts';

// What makes sync automatic: the boot sync, the Realtime nudge (the fake relay emits it), the link coming
// back after a drop, the network coming back, and the 60s timer behind all of them.
let db: typeof import('../server/db.ts');
let sync: typeof import('../server/sync/worker.ts');

const remoteThread = (id: string, ts = '2020-01-01T09:00:00.000Z', machine = 'mac-z'): Change => ({
  machine_id: machine, entity: 'thread', entity_id: id, op: 'upsert', ts,
  data: {
    id, channel_id: 'inbox', title: `remote ${id}`, status: 'done', role: null, model: null, harness: 'claude-code', effort: '',
    session_id: id, has_run: 1, cwd: '~/x', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    last_text: null, created_at: ts, updated_at: ts,
  },
});

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-sync-live-'));
  db = await import('../server/db.ts');
  sync = await import('../server/sync/worker.ts');
});

describe('the in-memory relay as a Realtime stand-in', () => {
  it('nudges a subscriber for other machines only, and again when the link comes back', async () => {
    const relay = new MemoryTransport();
    const nudges: string[] = [];
    const off = relay.subscribe('mac-a', () => nudges.push('a'));
    await relay.push([remoteThread('x1', undefined, 'mac-a')]);
    await sleep(0);
    expect(nudges).toEqual([]);
    await relay.push([remoteThread('x2')]);
    await sleep(0);
    expect(nudges).toEqual(['a']);
    relay.reconnect();
    await sleep(0);
    expect(nudges).toEqual(['a', 'a']);
    expect(relay.subscribers).toBe(1);
    off();
    expect(relay.subscribers).toBe(0);
    relay.reconnect();
    await relay.push([remoteThread('x3')]);
    await sleep(0);
    expect(nudges).toEqual(['a', 'a']);
  });
});

describe('an automatic sync worker', () => {
  const relay = new MemoryTransport();
  let regain: (() => void) | null = null;
  const network = vi.fn((onBack: () => void) => {
    regain = onBack;
    return () => void (regain = null);
  });
  let worker: ReturnType<typeof sync.createSyncWorker>;

  beforeAll(() => {
    worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a', network });
  });

  afterEach(() => vi.restoreAllMocks());

  it('syncs as soon as it starts, and keeps the 60s timer as the fallback', async () => {
    await relay.push([remoteThread('boot')]);
    const pulls = relay.pullCalls;
    const before = Date.now();
    worker.start();
    await waitFor(() => db.threads.get('boot'), 'the boot sync');
    expect(relay.pullCalls).toBeGreaterThan(pulls);
    await waitFor(() => !worker.status().running, 'the boot sync to finish');
    const next = Date.parse(worker.status().nextSyncAt!);
    expect(next - before).toBeGreaterThanOrEqual(59_000);
    expect(next - Date.now()).toBeLessThanOrEqual(60_000);
    expect(relay.subscribers).toBe(1);
    expect(network).toHaveBeenCalledOnce();
  });

  it('pulls what another machine pushed without being asked', async () => {
    await relay.push([remoteThread('live')]);
    await waitFor(() => db.threads.get('live'), 'the realtime sync');
  });

  it('does not wake itself for its own pushes', async () => {
    db.threads.create({ id: 'own', channel_id: 'inbox', title: 'local', status: 'done', role: null, model: null, session_id: 'own', cwd: '/tmp', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null });
    await worker.syncNow();
    expect(relay.changes.some((c) => c.entity_id === 'own' && c.machine_id === 'mac-a')).toBe(true);
    const pulls = relay.pullCalls;
    await sleep(500);
    expect(relay.pullCalls).toBe(pulls);
  });

  it('syncs when the Realtime link comes back after a drop', async () => {
    // Pushed while the link was down: no nudge arrives for it, so only the rejoin brings it in.
    relay.changes.push({ ...remoteThread('missed'), seq: relay.changes.at(-1)!.seq + 1 });
    await sleep(400);
    expect(db.threads.get('missed')).toBeFalsy();
    relay.reconnect();
    await waitFor(() => db.threads.get('missed'), 'the sync after the rejoin');
  });

  it('syncs when the network comes back, even while backing off after failures', async () => {
    relay.failNext(2);
    await worker.syncNow();
    await worker.syncNow();
    expect(worker.status().failures).toBe(2);
    relay.changes.push({ ...remoteThread('offline'), seq: relay.changes.at(-1)!.seq + 1 });
    regain!();
    await waitFor(() => db.threads.get('offline'), 'the sync after the network came back');
    expect(worker.status()).toMatchObject({ failures: 0, lastError: null });
  });

  it('stops listening to the relay and the network once stopped', async () => {
    worker.stop();
    expect(relay.subscribers).toBe(0);
    expect(regain).toBeNull();
    expect(worker.status().nextSyncAt).toBeNull();
    const pulls = relay.pullCalls;
    await relay.push([remoteThread('after-stop')]);
    relay.reconnect();
    await sleep(500);
    expect(relay.pullCalls).toBe(pulls);
  });
});

describe('the network watcher', () => {
  afterEach(() => vi.useRealTimers());

  const iface = (address: string, internal = false) => ({ address, internal, family: 'IPv4', netmask: '', mac: '', cidr: null }) as never;

  it('keys on the addresses of the interfaces that reach out, in a stable order', () => {
    expect(addressKey({ lo0: [iface('127.0.0.1', true)] })).toBe('');
    expect(addressKey({ en0: [iface('10.0.0.2')], en1: [iface('10.0.0.1')], lo0: [iface('127.0.0.1', true)] })).toBe(
      addressKey({ en1: [iface('10.0.0.1')], en0: [iface('10.0.0.2')] }),
    );
  });

  it('calls back when the network comes back or moves, never when it goes away', () => {
    vi.useFakeTimers();
    let key = 'en0 10.0.0.2';
    const back = vi.fn();
    const off = watchNetwork(back, { read: () => key, intervalMs: 1_000 });
    vi.advanceTimersByTime(3_000);
    expect(back).not.toHaveBeenCalled();
    key = '';
    vi.advanceTimersByTime(1_000);
    expect(back).not.toHaveBeenCalled();
    key = 'en0 10.0.0.2';
    vi.advanceTimersByTime(1_000);
    expect(back).toHaveBeenCalledTimes(1);
    key = 'en0 192.168.1.5';
    vi.advanceTimersByTime(1_000);
    expect(back).toHaveBeenCalledTimes(2);
    off();
    key = '';
    vi.advanceTimersByTime(1_000);
    key = 'en0 10.0.0.9';
    vi.advanceTimersByTime(5_000);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('calls back after the Mac slept, which shows as a tick that comes far too late', () => {
    vi.useFakeTimers();
    let clock = 0;
    const back = vi.fn();
    const off = watchNetwork(back, { read: () => 'en0 10.0.0.2', intervalMs: 1_000, now: () => clock });
    clock += 1_000;
    vi.advanceTimersByTime(1_000);
    expect(back).not.toHaveBeenCalled();
    // Asleep for an hour: the timer fires once on wake, with the clock an hour on.
    clock += 60 * 60_000;
    vi.advanceTimersByTime(1_000);
    expect(back).toHaveBeenCalledTimes(1);
    off();
  });
});
