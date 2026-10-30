import type { TurnState } from '@omni/shared/changes.ts';
import { db, now } from '../connection.ts';

/**
 * Where a turn's snapshots are. `running`: the turn is under way (its before snapshot is saved or being saved).
 * `capturing`: the turn ended and its after snapshot is being saved. `ready`: both are saved. `failed`: one could not
 * be, `error` says why. A failed snapshot never changes the turn's own Result.
 */
export type TurnSnapshotState = TurnState;

/** An untracked file a snapshot left out, and why: binary or too large to save. */
export interface SkippedFile {
  path: string;
  reason: 'binary' | 'too_large' | 'limit';
}

/** One turn's saved before/after snapshots (apps/server/turns.ts). Local to this Mac, not synced. */
export interface TurnSnapshot {
  /** The turn's identity, also in its hidden refs' names. */
  id: string;
  thread_id: string;
  /** Its place among the thread's turns on this Mac. */
  n: number;
  state: TurnSnapshotState;
  error: string | null;
  before_sha: string | null;
  before_head: string | null;
  before_skipped: string | null;
  after_sha: string | null;
  after_head: string | null;
  after_skipped: string | null;
  prior_n: number;
  /** The Result the turn ended with, when it left one. */
  completion_uid: string | null;
  started_at: string;
  ended_at: string | null;
  settled_at: string | null;
}

const get = (id: string) => db.prepare('SELECT * FROM turn_snapshots WHERE id = ?').get(id) as unknown as TurnSnapshot | undefined;

export const turnSnapshots = {
  get,
  /** A thread's turns, newest first. */
  forThread: (threadId: string, limit = 50) =>
    db.prepare('SELECT * FROM turn_snapshots WHERE thread_id = ? ORDER BY n DESC LIMIT ?').all(threadId, limit) as unknown as TurnSnapshot[],
  /** A turn starts: its row, before any snapshot is taken. */
  start(id: string, threadId: string, priorN: number): TurnSnapshot {
    db.prepare(
      `INSERT INTO turn_snapshots (id, thread_id, n, state, prior_n, started_at)
       VALUES (?, ?, COALESCE((SELECT MAX(n) FROM turn_snapshots WHERE thread_id = ?), 0) + 1, 'running', ?, ?)`,
    ).run(id, threadId, threadId, priorN, now());
    return get(id)!;
  },
  /** The before snapshot is saved. Only while the turn's row still waits for it: a late one never lands. */
  saveBefore: (id: string, snap: { sha: string; head: string; skipped: SkippedFile[] }) =>
    db
      .prepare(`UPDATE turn_snapshots SET before_sha = ?, before_head = ?, before_skipped = ? WHERE id = ? AND before_sha IS NULL AND state IN ('running','capturing')`)
      .run(snap.sha, snap.head, JSON.stringify(snap.skipped), id).changes > 0,
  /** The turn ended, with the Result it left if any. Its after snapshot is taken next, unless it failed already. */
  end: (id: string, completionUid: string | null) =>
    db
      .prepare(
        `UPDATE turn_snapshots SET ended_at = ?, completion_uid = ?, state = CASE state WHEN 'running' THEN 'capturing' ELSE state END
         WHERE id = ? AND ended_at IS NULL`,
      )
      .run(now(), completionUid, id).changes > 0,
  /** Both snapshots are saved. Only from `capturing`, so a stale capture cannot overwrite a settled turn. */
  saveAfter: (id: string, snap: { sha: string; head: string; skipped: SkippedFile[] }) =>
    db
      .prepare(
        `UPDATE turn_snapshots SET after_sha = ?, after_head = ?, after_skipped = ?, state = 'ready', settled_at = ?
         WHERE id = ? AND state = 'capturing' AND before_sha IS NOT NULL`,
      )
      .run(snap.sha, snap.head, JSON.stringify(snap.skipped), now(), id).changes > 0,
  /** A snapshot could not be saved. The first reason stays. */
  fail: (id: string, error: string) =>
    db
      .prepare(`UPDATE turn_snapshots SET state = 'failed', error = ?, settled_at = ? WHERE id = ? AND state IN ('running','capturing')`)
      .run(error, now(), id).changes > 0,
  /** At boot: turns a stopped server never finished saving. */
  failUnsettled: (error: string) =>
    Number(
      db.prepare(`UPDATE turn_snapshots SET state = 'failed', error = ?, settled_at = ? WHERE state IN ('running','capturing')`).run(error, now())
        .changes,
    ),
};
