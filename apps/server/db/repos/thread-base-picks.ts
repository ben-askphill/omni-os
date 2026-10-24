import type { BasePick } from '@omni/shared/worktree-base.ts';
import { db } from '../connection.ts';

/**
 * What Ben chose as a new worktree thread's base (apps/server/worktree-base.ts), kept until the choice is resolved to
 * a commit in thread_bases, so Retry resolves the same choice. A thread with no row started from the repo's HEAD.
 * Local to this Mac, like its worktree.
 */
export const threadBasePicks = {
  get: (threadId: string): BasePick | undefined => {
    const row = db.prepare('SELECT pick FROM thread_base_picks WHERE thread_id = ?').get(threadId) as { pick: string } | undefined;
    return row ? (JSON.parse(row.pick) as BasePick) : undefined;
  },
  set: (threadId: string, pick: BasePick) => {
    db.prepare('INSERT OR REPLACE INTO thread_base_picks (thread_id, pick) VALUES (?, ?)').run(threadId, JSON.stringify(pick));
  },
};
