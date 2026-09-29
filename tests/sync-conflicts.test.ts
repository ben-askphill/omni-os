import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport, type Change } from '../server/sync/transport.ts';

// Every conflict rule, with both Macs writing the same row. The clock is frozen for the tie cases, so both
// writes carry the same ts and only the machine id can decide; both Macs must decide the same way.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../server/db.ts');
  const { paths } = await import('../server/config.ts');
  const apply = await import('../server/sync/apply.ts');
  const sync = await import('../server/sync/worker.ts');
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, paths, apply, worker };
}

const relay = new MemoryTransport();
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;

async function exchange() {
  for (const m of [a, b, a]) expect((await m.worker.syncNow()).error).toBeUndefined();
}

/** Run fn with Date frozen at ts, so every write in it has that ts. Timers stay real. */
function at<T>(ts: string, fn: () => T): T {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ts));
  try {
    return fn();
  } finally {
    vi.useRealTimers();
  }
}
afterEach(() => vi.useRealTimers());

const thread = (id: string) => ({
  id, channel_id: 'inbox', title: id, status: 'done' as const, role: null, model: null, session_id: id, cwd: '/tmp',
  branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null,
});

beforeAll(async () => {
  // mac-b sorts after mac-a, so it wins every tie.
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.threads.create(thread('t'));
  a.db.artifacts.upsert({ thread_id: 't', path: join(a.paths.threads, 't', 'artifacts', 'x.md'), name: 'x.md', kind: 'markdown', size: 1 });
  await exchange();
});

describe('last writer wins: channels, threads, kv, artifacts', () => {
  // After every write the setup made, so no row's last write is later than the frozen clock.
  const T = '2030-03-01T12:00:00.000Z';
  const artifactSize = (m: typeof a) => m.db.artifacts.byThread('t')[0]?.size;

  it('the same ts on both Macs resolves to the higher machine id, identically on both', async () => {
    for (const [m, v] of [[a, 'a'], [b, 'b']] as const) {
      at(T, () => {
        m.db.channels.update('inbox', { notes: `notes ${v}` });
        m.db.threads.update('t', { title: `title ${v}` });
        m.db.kv.set('usage.claude-code', { from: v });
        m.db.artifacts.upsert({ thread_id: 't', path: join(m.paths.threads, 't', 'artifacts', 'x.md'), name: 'x.md', kind: 'markdown', size: v === 'a' ? 10 : 20 });
      });
    }
    await exchange();
    for (const m of [a, b]) {
      expect(m.db.channels.get('inbox')!.notes).toBe('notes b');
      expect(m.db.threads.get('t')!.title).toBe('title b');
      expect(m.db.kv.get('usage.claude-code')).toEqual({ from: 'b' });
      expect(artifactSize(m)).toBe(20);
    }
  });

  it('a later ts wins whichever machine wrote it', async () => {
    at('2030-03-01T13:00:00.000Z', () => b.db.channels.update('inbox', { notes: 'b, earlier' }));
    at('2030-03-01T13:00:00.001Z', () => {
      a.db.channels.update('inbox', { notes: 'a, later' });
      a.db.kv.set('usage.claude-code', { from: 'a, later' });
    });
    await exchange();
    for (const m of [a, b]) {
      expect(m.db.channels.get('inbox')!.notes).toBe('a, later');
      expect(m.db.kv.get('usage.claude-code')).toEqual({ from: 'a, later' });
    }
  });

  it('two writes on one Mac in the same millisecond, synced in between, both reach the other', async () => {
    at('2030-03-01T14:00:00.000Z', () => a.db.kv.set('usage.claude-code', { n: 1 }));
    await exchange();
    at('2030-03-01T14:00:00.000Z', () => a.db.kv.set('usage.claude-code', { n: 2 }));
    await exchange();
    expect(b.db.kv.get('usage.claude-code')).toEqual({ n: 2 });
  });

  it('a write after one from a Mac whose clock runs ahead still wins, on both', async () => {
    at('2031-01-01T00:00:00.000Z', () => b.db.threads.update('t', { title: 'from the future' }));
    await exchange();
    // A's clock says 2030: its edit still comes after the one it just took.
    at('2030-03-01T15:00:00.000Z', () => a.db.threads.update('t', { title: 'the edit after it' }));
    await exchange();
    for (const m of [a, b]) expect(m.db.threads.get('t')!.title).toBe('the edit after it');
  });

  it('a change older than the last write is skipped, and the tie rule holds per entity', () => {
    const ctx = { machineId: 'mac-a' };
    const cases: [Change['entity'], string, unknown][] = [
      ['channel', 'inbox', { id: 'inbox', name: 'Inbox', kind: 'internal', notes: 'stale' }],
      ['kv', 'usage.claude-code', { value: 'stale' }],
      ['thread', 't', { ...thread('t'), title: 'stale', created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' }],
    ];
    let seq = 10_000;
    for (const [entity, id, data] of cases) {
      const last = a.db.syncMeta.get(entity, id)!;
      const older = { machine_id: 'mac-z', entity, entity_id: id, op: 'upsert' as const, ts: '2020-01-01T00:00:00.000Z', data, seq: ++seq };
      expect(a.apply.applyChange(older, ctx)).toBe('skipped');
      // Same ts as the last write: a lower machine id loses, a higher one wins.
      expect(a.apply.applyChange({ ...older, ts: last.ts, machine_id: '0-lower', seq: ++seq }, ctx)).toBe('skipped');
      expect(a.apply.applyChange({ ...older, ts: last.ts, machine_id: 'zz-higher', seq: ++seq }, ctx)).toBe('applied');
    }
    expect(a.db.channels.get('inbox')!.notes).toBe('stale');
    expect(a.db.kv.get('usage.claude-code')).toBe('stale');
    expect(a.db.threads.get('t')!.title).toBe('stale');
  });

  it('a delete is a write like any other: an older one loses to a newer edit', () => {
    const uid = a.db.artifacts.uidOf(a.db.artifacts.byThread('t')[0].id)!;
    const ctx = { machineId: 'mac-a' };
    const del = { machine_id: 'mac-z', entity: 'artifact' as const, entity_id: uid, op: 'delete' as const, ts: '2020-01-01T00:00:00.000Z', data: null, seq: 20_001 };
    expect(a.apply.applyChange(del, ctx)).toBe('skipped');
    expect(a.db.artifacts.byThread('t')).toHaveLength(1);
    expect(a.apply.applyChange({ ...del, ts: '2099-01-01T00:00:00.000Z', seq: 20_002 }, ctx)).toBe('applied');
    expect(a.db.artifacts.byThread('t')).toHaveLength(0);
  });
});

describe('insert only: events and automation runs', () => {
  it('the same uid lands once, and a later copy with other data does not overwrite it', () => {
    const ctx = { machineId: 'mac-b' };
    const ts = '2026-03-02T09:00:00.000Z';
    const run: Change & { seq: number } = {
      machine_id: 'mac-z', entity: 'automation_run', entity_id: 'run-1', op: 'upsert', ts, seq: 30_001,
      data: { uid: 'run-1', automation: 'morning', thread_id: 't', trigger: 'cron', created_at: ts },
    };
    const ev: Change & { seq: number } = {
      machine_id: 'mac-z', entity: 'event', entity_id: 'ev-1', op: 'upsert', ts, seq: 30_002,
      data: { uid: 'ev-1', thread_id: 't', kind: 'user', payload: { text: 'hello' }, created_at: ts },
    };
    for (const c of [run, ev]) {
      expect(b.apply.applyChange(c, ctx)).toBe('applied');
      expect(b.apply.applyChange({ ...c, seq: c.seq + 100 }, ctx)).toBe('skipped');
      expect(b.apply.applyChange({ ...c, ts: '2099-01-01T00:00:00.000Z', machine_id: 'zz', seq: c.seq + 200, data: { ...(c.data as object), trigger: 'manual', kind: 'error' } }, ctx)).toBe('skipped');
    }
    expect(b.db.db.prepare(`SELECT trigger FROM automation_runs WHERE uid = 'run-1'`).all()).toEqual([{ trigger: 'cron' }]);
    expect(b.db.db.prepare(`SELECT kind FROM events WHERE uid = 'ev-1'`).all()).toEqual([{ kind: 'user' }]);
  });

  it('runs made on both Macs at the same moment are both kept, on both', async () => {
    const T = '2026-03-02T10:00:00.000Z';
    at(T, () => a.db.automationRuns.add('tie', 't', 'cron'));
    at(T, () => b.db.automationRuns.add('tie', 't', 'cron'));
    await exchange();
    const uids = (m: typeof a) => m.db.db.prepare(`SELECT uid FROM automation_runs WHERE automation = 'tie' ORDER BY uid`).all();
    expect(uids(a)).toHaveLength(2);
    expect(uids(a)).toEqual(uids(b));
  });
});

describe('a second Mac joining', () => {
  // Both installs start with the same built-in channels. A fresh Mac's copy is a default, not a newer edit.
  const shared = new MemoryTransport();
  async function fresh(name: string, before?: (db: typeof import('../server/db.ts')) => void) {
    vi.resetModules();
    process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-join-${name}-`));
    const db = await import('../server/db.ts');
    before?.(db);
    const sync = await import('../server/sync/worker.ts');
    return { db, worker: sync.createSyncWorker({ transport: shared, machineId: name }) };
  }
  const run = async (...ms: { worker: { syncNow(): Promise<{ error?: string }> } }[]) => {
    for (const m of ms) expect((await m.worker.syncNow()).error).toBeUndefined();
  };

  it("does not overwrite the first Mac's edits with its own defaults", async () => {
    const first = await fresh('mac-a');
    first.db.channels.update('inbox', { notes: 'edited on A' });
    await run(first);
    // mac-z sorts after mac-a, so a tie at the same ts would go its way too.
    const joiner = await fresh('mac-z');
    await run(joiner, first, joiner);
    expect(first.db.channels.get('inbox')!.notes).toBe('edited on A');
    expect(joiner.db.channels.get('inbox')!.notes).toBe('edited on A');
  });

  it('keeps edits made before sync was set up, whichever Mac signs in first', async () => {
    const empty = await fresh('mac-y');
    await run(empty);
    const edited = await fresh('mac-b', (db) => db.channels.update('conductor', { notes: 'my conductor' }));
    await run(edited, empty, edited);
    expect(edited.db.channels.get('conductor')!.notes).toBe('my conductor');
    // A real edit after that goes everywhere, as always.
    edited.db.channels.update('conductor', { notes: 'edited again' });
    await run(edited, empty);
    expect(empty.db.channels.get('conductor')!.notes).toBe('edited again');
  });
});
