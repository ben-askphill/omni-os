import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../server/sync/transport.ts';

// Two Macs in one process: each loads its own copy of the server modules against its own temp data dir,
// and both talk to one in-memory relay. No network, no Keychain.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../server/db.ts');
  const { bus } = await import('../server/bus.ts');
  const sync = await import('../server/sync/worker.ts');
  const guard = await import('../server/sync/guard.ts');
  const feed: any[] = [];
  bus.on('feed', (e) => feed.push(e));
  const streamed = (threadId: string) => {
    const got: any[] = [];
    bus.on(`thread:${threadId}`, (e) => got.push(e));
    return got;
  };
  return { name, db, sync, guard, feed, streamed, worker: null as unknown as ReturnType<typeof sync.createSyncWorker> };
}

const relay = new MemoryTransport();
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;

const thread = (id: string, patch: Record<string, unknown> = {}) => ({
  id, channel_id: 'inbox', title: 'Fix the cart drawer', status: 'done' as const, role: null, model: 'sonnet',
  session_id: id, cwd: join(homedir(), 'work', 'volero'), branch: null, parent_id: null, task_id: null,
  source: 'manual' as const, automation: null, ...patch,
});

beforeAll(async () => {
  a = await machine('mac-a');
  // History from before sync was set up goes up with the first sync.
  a.db.threads.create(thread('t-old', { title: 'Before sync' }));
  a.db.events.add('t-old', 'user', { text: 'from before sync' });
  a.worker = a.sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
  b = await machine('mac-b');
  b.worker = b.sync.createSyncWorker({ transport: relay, machineId: 'mac-b' });
});

describe('two machines, one relay', () => {
  it('a thread and its events made on A show up on B, in order and searchable', async () => {
    a.db.threads.create(thread('t1'));
    a.db.events.add('t1', 'user', { text: 'the drawer flickers on open' });
    a.db.events.add('t1', 'assistant_text', { text: 'Looking at cart-drawer.liquid' });
    a.db.threads.update('t1', { status: 'done', last_text: 'Looking at cart-drawer.liquid' });

    const pushed = await a.worker.syncNow();
    expect(pushed.error).toBeUndefined();
    expect(pushed.pushed).toBeGreaterThanOrEqual(5);
    // Home dirs travel as "~".
    const up = relay.changes.find((c) => c.entity === 'thread' && c.entity_id === 't1')!;
    expect((up.data as any).cwd).toBe('~/work/volero');

    const onB = b.streamed('t1');
    const got = await b.worker.syncNow();
    expect(got.error).toBeUndefined();
    const t = b.db.threads.get('t1')!;
    expect(t.title).toBe('Fix the cart drawer');
    expect(t.last_text).toBe('Looking at cart-drawer.liquid');
    expect(t.cwd).toBe(join(homedir(), 'work', 'volero'));
    expect(b.db.events.since('t1').map((e) => [e.kind, JSON.parse(e.payload).text])).toEqual([
      ['user', 'the drawer flickers on open'],
      ['assistant_text', 'Looking at cart-drawer.liquid'],
    ]);
    expect(b.db.search('flickers').map((h) => h.thread_id)).toEqual(['t1']);
    expect(b.db.threads.get('t-old')?.title).toBe('Before sync');
    // Open threads refresh: the feed saw the thread, the thread stream saw both events.
    expect(b.feed.some((e) => e.type === 'thread' && e.thread.id === 't1')).toBe(true);
    expect(onB.map((e) => e.kind)).toEqual(['user', 'assistant_text']);
  });

  it('does not echo what it applied back to the relay', async () => {
    const before = relay.changes.length;
    await b.worker.syncNow();
    await a.worker.syncNow();
    expect(relay.changes.length).toBe(before);
    // B only ever pushed its own seed: the two system channels every install has.
    expect(relay.changes.filter((c) => c.machine_id === 'mac-b').map((c) => `${c.entity}:${c.entity_id}`).sort()).toEqual(['channel:conductor', 'channel:inbox']);
    expect(b.worker.status().pending).toBe(0);
  });

  it('pulling everything again changes nothing', async () => {
    const events = b.db.events.since('t1').length;
    const hits = b.db.db.prepare(`SELECT COUNT(*) AS n FROM search_fts WHERE thread_id = 't1'`).get() as { n: number };
    const onB = b.streamed('t1');
    b.db.kv.set('sync.cursor', 0);
    const again = await b.worker.syncNow();
    expect(again.applied).toBe(0);
    expect(b.db.events.since('t1').length).toBe(events);
    expect(b.db.db.prepare(`SELECT COUNT(*) AS n FROM search_fts WHERE thread_id = 't1'`).get()).toEqual(hits);
    expect(onB).toEqual([]);
  });

  it('a later edit on B wins on A, and A keeps it over an older edit', async () => {
    b.db.threads.update('t1', { title: 'Cart drawer flicker' });
    await b.worker.syncNow();
    await a.worker.syncNow();
    expect(a.db.threads.get('t1')!.title).toBe('Cart drawer flicker');
    expect(relay.changes.some((c) => c.machine_id === 'mac-b' && c.entity === 'thread')).toBe(true);
  });

  it('a thread running on A is running elsewhere on B, and B restarting leaves it alone', async () => {
    a.db.threads.update('t1', { status: 'running' });
    await a.worker.syncNow();
    await b.worker.syncNow();
    expect(b.db.threads.get('t1')!.status).toBe('running');
    expect(b.guard.runningElsewhere(b.db.threads.get('t1')!)).toBe(true);
    expect(a.guard.runningElsewhere(a.db.threads.get('t1')!)).toBe(false);
    expect(b.db.threads.failInterrupted()).toBe(0);
    expect(b.db.threads.get('t1')!.status).toBe('running');
    // A's own restart does fail it, and that reaches B.
    expect(a.db.threads.failInterrupted()).toBe(1);
    await a.worker.syncNow();
    await b.worker.syncNow();
    expect(b.db.threads.get('t1')!.status).toBe('failed');
  });
});
