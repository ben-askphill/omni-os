import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compactStep, keysFrom, topCursor } from '../src/compact.ts';
import { Maintenance, type Kv } from '../src/maintain.ts';
import { RelayStore, type Sql } from '../src/store.ts';

function setup() {
  const db = new DatabaseSync(':memory:');
  let statements = 0;
  const sql: Sql = {
    exec: (q, ...b) => {
      statements++;
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
  const values = new Map<string, unknown>();
  const kv: Kv = {
    get: async <T>(k: string) => values.get(k) as T | undefined,
    put: async (k, v) => void values.set(k, v),
    delete: async (k) => values.delete(k),
  };
  const lines: string[] = [];
  const upkeep = () => new Maintenance(sql, kv, transaction, store, (l) => lines.push(l));
  return { db, sql, transaction, store, values, kv, lines, upkeep, statements: () => statements };
}

let clock = 0;
const change = (machine: string, id: string) => ({ machine_id: machine, entity: 'thread', entity_id: id, op: 'upsert' as const, data: { v: ++clock }, ts: new Date(Date.UTC(2026, 10, 1) + clock * 1000).toISOString() });
const count = (sql: Sql) => Number((sql.exec('SELECT COUNT(*) AS n FROM changes').toArray()[0] as { n: number }).n);

/** One machine re-saving two threads `times` times, as the loop that filled the relay. */
async function looped(store: RelayStore, times: number) {
  await store.push({ changes: [change('pro', 'a')] });
  for (let i = 0; i < times; i++) await store.push({ changes: [change('air', 'loop1'), change('air', 'loop2')] });
}

describe('change log upkeep in slices', () => {
  it('does a bounded amount per slice and says there is more', async () => {
    const t = setup();
    await looped(t.store, 12_000); // 24,001 rows: five steps of 5,000
    const upkeep = t.upkeep();
    const before = t.statements();
    expect(await upkeep.slice(2)).toBe(true);
    // Two steps: two reads and at most 10,000 deletes, however long the log is.
    expect(t.statements() - before).toBeLessThanOrEqual(2 + 10_000);
    expect(t.values.get('compacted')).toBeUndefined();
    expect(t.store.prune).toBe(false);
    expect(count(t.sql)).toBeGreaterThan(3);
  });

  it('finishes over several slices, then creates the index and turns prune on', async () => {
    const t = setup();
    await looped(t.store, 12_000);
    const upkeep = t.upkeep();
    let slices = 0;
    while (await upkeep.slice(2)) slices++;
    expect(slices).toBeGreaterThan(1);
    expect(count(t.sql)).toBe(3);
    expect(t.values.get('compacted')).toBe(true);
    expect(t.values.get('inline_moved')).toBe(true);
    expect(t.store.prune).toBe(true);
    expect(await upkeep.done()).toBe(true);
    expect(t.lines.some((l) => l.includes('change log compacted'))).toBe(true);
  });

  it('picks up from the saved cursor in a new object, and takes pushes between slices', async () => {
    const t = setup();
    await looped(t.store, 12_000);
    expect(await t.upkeep().slice(1)).toBe(true);
    await t.store.push({ changes: [change('air', 'loop1'), change('omarchy', 'b')] });
    const again = t.upkeep();
    while (await again.slice(1));
    const rows = t.sql.exec('SELECT machine_id, entity_id, COUNT(*) AS n FROM changes GROUP BY machine_id, entity_id ORDER BY entity_id').toArray();
    // loop1 keeps the row pushed after the pass began and the newest one below it: space, never a wrong answer.
    expect(rows).toEqual([
      { machine_id: 'pro', entity_id: 'a', n: 1 },
      { machine_id: 'omarchy', entity_id: 'b', n: 1 },
      { machine_id: 'air', entity_id: 'loop1', n: 2 },
      { machine_id: 'air', entity_id: 'loop2', n: 1 },
    ]);
    const pulled = await t.store.pull(0, 'pro', 1000);
    expect(pulled.filter((c) => c.entity_id === 'loop1').at(-1)!.data).toEqual({ v: clock - 1 });
  });

  it('moves inline change data out a batch per slice once the log is compact', async () => {
    const t = setup();
    await t.store.push({ changes: [change('air', 'x'), change('air', 'y')] });
    t.db.exec(`UPDATE changes SET data = '{"old":true}', blob = NULL`);
    const upkeep = t.upkeep();
    expect(await upkeep.slice()).toBe(true); // scanned both rows
    expect(await upkeep.slice()).toBe(true); // compacted, one batch moved
    expect(await upkeep.slice()).toBe(false);
    expect(t.sql.exec('SELECT COUNT(*) AS n FROM changes WHERE data IS NOT NULL').toArray()).toEqual([{ n: 0 }]);
    expect((await t.store.pull(0, 'pro', 10)).map((c) => c.data)).toEqual([{ old: true }, { old: true }]);
  });

  it('runs one slice at a time', async () => {
    const t = setup();
    await looped(t.store, 10);
    const upkeep = t.upkeep();
    const [a, b] = await Promise.all([upkeep.slice(1), upkeep.slice(1)]);
    expect([a, b]).toContain(true);
  });
});

describe('the remembered items stay bounded', () => {
  it('starts the set over at the limit and still removes a looping item', async () => {
    const t = setup();
    for (let i = 0; i < 50; i++) await t.store.push({ changes: [change('air', `once${i}`), change('air', 'loop')] });
    const seen = new Set<string>();
    let below = topCursor(t.sql);
    for (let step = compactStep(t.sql, t.transaction, below, seen, 10, 8); step.next !== null; step = compactStep(t.sql, t.transaction, below, seen, 10, 8)) {
      below = step.next;
      expect(seen.size).toBeLessThanOrEqual(8 + 10);
    }
    const loop = Number((t.sql.exec(`SELECT COUNT(*) AS n FROM changes WHERE entity_id = 'loop'`).toArray()[0] as { n: number }).n);
    expect(loop).toBeLessThanOrEqual(10); // one extra row per restart of the set at most, down from 50
    expect(Number((t.sql.exec(`SELECT COUNT(*) AS n FROM changes WHERE entity_id LIKE 'once%'`).toArray()[0] as { n: number }).n)).toBe(50);
    expect(Number((t.sql.exec(`SELECT MAX(seq) AS s FROM changes WHERE entity_id = 'loop'`).toArray()[0] as { s: number }).s)).toBe(100);
  });

  it('rebuilds at most the limit, newest first', async () => {
    const t = setup();
    for (let i = 0; i < 30; i++) await t.store.push({ changes: [change('air', `t${i}`)] });
    const seen = keysFrom(t.sql, 1, 10, 4);
    expect(seen.size).toBeLessThanOrEqual(12);
    expect(seen.has(JSON.stringify(['air', 'thread', 't29']))).toBe(true);
    expect(seen.has(JSON.stringify(['air', 'thread', 't0']))).toBe(false);
  });
});
