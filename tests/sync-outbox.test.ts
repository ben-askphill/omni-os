import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The sync outbox: every repo write in db.ts, and an automation run, leaves a row naming what changed,
// in the same transaction as the write. Nothing is recorded until sync is set up on this machine.
let db: typeof import('../server/db.ts');

const thread = (id: string, patch: Record<string, unknown> = {}) => ({
  id, channel_id: 'inbox', title: id, status: 'done' as const, role: null, model: null, session_id: id, cwd: '/tmp',
  branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null, ...patch,
});
const rows = () => db.db.prepare('SELECT entity, entity_id, op FROM sync_outbox ORDER BY id').all() as { entity: string; entity_id: string; op: string }[];
const clear = () => db.db.exec('DELETE FROM sync_outbox');

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-outbox-'));
  db = await import('../server/db.ts');
});

describe('sync outbox', () => {
  it('records nothing before sync is set up', () => {
    db.threads.create(thread('before'));
    db.events.add('before', 'user', { text: 'hi' });
    db.kv.set('usage.claude-code', { pct: 1 });
    expect(db.outbox.machineId()).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('seeds the existing history once when armed, parents before children', () => {
    expect(db.outbox.arm('mac-a')).toBe('mac-a');
    const seeded = rows();
    const at = (entity: string) => seeded.findIndex((r) => r.entity === entity);
    expect(at('channel')).toBeLessThan(at('thread'));
    expect(at('thread')).toBeLessThan(at('event'));
    expect(seeded.filter((r) => r.entity === 'thread').map((r) => r.entity_id)).toEqual(['before']);
    expect(seeded.some((r) => r.entity === 'kv' && r.entity_id === 'usage.claude-code')).toBe(true);
    expect(seeded.some((r) => r.entity === 'kv' && r.entity_id.startsWith('sync.'))).toBe(false);
    // A second arm keeps the id and does not seed again.
    const n = seeded.length;
    expect(db.outbox.arm('other')).toBe('mac-a');
    expect(rows().length).toBe(n);
    clear();
  });

  it('records each write in every repo', () => {
    db.channels.create({ id: 'volero', name: 'Volero' });
    db.channels.update('volero', { notes: 'n' });
    db.threads.create(thread('t1', { channel_id: 'volero' }));
    db.threads.update('t1', { status: 'running' });
    const ev = db.events.add('t1', 'user', { text: 'hello' });
    const art = db.artifacts.upsert({ thread_id: 't1', path: '/tmp/omni-outbox-a.html', name: 'a.html', kind: 'html', size: 3 });
    db.artifacts.remove('/tmp/omni-outbox-a.html');
    const run = db.automationRuns.add('morning', 't1', 'manual');
    db.kv.set('usage.codex', { pct: 2 });
    db.kv.set('sync.cursor', 5);

    const evUid = db.events.uidOf(ev.id)!;
    const artUid = db.artifacts.uidOf(art.id);
    expect(artUid).toBeNull(); // removed
    expect(rows()).toEqual([
      { entity: 'channel', entity_id: 'volero', op: 'upsert' },
      { entity: 'channel', entity_id: 'volero', op: 'upsert' },
      { entity: 'thread', entity_id: 't1', op: 'upsert' },
      { entity: 'thread', entity_id: 't1', op: 'upsert' },
      { entity: 'event', entity_id: evUid, op: 'upsert' },
      { entity: 'artifact', entity_id: expect.any(String), op: 'upsert' },
      { entity: 'artifact', entity_id: expect.any(String), op: 'delete' },
      { entity: 'automation_run', entity_id: run.uid, op: 'upsert' },
      { entity: 'kv', entity_id: 'usage.codex', op: 'upsert' },
    ]);
    const [artUp, artDel] = rows().filter((r) => r.entity === 'artifact');
    expect(artUp.entity_id).toBe(artDel.entity_id);
    clear();
  });

  it('gives new events, artifacts and automation runs a uuid, and keeps it out of API rows', () => {
    db.threads.create(thread('t2'));
    const ev = db.events.add('t2', 'user', { text: 'x' });
    expect(db.events.uidOf(ev.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(ev)).not.toContain('uid');
    expect(Object.keys(db.events.since('t2')[0])).not.toContain('uid');
    const art = db.artifacts.upsert({ thread_id: 't2', path: '/tmp/omni-outbox-b.html', name: 'b.html', kind: 'html', size: 1 });
    expect(Object.keys(art)).not.toContain('uid');
    expect(db.artifacts.uidOf(art.id)).toMatch(/^[0-9a-f-]{36}$/);
    // An upsert of the same path keeps the uid.
    const uid = db.artifacts.uidOf(art.id);
    db.artifacts.upsert({ thread_id: 't2', path: '/tmp/omni-outbox-b.html', name: 'b.html', kind: 'html', size: 2 });
    expect(db.artifacts.uidOf(art.id)).toBe(uid);
    clear();
  });

  it('rolls the outbox row back with the write', () => {
    expect(() =>
      db.tx(() => {
        db.threads.create(thread('t3'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.threads.get('t3')).toBeUndefined();
    expect(rows()).toEqual([]);
  });

  it('nests inside a caller transaction, as import-history opens one', () => {
    db.db.exec('BEGIN');
    db.threads.create(thread('t4'));
    db.events.add('t4', 'user', { text: 'y' });
    db.db.exec('ROLLBACK');
    expect(db.threads.get('t4')).toBeUndefined();
    expect(rows()).toEqual([]);
  });

  it('stamps this machine as the last writer of a thread', () => {
    db.threads.update('t2', { title: 'renamed' });
    expect(db.syncMeta.get('thread', 't2')).toEqual({ ts: expect.any(String), machine_id: 'mac-a' });
    clear();
  });

  it("records a thread moved to another channel, as import-history's --move-imported does", () => {
    db.channels.create({ id: 'moved-to', name: 'Moved to' });
    clear();
    db.threads.setChannel('t2', 'moved-to');
    expect(db.threads.get('t2')!.channel_id).toBe('moved-to');
    expect(rows()).toEqual([{ entity: 'thread', entity_id: 't2', op: 'upsert' }]);
    clear();
  });
});
