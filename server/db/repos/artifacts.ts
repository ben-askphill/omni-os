import { randomUUID } from 'node:crypto';
import { db, tx } from '../connection.ts';
import { record } from '../sync.ts';

export interface Artifact {
  id: number;
  thread_id: string;
  path: string;
  name: string;
  kind: string;
  size: number;
  created_at: string;
  updated_at: string;
}

/** The columns clients read, without sync's uid. */
export const ARTIFACT_COLUMNS = 'id, thread_id, path, name, kind, size, created_at, updated_at';

export const artifacts = {
  upsert(a: { thread_id: string; path: string; name: string; kind: string; size: number }) {
    return tx(() => {
      db.prepare(
        `INSERT INTO artifacts (uid, thread_id, path, name, kind, size) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).run(randomUUID(), a.thread_id, a.path, a.name, a.kind, a.size);
      const row = db.prepare(`SELECT ${ARTIFACT_COLUMNS}, uid FROM artifacts WHERE path = ?`).get(a.path) as unknown as Artifact & { uid: string };
      record('artifact', row.uid);
      const { uid: _uid, ...out } = row;
      return out as Artifact;
    });
  },
  byThread: (threadId: string) =>
    db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE thread_id = ? ORDER BY created_at`).all(threadId) as unknown as Artifact[],
  get: (id: number) => db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = ?`).get(id) as unknown as Artifact | undefined,
  uidOf: (id: number) => (db.prepare('SELECT uid FROM artifacts WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? null,
  recent: (limit = 60) =>
    db
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}, t.title AS thread_title, t.channel_id
         FROM artifacts a JOIN threads t ON t.id = a.thread_id
         WHERE a.kind != 'screenshot' ORDER BY a.updated_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as (Artifact & { thread_title: string; channel_id: string })[],
  remove: (path: string) =>
    tx(() => {
      const row = db.prepare('SELECT uid FROM artifacts WHERE path = ?').get(path) as { uid: string } | undefined;
      const res = db.prepare('DELETE FROM artifacts WHERE path = ?').run(path);
      if (row && res.changes) record('artifact', row.uid, 'delete');
      return res;
    }),
};
