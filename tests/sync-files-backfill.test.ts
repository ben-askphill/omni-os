import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// History from before sync was set up: its files and session files only moved after a new turn, so the bucket
// stayed empty. The first sync of each sync id now uploads them for every thread this Mac owns.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
const { MemoryTransport } = await import('../server/sync/transport.ts');
const sync = await import('../server/sync/worker.ts');
const files = await import('../server/sync/files.ts');
const { kv, syncMeta } = await import('../server/db.ts');

const home = join(r.tmp, 'home');
mkdirSync(home);
files.configureFileSync({ home, env: {}, turnDelayMs: 20, openEveryMs: 0 });
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));
const sessionFile = (t: { cwd: string; session_id: string }) =>
  join(home, '.claude', 'projects', files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);

describe('file backfill', () => {
  it('uploads the files and session files of threads that existed before sync, once per sync id', async () => {
    // Two threads made while sync was off.
    const a = await r.start('first', { title: 'Old A' });
    const b = await r.start('first', { title: 'Old B' });
    await r.untilResults(a.id, 1);
    await r.untilResults(b.id, 1);
    write(join(r.paths.threads, a.id, 'artifacts', 'report.html'), '<p>a</p>');
    write(join(r.paths.threads, b.id, 'uploads', 'brief.txt'), 'brief b');
    write(sessionFile(r.thread(a.id)), '{"turn":1}\n');

    const relay = new MemoryTransport();
    const worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    sync.setActiveWorker(worker);
    await worker.syncNow();

    await waitFor(() => kv.get('sync.files_backfill') === 'mac-a', 'the backfill to finish');
    expect(relay.objects.has(`manifests/${a.id}.json`)).toBe(true);
    expect(relay.objects.has(`manifests/${b.id}.json`)).toBe(true);
    expect(relay.objects.has(`sessions/claude-code/${r.thread(a.id).session_id}.jsonl`)).toBe(true);
    const blobs = [...relay.objects.keys()].filter((k) => k.startsWith('blobs/')).length;

    // A second sync does not upload again.
    const puts = relay.objects.size;
    await worker.syncNow();
    await new Promise((res) => setTimeout(res, 100));
    expect(relay.objects.size).toBe(puts);
    expect(blobs).toBeGreaterThanOrEqual(2);
    await sync.setActiveWorker(null);
  });

  it('leaves threads the other Mac wrote last to that Mac', async () => {
    const t = await r.start('first', { title: 'Theirs' });
    await r.untilResults(t.id, 1);
    write(join(r.paths.threads, t.id, 'uploads', 'x.txt'), 'x');
    syncMeta.set('thread', t.id, new Date().toISOString(), 'mac-b');
    kv.set('sync.files_backfill', null);

    const relay = new MemoryTransport();
    const worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    sync.setActiveWorker(worker);
    await worker.syncNow();
    await waitFor(() => kv.get('sync.files_backfill') === 'mac-a', 'the backfill to finish');
    expect(relay.objects.has(`manifests/${t.id}.json`)).toBe(false);
    await sync.setActiveWorker(null);
  });
});
