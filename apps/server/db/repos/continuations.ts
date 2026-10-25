import type { CarryoverP } from '../../carryover.ts';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';
import { THREAD_COLUMNS, type Thread } from './threads.ts';

// Continued threads (apps/server/continue.ts). The link to the source is the continued thread's own `continued_from`,
// synced with its row; the source is never written. What cut its worktree and the client's request id are this Mac's,
// in thread_continuations.

export interface Continuation {
  thread_id: string;
  source_id: string;
  /** The client's id for the start: a retry with it gets this thread back. */
  request_id: string;
  /** What was asked (the message and the run), hashed: a retry must match it. */
  fingerprint: string;
  /** The source's HEAD when it was captured: the new branch starts there. Null for folder work. */
  head: string | null;
  /** The source's snapshot tree, laid into the new worktree uncommitted. Null unless the source had a worktree of its own. */
  tree: string | null;
  /** `tree` committed on `head`, kept under refs/omni/continue/<thread>, once setup made it. */
  snapshot_sha: string | null;
  /** When the snapshot reached the new worktree. Nothing touches the worktree after. */
  applied_at: string | null;
  created_at: string;
}

export const continuations = {
  get: (threadId: string) => db.prepare('SELECT * FROM thread_continuations WHERE thread_id = ?').get(threadId) as unknown as Continuation | undefined,
  byRequest: (sourceId: string, requestId: string) =>
    db.prepare('SELECT * FROM thread_continuations WHERE source_id = ? AND request_id = ?').get(sourceId, requestId) as unknown as Continuation | undefined,
  add(c: Pick<Continuation, 'thread_id' | 'source_id' | 'request_id' | 'fingerprint' | 'head' | 'tree'>) {
    db.prepare('INSERT INTO thread_continuations (thread_id, source_id, request_id, fingerprint, head, tree, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      c.thread_id, c.source_id, c.request_id, c.fingerprint, c.head, c.tree, now(),
    );
  },
  setSnapshot: (threadId: string, sha: string) => db.prepare('UPDATE thread_continuations SET snapshot_sha = ? WHERE thread_id = ?').run(sha, threadId),
  applied: (threadId: string) => db.prepare('UPDATE thread_continuations SET applied_at = ? WHERE thread_id = ? AND applied_at IS NULL').run(now(), threadId),
  /** Name the thread a new one continues. The row syncs with it. */
  link(threadId: string, sourceId: string) {
    tx(() => {
      if (db.prepare('UPDATE threads SET continued_from = ? WHERE id = ?').run(sourceId, threadId).changes) record('thread', threadId);
    });
  },
  /** The threads continued from this one, oldest first. */
  continuedIn: (sourceId: string) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE continued_from = ? ORDER BY created_at, id`).all(sourceId) as unknown as Thread[],
  /** The payload of the thread's Carryover event, if it is a continued thread. */
  carryover(threadId: string): CarryoverP | null {
    const row = db.prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'carryover' ORDER BY id LIMIT 1`).get(threadId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  },
  /** Messages the runner holds for the thread or is about to take (db/repos/requests.ts): they would run in it. */
  liveRequests: (threadId: string) =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM message_requests WHERE thread_id = ? AND state IN ('accepted', 'waiting', 'held', 'sent')`).get(threadId) as { n: number }).n,
    ),
  /** One of the thread's events by its uid, which names the same event on every Mac. */
  eventId: (threadId: string, uid: string) =>
    (db.prepare('SELECT id FROM events WHERE thread_id = ? AND uid = ?').get(threadId, uid) as { id: number } | undefined)?.id ?? null,
};
