import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Queueing every existing row again, for a new relay or history the relay lost.
let db: typeof import('../server/db.ts');
let backfill: typeof import('../server/sync/backfill.ts');

const dir = mkdtempSync(join(tmpdir(), 'omni-sync-backfill-'));
const ROOT = resolve(import.meta.dirname, '..');

const outboxRows = () =>
  db.db.prepare('SELECT entity, entity_id, ts FROM sync_outbox ORDER BY id').all() as { entity: string; entity_id: string; ts: string }[];

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = dir;
  db = await import('../server/db.ts');
  backfill = await import('../server/sync/backfill.ts');
});

describe('sync backfill', () => {
  it('refuses to run before sync is set up on this machine', () => {
    expect(() => backfill.backfill()).toThrow(/not set up/);
  });

  it('queues every row once, parents first, and nothing twice', () => {
    db.outbox.arm('mac-a');
    db.channels.create({ id: 'acme', name: 'Acme' });
    const t = { channel_id: 'acme', title: 't', status: 'done', role: null, model: null, cwd: '/tmp', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null } as const;
    db.threads.create({ ...t, id: 't1', session_id: 't1' });
    db.threads.create({ ...t, id: 't2', session_id: 't2' });
    db.events.add('t1', 'user', { text: 'hi' });
    db.events.add('t1', 'assistant', { text: 'hello' });
    db.automationRuns.add('daily', 't1', 'cron');
    db.kv.set('pinned', ['t1']);
    db.kv.set('sync.path_map', { '~/a': '~/b' });
    // Another machine wrote t2 last: it is that machine's to send.
    db.syncMeta.set('thread', 't2', '2999-01-01T00:00:00.000Z', 'mac-z');
    // As if everything had been pushed.
    db.outbox.ack((db.db.prepare('SELECT id FROM sync_outbox').all() as { id: number }[]).map((r) => r.id));
    expect(outboxRows()).toEqual([]);

    const seen: string[] = [];
    const report = backfill.backfill({ onProgress: (r) => seen.push(r.entity) });
    expect(seen).toEqual(['channel', 'thread', 'event', 'artifact', 'automation_run', 'kv']);
    const by = Object.fromEntries(report.map((r) => [r.entity, r]));
    expect(by.channel).toMatchObject({ queued: 3, alreadyQueued: 0, elsewhere: 0 });
    expect(by.thread).toMatchObject({ queued: 1, elsewhere: 1 });
    expect(by.event).toMatchObject({ queued: 2 });
    expect(by.automation_run).toMatchObject({ queued: 1 });
    expect(by.kv).toMatchObject({ queued: 1 });
    const rows = outboxRows();
    expect(rows.filter((r) => r.entity === 'kv').map((r) => r.entity_id)).toEqual(['pinned']);
    expect(rows.some((r) => r.entity === 'thread' && r.entity_id === 't2')).toBe(false);
    // A last-writer-wins row keeps its clock, so it never beats a newer write elsewhere.
    expect(rows.find((r) => r.entity === 'thread')!.ts).toBe(db.syncMeta.get('thread', 't1')!.ts);

    const again = backfill.backfill();
    expect(again.reduce((n, r) => n + r.queued, 0)).toBe(0);
    expect(Object.fromEntries(again.map((r) => [r.entity, r.alreadyQueued]))).toMatchObject({ channel: 3, thread: 1, event: 2, kv: 1 });
    expect(outboxRows()).toHaveLength(rows.length);
  });

  it('runs as npm run sync:backfill, with progress', () => {
    const out = execFileSync(join(ROOT, 'node_modules', '.bin', 'tsx'), [join(ROOT, 'scripts', 'sync-backfill.ts')], {
      env: { ...process.env, OMNI_DATA_DIR: dir, NODE_OPTIONS: '--disable-warning=ExperimentalWarning' },
      encoding: 'utf8',
    });
    expect(out).toMatch(/channels\s+0 queued, 3 already queued/);
    expect(out).toMatch(/threads\s+0 queued, 1 already queued, 1 last written on another Mac/);
    expect(out).toMatch(/Nothing new to queue/);
  });
});
