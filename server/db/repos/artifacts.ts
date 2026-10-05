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
  /** The claude.ai page this file was published as, if it was. */
  url: string | null;
  /** What the publish said the page is. */
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** The columns clients read, without sync's uid. */
export const ARTIFACT_COLUMNS = 'id, thread_id, path, name, kind, size, url, description, created_at, updated_at';

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
  /** Mark a file as published at `url`. Bumps updated_at, since a republish is a new version of the page. */
  setPublished(id: number, url: string, description: string | null) {
    return tx(() => {
      db.prepare(
        `UPDATE artifacts SET url = ?, description = COALESCE(?, description), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      ).run(url, description, id);
      const row = db.prepare(`SELECT ${ARTIFACT_COLUMNS}, uid FROM artifacts WHERE id = ?`).get(id) as unknown as (Artifact & { uid: string }) | undefined;
      if (!row) return undefined;
      record('artifact', row.uid);
      const { uid: _uid, ...out } = row;
      return out as Artifact;
    });
  },
  /** The latest file per published page, newest first: in one channel, or everywhere. */
  published(channelId?: string, limit = 20) {
    const cols = ARTIFACT_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ');
    return db
      .prepare(
        `SELECT ${cols}, t.title AS thread_title, t.channel_id FROM artifacts a JOIN threads t ON t.id = a.thread_id
         WHERE a.url IS NOT NULL AND (? IS NULL OR t.channel_id = ?)
           AND a.id = (SELECT b.id FROM artifacts b WHERE b.url = a.url ORDER BY b.updated_at DESC, b.id DESC LIMIT 1)
         ORDER BY a.updated_at DESC LIMIT ?`,
      )
      .all(channelId ?? null, channelId ?? null, limit) as unknown as (Artifact & { thread_title: string; channel_id: string })[];
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
