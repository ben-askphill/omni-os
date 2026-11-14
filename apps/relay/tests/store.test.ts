import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { RelayError } from '../src/auth.ts';
import { checkChange, objectPath, RelayStore, type Sql } from '../src/store.ts';

// The store on node:sqlite, as it runs on a Durable Object's SQLite.
function setup() {
  const db = new DatabaseSync(':memory:');
  // Eager, like SqlStorage.exec: the statement runs whether or not the rows are read.
  const sql: Sql = {
    exec: (q, ...b) => {
      const rows = (q.trim().toUpperCase().startsWith('SELECT') ? db.prepare(q).all(...b) : (db.prepare(q).run(...b), [])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
  const blobs = new Map<string, string>();
  let clock = Date.parse('2026-11-01T12:00:00Z');
  const store = new RelayStore(
    sql,
    { put: async (k, v) => void blobs.set(k, v), get: async (k) => blobs.get(k) ?? null },
    (fn) => {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    'user_ben',
    () => clock,
  );
  return { store, blobs, db, tick: (ms: number) => (clock += ms) };
}

const change = (machine: string, id: string, data: unknown = { title: id }) => ({ machine_id: machine, entity: 'thread', entity_id: id, op: 'upsert', data, ts: '2026-11-01T12:00:00.000Z' });

describe('RelayStore', () => {
  it('numbers changes in push order and pulls only other machines after a seq', async () => {
    const { store } = setup();
    expect([...(await store.push({ changes: [change('a', 't1'), change('a', 't2')] }))]).toEqual(['a']);
    await store.push({ changes: [change('b', 't3')] });
    const forB = await store.pull(0, 'b', 100);
    expect(forB.map((c) => [c.seq, c.entity_id])).toEqual([[1, 't1'], [2, 't2']]);
    expect(forB[0]).toMatchObject({ machine_id: 'a', entity: 'thread', op: 'upsert', data: { title: 't1' }, ts: '2026-11-01T12:00:00.000Z' });
    expect((await store.pull(1, 'b', 100)).map((c) => c.seq)).toEqual([2]);
    expect((await store.pull(0, 'a', 100)).map((c) => c.entity_id)).toEqual(['t3']);
    expect(await store.pull(0, 'b', 1)).toHaveLength(1);
  });

  it('keeps strings Postgres refused, and deletes with no data', async () => {
    const { store } = setup();
    await store.push({ changes: [change('a', 't1', { out: 'nul\u0000 and lone \ud800' }), { ...change('a', 't2'), op: 'delete', data: null }] });
    const [one, two] = await store.pull(0, 'b', 10);
    expect(one.data).toEqual({ out: 'nul\u0000 and lone \ud800' });
    expect(two).toMatchObject({ op: 'delete', data: null });
  });

  it('keeps change data out of SQLite, one blob per push, so the log grows only by its index', async () => {
    const { store, blobs, db } = setup();
    const big = { out: 'x'.repeat(3_000_000) };
    await store.push({ changes: [change('a', 't1', big), { ...change('a', 't2'), op: 'delete', data: null }, change('a', 't3')] });
    expect(blobs.size).toBe(1);
    expect([...blobs.keys()][0]).toMatch(/^user_ben\/changes\/.+\.json$/);
    expect(db.prepare('SELECT count(*) AS n FROM changes WHERE data IS NOT NULL').get()).toEqual({ n: 0 });
    const pulled = await store.pull(0, 'b', 10);
    expect(pulled.map((c) => c.data)).toEqual([big, null, { title: 't3' }]);
  });

  it('moves data written inline before batches out to blobs, resumably, and pulls the same changes after', async () => {
    const { store, blobs, db } = setup();
    const insert = db.prepare('INSERT INTO changes (machine_id, entity, entity_id, op, data, blob, ts) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 1; i <= 5; i++) insert.run('a', 'thread', `t${i}`, 'upsert', JSON.stringify({ title: `t${i}` }), null, '2026-11-01T12:00:00.000Z');
    blobs.set('user_ben/changes/old.json', JSON.stringify({ title: 'old' }));
    insert.run('a', 'thread', 'old', 'upsert', null, 'user_ben/changes/old.json', '2026-11-01T12:00:00.000Z');
    const before = await store.pull(0, 'b', 10);

    let after = 0;
    after = (await store.moveInline(after, 2))!;
    expect(after).toBe(2);
    for (let next = await store.moveInline(after, 2); next !== null; next = await store.moveInline(after, 2)) after = next;
    expect(after).toBe(5);

    expect(db.prepare('SELECT count(*) AS n FROM changes WHERE data IS NOT NULL').get()).toEqual({ n: 0 });
    expect(await store.pull(0, 'b', 10)).toEqual(before);
    expect(await store.moveInline(0)).toBeNull();
  });

  it('refuses a malformed batch whole, so nothing half-lands', async () => {
    const { store } = setup();
    await expect(store.push({ changes: [change('a', 't1'), { ...change('a', 't2'), op: 'merge' }] })).rejects.toThrow(/upsert or delete/);
    await expect(store.push({})).rejects.toThrow(/changes/);
    expect(await store.pull(0, 'b', 10)).toEqual([]);
  });

  it('takes any entity name of the right shape, so a new entity needs no relay change', () => {
    expect(checkChange({ ...change('a', 't'), entity: 'brand_new_thing' }).entity).toBe('brand_new_thing');
    for (const entity of ['Thread', 'a-b', '', 'x'.repeat(41)]) expect(() => checkChange({ ...change('a', 't'), entity })).toThrow(RelayError);
    expect(checkChange({ ...change('a', 't'), ts: '2026-11-01T13:00:00+01:00' }).ts).toBe('2026-11-01T12:00:00.000Z');
    expect(() => checkChange({ ...change('a', 't'), ts: 'yesterday' })).toThrow(/ts/);
  });

  it('checks tokens by hash, and a revoked one is signed out', async () => {
    const { store, db, tick } = setup();
    const id = await store.addToken('omni_r_x.secret', 'Ben’s MacBook Air');
    expect(await store.checkToken('omni_r_x.secret')).toBe(id);
    expect(JSON.stringify(db.prepare('SELECT * FROM tokens').all())).not.toContain('secret');
    tick(120_000);
    await store.checkToken('omni_r_x.secret');
    expect((db.prepare('SELECT last_seen_at FROM tokens').get() as { last_seen_at: string }).last_seen_at).toBe('2026-11-01T12:02:00.000Z');
    store.revokeToken(id);
    const err = await store.checkToken('omni_r_x.secret').catch((e: RelayError) => e);
    expect(err).toMatchObject({ status: 401, code: 'signed_out' });
    await expect(store.checkToken('omni_r_other')).rejects.toThrow(/signed out/);
  });
});

describe('objectPath', () => {
  it('takes the paths Omni writes, Cursor chat files with any name included, and nothing that climbs out', () => {
    for (const ok of ['blobs/ab12', 'manifests/t-1.json', 'sessions/claude/0c9.jsonl', 'sessions/cursor/chat 1/sub dir/notes (1).md', 'handoffs/o-1.bundle'])
      expect(objectPath(ok)).toBe(true);
    for (const bad of ['', '/blobs/x', 'blobs//x', 'blobs/', '../x', 'a/../b', 'a/./b', 'a\u0000b', 'a\nb', 'x'.repeat(901)]) expect(objectPath(bad)).toBe(false);
  });
});

describe('RelayStore: a token pushes as one machine (PRD #667, S9)', () => {
  it('binds a token to the machine it first pushes as, and signs out a push in another machine\'s name', async () => {
    const { store } = setup();
    const tokA = await store.addToken('token-a', 'Mac A');
    const tokB = await store.addToken('token-b', 'Mac B');
    await store.push({ changes: [change('a', 't1')] }, tokA);
    await store.push({ changes: [change('a', 't2')] }, tokA);
    await expect(store.push({ changes: [change('b', 't3')] }, tokA)).rejects.toMatchObject({ status: 401 });
    await expect(store.push({ changes: [change('a', 't4'), change('b', 't5')] }, tokB)).rejects.toMatchObject({ status: 403 });
    await store.push({ changes: [change('b', 't6')] }, tokB);
    await expect(store.push({ changes: [change('a', 't7')] }, tokB)).rejects.toMatchObject({ status: 401 });
    expect((await store.pull(0, 'nobody', 100)).map((c) => [c.machine_id, c.entity_id])).toEqual([['a', 't1'], ['a', 't2'], ['b', 't6']]);
  });
});
