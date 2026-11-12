import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compactStep, createKeyIndex, keysFrom, topCursor } from '../src/compact.ts';
import { RelayStore, type RemoteChange, type Sql } from '../src/store.ts';

// The store on node:sqlite, as in store.test.ts.
function setup() {
  const db = new DatabaseSync(':memory:');
  const sql: Sql = {
    exec: (q, ...b) => {
      const rows = (q.trim().toUpperCase().startsWith('SELECT') ? db.prepare(q).all(...b) : (db.prepare(q).run(...b), [])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
  const transaction = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  const blobs = new Map<string, string>();
  const store = new RelayStore(sql, { put: async (k, v) => void blobs.set(k, v), get: async (k) => blobs.get(k) ?? null }, transaction, 'user_ben');
  return { store, sql, transaction };
}

let clock = 0;
const change = (machine: string, id: string, op: 'upsert' | 'delete' = 'upsert', data: unknown = { v: clock }) => ({
  machine_id: machine,
  entity: 'thread',
  entity_id: id,
  op,
  data: op === 'delete' ? null : data,
  ts: new Date(Date.UTC(2026, 10, 1) + ++clock * 1000).toISOString(),
});

/** What a machine ends up with after pulling everything after `after`: last writer wins by (ts, machine), as apply.ts. */
async function stateFor(store: RelayStore, machine: string, after = 0) {
  const all: RemoteChange[] = [];
  for (let page = await store.pull(after, machine, 1000); page.length; page = await store.pull(page[page.length - 1].seq, machine, 1000)) all.push(...page);
  const state = new Map<string, RemoteChange>();
  for (const c of all) {
    const last = state.get(c.entity_id);
    if (!last || c.ts > last.ts || (c.ts === last.ts && c.machine_id > last.machine_id)) state.set(c.entity_id, c);
  }
  return new Map([...state].map(([id, c]) => [id, c.op === 'delete' ? 'deleted' : JSON.stringify(c.data)]));
}

/** Run compaction to the end in steps of `rows`, optionally restarting from the saved cursor after every step. */
function compactAll(sql: Sql, transaction: <T>(fn: () => T) => T, rows: number, restartEachStep = false) {
  let below = topCursor(sql);
  let seen = new Set<string>();
  let removed = 0;
  for (;;) {
    const step = compactStep(sql, transaction, below, seen, rows);
    removed += step.removed;
    if (step.next === null) return removed;
    below = step.next;
    if (restartEachStep) seen = keysFrom(sql, below);
  }
}

const count = (sql: Sql) => Number((sql.exec('SELECT COUNT(*) AS n FROM changes').toArray()[0] as { n: number }).n);

/** A log like the one that filled the relay: a few items re-saved in a loop by one machine, plus normal traffic. */
async function loopedLog(store: RelayStore) {
  await store.push({ changes: [change('pro', 't1'), change('air', 't2'), change('omarchy', 't3')] });
  for (let i = 0; i < 40; i++) await store.push({ changes: [change('air', 'loop1'), change('air', 'loop2'), change('air', 't1')] });
  await store.push({ changes: [change('pro', 't2'), change('omarchy', 't1')] });
  await store.push({ changes: [change('pro', 'gone'), change('air', 'loop1')] });
  await store.push({ changes: [change('pro', 'gone', 'delete')] });
}

describe('change log compaction', () => {
  it('keeps the newest row per item per machine, so every machine pulls the same state', async () => {
    const { store, sql, transaction } = setup();
    await loopedLog(store);
    const before = await Promise.all(['pro', 'air', 'omarchy', 'new'].map((m) => stateFor(store, m)));
    const rows = count(sql);

    const removed = compactAll(sql, transaction, 7);

    expect(count(sql)).toBe(rows - removed);
    const left = sql.exec('SELECT machine_id, entity_id, COUNT(*) AS n FROM changes GROUP BY machine_id, entity, entity_id HAVING n > 1').toArray();
    expect(left).toEqual([]);
    expect(count(sql)).toBe(9); // pro: t1 t2 gone, air: t2 loop1 loop2 t1, omarchy: t3 t1
    expect(await Promise.all(['pro', 'air', 'omarchy', 'new'].map((m) => stateFor(store, m)))).toEqual(before);
  });

  it('gives the same result when it restarts from the saved cursor after every step', async () => {
    const a = setup();
    const b = setup();
    await loopedLog(a.store);
    clock = 0;
    await loopedLog(b.store);
    compactAll(a.sql, a.transaction, 5);
    compactAll(b.sql, b.transaction, 5, true);
    expect(b.sql.exec('SELECT seq FROM changes ORDER BY seq').toArray()).toEqual(a.sql.exec('SELECT seq FROM changes ORDER BY seq').toArray());
  });

  it('still brings a machine with an old cursor up to date', async () => {
    const { store, sql, transaction } = setup();
    await store.push({ changes: [change('air', 'x', 'upsert', { v: 'old' })] });
    const cursor = (await store.pull(0, 'pro', 10))[0].seq;
    await store.push({ changes: [change('air', 'x', 'upsert', { v: 'mid' })] });
    await store.push({ changes: [change('air', 'x', 'upsert', { v: 'new' })] });
    compactAll(sql, transaction, 2);
    expect((await store.pull(cursor, 'pro', 10)).map((c) => c.data)).toEqual([{ v: 'new' }]);
  });

  it('keeps a delete when it is the newest row for its item', async () => {
    const { store, sql, transaction } = setup();
    await store.push({ changes: [change('pro', 'd')] });
    await store.push({ changes: [change('pro', 'd', 'delete')] });
    compactAll(sql, transaction, 10);
    expect((await store.pull(0, 'air', 10)).map((c) => c.op)).toEqual(['delete']);
  });

  it('prunes superseded rows on push once enabled, and leaves other machines and items alone', async () => {
    const { store, sql } = setup();
    createKeyIndex(sql);
    store.prune = true;
    await store.push({ changes: [change('air', 'a'), change('pro', 'a'), change('air', 'b')] });
    await store.push({ changes: [change('air', 'a'), change('air', 'a')] });
    const rows = sql.exec('SELECT seq, machine_id, entity_id FROM changes ORDER BY seq').toArray();
    expect(rows).toEqual([
      { seq: 2, machine_id: 'pro', entity_id: 'a' },
      { seq: 3, machine_id: 'air', entity_id: 'b' },
      { seq: 5, machine_id: 'air', entity_id: 'a' },
    ]);
    expect((await store.pull(0, 'pro', 10)).map((c) => [c.seq, c.entity_id])).toEqual([[3, 'b'], [5, 'a']]);
  });

  it('does not prune on push before compaction is done', async () => {
    const { store, sql } = setup();
    await store.push({ changes: [change('air', 'a')] });
    await store.push({ changes: [change('air', 'a')] });
    expect(count(sql)).toBe(2);
  });
});
