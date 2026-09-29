import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport, type Change } from '../server/sync/transport.ts';

// Channels, artifacts, automation runs and kv between two Macs in one process, each with its own data dir,
// through one in-memory relay. Paths travel as "~" and through each Mac's own path map.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../server/db.ts');
  const { paths } = await import('../server/config.ts');
  const { bus } = await import('../server/bus.ts');
  const sync = await import('../server/sync/worker.ts');
  const automations = await import('../server/automations.ts');
  const feed: any[] = [];
  bus.on('feed', (e) => feed.push(e));
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, paths, bus, feed, worker, automations };
}

const relay = new MemoryTransport();
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;
const home = homedir();

/** Push from one side and pull on the other, both ways. */
async function exchange() {
  for (const m of [a, b, a]) expect((await m.worker.syncNow()).error).toBeUndefined();
}

const thread = (id: string, patch: Record<string, unknown> = {}) => ({
  id, channel_id: 'volero', title: id, status: 'done' as const, role: null, model: null, session_id: id,
  cwd: join(home, 'work', 'volero'), branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null, ...patch,
});

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
});

describe('channels', () => {
  it('a channel made on A arrives on B with its paths expanded there', async () => {
    a.db.channels.create({ id: 'volero', name: 'Volero', repo_path: join(home, 'work', 'volero'), base_dir: join(home, 'work'), github_repo: 'askphill/volero', notes: 'ship it' });
    await exchange();
    const up = relay.changes.find((c) => c.entity === 'channel' && c.entity_id === 'volero')!;
    expect(up.data).toMatchObject({ repo_path: '~/work/volero', base_dir: '~/work' });
    expect(b.db.channels.get('volero')).toMatchObject({
      name: 'Volero', repo_path: join(home, 'work', 'volero'), base_dir: join(home, 'work'), github_repo: 'askphill/volero', notes: 'ship it',
      use_worktree: 1, archived: 0, created_at: a.db.channels.get('volero')!.created_at,
    });
  });

  it("B's path map places the folders where B keeps them, and an edit on B sends A's paths back", async () => {
    b.db.kv.set('sync.path_map', { '~/work': '~/code' });
    a.db.channels.update('volero', { notes: 'from A' });
    a.db.threads.create(thread('t-map'));
    await exchange();
    expect(b.db.channels.get('volero')).toMatchObject({ notes: 'from A', repo_path: join(home, 'code', 'volero'), base_dir: join(home, 'code') });
    expect(b.db.threads.get('t-map')!.cwd).toBe(join(home, 'code', 'volero'));
    // The path map is B's own and never leaves it.
    expect(relay.changes.some((c) => c.entity === 'kv' && c.entity_id.startsWith('sync.'))).toBe(false);

    b.db.channels.update('volero', { notes: 'from B' });
    b.db.threads.update('t-map', { title: 'renamed on B' });
    await exchange();
    const back = relay.changes.filter((c) => c.machine_id === 'mac-b');
    expect(back.find((c) => c.entity === 'channel' && c.entity_id === 'volero')!.data).toMatchObject({ repo_path: '~/work/volero', base_dir: '~/work' });
    expect((back.find((c) => c.entity === 'thread' && c.entity_id === 't-map')!.data as any).cwd).toBe('~/work/volero');
    expect(a.db.channels.get('volero')).toMatchObject({ notes: 'from B', repo_path: join(home, 'work', 'volero') });
    expect(a.db.threads.get('t-map')).toMatchObject({ title: 'renamed on B', cwd: join(home, 'work', 'volero') });
    b.db.kv.set('sync.path_map', {});
  });

  it('archiving on one Mac archives on the other', async () => {
    b.db.channels.update('volero', { archived: 1 });
    await exchange();
    expect(a.db.channels.get('volero')!.archived).toBe(1);
    a.db.channels.update('volero', { archived: 0 });
    await exchange();
    expect(b.db.channels.get('volero')!.archived).toBe(0);
  });
});

describe('kv', () => {
  it('syncs ordinary keys and keeps sync.* keys on their own Mac', async () => {
    a.db.kv.set('usage.claude-code', { five_hour: 42 });
    a.db.kv.set('sync.enabled', true);
    await exchange();
    expect(b.db.kv.get('usage.claude-code')).toEqual({ five_hour: 42 });
    expect(b.db.kv.get('sync.enabled')).toBeUndefined();
    expect(b.db.kv.get<string>('sync.machine_id')).toBe('mac-b');
  });

  it('ignores a sync.* key even if one reaches the relay', async () => {
    const cursor = b.db.kv.get<number>('sync.cursor');
    const forged: Change = { machine_id: 'mac-a', entity: 'kv', entity_id: 'sync.machine_id', op: 'upsert', ts: new Date().toISOString(), data: { value: 'mac-a' } };
    await relay.push([forged, { ...forged, entity_id: 'sync.path_map', data: { value: { '/': '/tmp' } } }]);
    await b.worker.syncNow();
    expect(b.db.kv.get('sync.machine_id')).toBe('mac-b');
    expect(b.db.kv.get('sync.path_map')).toEqual({});
    expect(b.db.kv.get<number>('sync.cursor')).toBeGreaterThan(cursor!);
  });
});

describe('automation runs', () => {
  const runs = (m: typeof a) =>
    m.db.db.prepare('SELECT uid, automation, thread_id, trigger, created_at FROM automation_runs ORDER BY id').all();

  it('a run on A shows up on B once, however often it is pulled', async () => {
    a.db.threads.create(thread('t-auto', { source: 'automation', automation: 'morning' }));
    const { uid } = a.db.automationRuns.add('morning', 't-auto', 'cron');
    await exchange();
    expect(runs(b)).toEqual(runs(a));
    expect(runs(b)).toEqual([expect.objectContaining({ uid, automation: 'morning', thread_id: 't-auto', trigger: 'cron' })]);
    b.db.kv.set('sync.cursor', 0);
    const again = await b.worker.syncNow();
    expect(again.applied).toBe(0);
    expect(runs(b)).toHaveLength(1);
  });

  it('waits for its thread when the run arrives first', async () => {
    const ts = '2026-01-01T08:00:00.000Z';
    await relay.push([
      { machine_id: 'mac-a', entity: 'automation_run', entity_id: 'run-early', op: 'upsert', ts, data: { uid: 'run-early', automation: 'late', thread_id: 't-late', trigger: 'manual', created_at: ts } },
    ]);
    await b.worker.syncNow();
    expect(b.worker.status().deferred).toBe(1);
    a.db.threads.create(thread('t-late'));
    await exchange();
    expect(b.worker.status().deferred).toBe(0);
    expect(runs(b).map((r: any) => r.uid)).toContain('run-early');
  });

  it("lists an automation's runs newest first by when they ran, not by when they arrived", async () => {
    const ts = '2020-06-01T08:00:00.000Z';
    await relay.push([
      { machine_id: 'mac-a', entity: 'automation_run', entity_id: 'run-old', op: 'upsert', ts, data: { uid: 'run-old', automation: 'morning', thread_id: 't-auto', trigger: 'cron', created_at: ts } },
    ]);
    await b.worker.syncNow();
    expect(b.automations.lastRuns('morning').map((r: any) => r.created_at)).toEqual([runs(a)[0].created_at, ts]);
  });
});

describe('artifacts', () => {
  const file = (m: typeof a, t: string, name: string) => join(m.paths.threads, t, 'artifacts', name);

  it("an artifact on A lands on B under B's own thread folder, and tells open clients", async () => {
    a.db.threads.create(thread('t-art'));
    await exchange();
    const onB: any[] = [];
    b.bus.on('thread:t-art', (e) => onB.push(e));
    const made = a.db.artifacts.upsert({ thread_id: 't-art', path: file(a, 't-art', 'report.html'), name: 'report.html', kind: 'html', size: 120 });
    await exchange();
    const up = relay.changes.findLast((c) => c.entity === 'artifact')!;
    expect(up.entity_id).toBe(a.db.artifacts.uidOf(made.id));
    expect((up.data as any).path).toBe(join('t-art', 'artifacts', 'report.html'));
    const got = b.db.artifacts.byThread('t-art');
    expect(got).toEqual([expect.objectContaining({ path: file(b, 't-art', 'report.html'), name: 'report.html', kind: 'html', size: 120, created_at: made.created_at })]);
    expect(b.db.artifacts.uidOf(got[0].id)).toBe(up.entity_id);
    expect(Object.keys(got[0])).not.toContain('uid');
    expect(onB).toEqual([{ kind: 'artifact', artifact: got[0] }]);
    expect(b.feed.at(-1)).toEqual({ type: 'artifact', artifact: got[0] });
  });

  it('a rewrite updates it in place and a removal removes it', async () => {
    a.db.artifacts.upsert({ thread_id: 't-art', path: file(a, 't-art', 'report.html'), name: 'report.html', kind: 'html', size: 999 });
    await exchange();
    expect(b.db.artifacts.byThread('t-art').map((x) => x.size)).toEqual([999]);
    a.db.artifacts.remove(file(a, 't-art', 'report.html'));
    await exchange();
    expect(b.db.artifacts.byThread('t-art')).toEqual([]);
  });

  it('the same file registered on both Macs ends up as one artifact, the same one on both', async () => {
    // B's watcher sees a synced file before its row arrives and registers it under a uid of its own.
    a.db.artifacts.upsert({ thread_id: 't-art', path: file(a, 't-art', 'both.md'), name: 'both.md', kind: 'markdown', size: 5 });
    b.db.artifacts.upsert({ thread_id: 't-art', path: file(b, 't-art', 'both.md'), name: 'both.md', kind: 'markdown', size: 5 });
    await exchange();
    await exchange();
    const uidOn = (m: typeof a) => m.db.artifacts.byThread('t-art').map((x) => m.db.artifacts.uidOf(x.id));
    expect(uidOn(a)).toHaveLength(1);
    expect(uidOn(a)).toEqual(uidOn(b));
  });
});
