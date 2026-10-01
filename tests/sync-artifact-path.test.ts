import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RemoteChange } from '../server/sync/transport.ts';

// A relative artifact path from the relay is stored only when it stays inside the threads folder, the same
// rule as a synced file. A portable path ("~/…" or absolute) is a file outside that folder on purpose.

let db: typeof import('../server/db.ts');
let apply: typeof import('../server/sync/apply.ts');
let threadsDir: string;

const ctx = { machineId: 'mac-z' };
let seq = 0;

const change = (uid: string, path: string, ts: string, size = 1): RemoteChange => ({
  machine_id: 'mac-z', entity: 'artifact', entity_id: uid, op: 'upsert', ts, seq: ++seq,
  data: {
    uid, thread_id: 't-art', path, name: 'file.html', kind: 'html', size, created_at: ts, updated_at: ts,
  },
});

const row = (uid: string) =>
  db.db.prepare('SELECT path, size FROM artifacts WHERE uid = ?').get(uid) as { path: string; size: number } | undefined;

const applyPath = (uid: string, path: string, ts: string, size = 1) =>
  apply.getHandler('artifact')!.apply(change(uid, path, ts, size), ctx);

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-art-path-'));
  db = await import('../server/db.ts');
  apply = await import('../server/sync/apply.ts');
  await import('../server/sync/handlers/artifact.ts');
  threadsDir = (await import('../server/config.ts')).paths.threads;
  db.threads.create({
    id: 't-art', channel_id: 'inbox', title: 'Artifacts', status: 'done', role: null, model: null,
    session_id: 't-art', cwd: '/tmp', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
});

describe('synced artifact paths', () => {
  const bad = [
    '../escape.txt',
    't-art/artifacts/../../../etc/passwd',
    't-art\\artifacts\\x.html',
    't-art/artifacts/x\0.html',
  ];

  it('drops a relative path that would leave the threads folder, and stores a normal one under it', () => {
    for (const [i, path] of bad.entries()) {
      expect(applyPath(`bad-${i}`, path, '2099-01-01T00:00:00.000Z')).toBe(false);
      expect(row(`bad-${i}`)).toBeUndefined();
    }
    expect(applyPath('good', 't-art/artifacts/report.html', '2026-01-01T00:00:00.000Z', 120)).toBe(true);
    expect(row('good')).toEqual({ path: join(threadsDir, 't-art', 'artifacts', 'report.html'), size: 120 });
  });

  it('does not update a stored row when a later path would leave the threads folder', () => {
    const kept = join(threadsDir, 't-art', 'artifacts', 'notes.html');
    expect(applyPath('upd', 't-art/artifacts/notes.html', '2026-01-01T00:00:00.000Z', 10)).toBe(true);
    for (const path of bad) expect(applyPath('upd', path, '2099-01-01T00:00:00.000Z', 99)).toBe(false);
    expect(row('upd')).toEqual({ path: kept, size: 10 });
    // Refused before the last-write claim, the same as a bad thread id, so a real edit still lands.
    expect(applyPath('upd', 't-art/artifacts/notes.html', '2026-06-01T00:00:00.000Z', 20)).toBe(true);
    expect(row('upd')).toEqual({ path: kept, size: 20 });
  });

  it('stores a portable ~/ or absolute path outside the threads folder', () => {
    expect(applyPath('home', '~/work/note.html', '2026-01-01T00:00:00.000Z', 4)).toBe(true);
    expect(row('home')?.path).toBe(join(homedir(), 'work', 'note.html'));
    expect(applyPath('abs', '/tmp/omni-artifact-outside.html', '2026-01-01T00:00:00.000Z', 5)).toBe(true);
    expect(row('abs')?.path).toBe('/tmp/omni-artifact-outside.html');
  });
});
