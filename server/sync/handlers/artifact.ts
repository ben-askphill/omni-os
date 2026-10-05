import { isAbsolute, join, relative, sep } from 'node:path';
import { paths } from '../../config.ts';
import { ARTIFACT_COLUMNS, db, type Artifact } from '../../db.ts';
import { publishFeed, publishThread } from '../../bus.ts';
import { claim, registerHandler } from '../apply.ts';
import { fromPortable, safeRel, toRemote } from '../paths.ts';

// Artifacts: the metadata row, last writer wins, keyed by uid. The file itself travels separately. A path inside
// the threads folder goes relative to it ("<thread>/artifacts/x.html"), so it lands in this Mac's threads folder.

interface ArtifactData {
  uid: string;
  thread_id: string;
  /** Relative to the threads folder, or portable ("~/…") for a file outside it. */
  path: string;
  name: string;
  kind: string;
  size: number;
  /** Absent from a Mac on a version before published pages. */
  url?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

type Row = Artifact & { uid: string };
const byUid = (uid: string) => db.prepare(`SELECT ${ARTIFACT_COLUMNS}, uid FROM artifacts WHERE uid = ?`).get(uid) as unknown as Row | undefined;
const byPath = (path: string) => db.prepare(`SELECT ${ARTIFACT_COLUMNS}, uid FROM artifacts WHERE path = ?`).get(path) as unknown as Row | undefined;

function toShared(path: string) {
  const rel = relative(paths.threads, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : toRemote(path);
}

// A relative path is joined onto this Mac's threads folder only when every segment is a plain name. One with
// "..", a backslash or a NUL is refused. A path that already starts with "/" or "~" is outside that folder on
// purpose and stays portable.
const fromShared = (path: string): string | null => {
  if (path.startsWith('/') || path.startsWith('~')) return fromPortable(path);
  return safeRel(path) ? join(paths.threads, path) : null;
};

registerHandler('artifact', {
  serialize(uid) {
    const a = byUid(uid);
    return a ? ({ ...a, path: toShared(a.path) } satisfies ArtifactData) : null;
  },
  apply(change) {
    if (change.op === 'delete') {
      if (!claim(change)) return false;
      return db.prepare('DELETE FROM artifacts WHERE uid = ?').run(change.entity_id).changes > 0;
    }
    const a = change.data as ArtifactData;
    const path = fromShared(a.path);
    // A relative path names a file under the threads folder: one that would leave it is dropped, not retried.
    if (!path || !claim(change)) return false;
    const uid = change.entity_id;
    // The same file registered on both Macs under two uids (a watcher saw a synced file before its row came):
    // both keep the lower uid, so they agree without talking.
    const clash = byPath(path);
    if (clash && clash.uid !== uid) {
      if (clash.uid < uid) return false;
      db.prepare('UPDATE artifacts SET uid = ? WHERE id = ?').run(uid, clash.id);
    }
    const res = db
      .prepare(
        `UPDATE artifacts SET thread_id = ?, path = ?, name = ?, kind = ?, size = ?, url = COALESCE(?, url), description = COALESCE(?, description),
         created_at = ?, updated_at = ? WHERE uid = ?`,
      )
      .run(a.thread_id, path, a.name, a.kind, a.size, a.url ?? null, a.description ?? null, a.created_at, a.updated_at, uid);
    if (!res.changes) {
      db.prepare(
        'INSERT INTO artifacts (uid, thread_id, path, name, kind, size, url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(uid, a.thread_id, path, a.name, a.kind, a.size, a.url ?? null, a.description ?? null, a.created_at, a.updated_at);
    }
    return true;
  },
  notify(change) {
    if (change.op === 'delete') return;
    const row = byUid(change.entity_id);
    if (!row) return;
    const { uid: _uid, ...artifact } = row;
    publishThread(artifact.thread_id, { kind: 'artifact', artifact });
    publishFeed({ type: 'artifact', artifact });
  },
});
