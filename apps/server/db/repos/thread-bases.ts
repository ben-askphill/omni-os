import { db, now } from '../connection.ts';

import type { BaseHow } from '@omni/shared/changes.ts';

/**
 * How a thread's base commit was picked: `thread-start` is the commit its worktree was cut from, `merge-base` the
 * merge base of its checkout with the repo's default branch, for a thread that had none recorded.
 */
export type { BaseHow };

/** The commit a thread's changes are compared to (apps/server/changes.ts). Local to this Mac, not synced. */
export interface ThreadBase {
  thread_id: string;
  sha: string;
  /** The branch it was taken from, like `main` or `origin/main`, or `HEAD` when there was none. */
  ref: string;
  how: BaseHow;
  recorded_at: string;
}

export const threadBases = {
  get: (threadId: string) => db.prepare('SELECT * FROM thread_bases WHERE thread_id = ?').get(threadId) as unknown as ThreadBase | undefined,
  /** Record a base, replacing one that no longer exists in the repo. */
  set: (threadId: string, base: { sha: string; ref: string; how: BaseHow }): ThreadBase => {
    db.prepare(
      `INSERT INTO thread_bases (thread_id, sha, ref, how, recorded_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET sha = excluded.sha, ref = excluded.ref, how = excluded.how, recorded_at = excluded.recorded_at`,
    ).run(threadId, base.sha, base.ref, base.how, now());
    return threadBases.get(threadId)!;
  },
};
