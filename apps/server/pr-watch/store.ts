// The pr_watches and pr_watch_events tables (db/migrate.ts): a thread's watch, what it last saw, and every event
// it woke the thread for. Local to this Mac, like the durable requests its wakes become.
import { db, tx } from '../db.ts';
import type { PRWatchChecks, PRWatchStop, PRWatchView } from '@omni/shared/pr-watch.ts';

/** How often one watch may wake its thread before it stops itself, so a fix-push-fail loop ends. */
export const MAX_WAKES = 5;

/** A watch as the worker reads it: the view plus its poll bookkeeping. */
export interface PRWatchRow extends Omit<PRWatchView, 'max_wakes'> {
  /** Polls that failed in a row. */
  failures: number;
  /** Seconds to the next poll after a good one; grows while nothing changes. */
  interval_s: number;
  /** The Mac that polls it. Null before sync is set up. */
  machine_id: string | null;
}

type Raw = Omit<PRWatchRow, 'checks'> & { checks: string | null };
const parse = (r: Raw | undefined): PRWatchRow | null => (r ? { ...r, checks: r.checks ? (JSON.parse(r.checks) as PRWatchChecks) : null } : null);
const one = (threadId: string) => parse(db.prepare('SELECT * FROM pr_watches WHERE thread_id = ?').get(threadId) as Raw | undefined);

export const view = (r: PRWatchRow): PRWatchView => {
  const { failures: _f, interval_s: _i, machine_id: _m, ...rest } = r;
  return { ...rest, max_wakes: MAX_WAKES };
};

export interface WatchEventMark {
  source: string;
  key: string;
}

export const prWatches = {
  get: one,
  all: () => (db.prepare('SELECT * FROM pr_watches ORDER BY updated_at DESC').all() as unknown as Raw[]).map((r) => parse(r)!),
  /** Watches this Mac polls whose next poll is due. */
  due: (at: string, machineId: string | null) =>
    (
      db
        .prepare(`SELECT * FROM pr_watches WHERE state = 'watching' AND next_poll_at <= ? AND (machine_id IS NULL OR machine_id = ?) ORDER BY next_poll_at`)
        .all(at, machineId ?? '') as unknown as Raw[]
    ).map((r) => parse(r)!),
  /**
   * Start, or start again, a thread's watch on a PR: polled at once, with its wake budget and failures reset. Events
   * it already woke the thread for stay recorded, so starting again never repeats one.
   */
  start(threadId: string, repo: string, number: number, machineId: string | null, intervalS: number, at: string) {
    return tx(() => {
      const had = one(threadId);
      const samePR = had?.repo === repo && had.number === number;
      db.prepare(
        `INSERT INTO pr_watches (thread_id, repo, number, state, stop_reason, head_sha, checks, wakes, failures, interval_s, error, machine_id, next_poll_at, created_at, updated_at)
         VALUES (?, ?, ?, 'watching', NULL, NULL, NULL, 0, 0, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET repo = excluded.repo, number = excluded.number, state = 'watching', stop_reason = NULL,
           head_sha = ${samePR ? 'head_sha' : 'NULL'}, checks = ${samePR ? 'checks' : 'NULL'}, wakes = 0, failures = 0,
           interval_s = excluded.interval_s, error = NULL, machine_id = excluded.machine_id, next_poll_at = excluded.next_poll_at, updated_at = excluded.updated_at`,
      ).run(threadId, repo, number, intervalS, machineId, at, at, at);
      return one(threadId)!;
    });
  },
  /** Stop a watch that is still polling. Null when there was none to stop. */
  stop(threadId: string, reason: PRWatchStop, at: string) {
    const n = db
      .prepare(`UPDATE pr_watches SET state = 'stopped', stop_reason = ?, next_poll_at = NULL, updated_at = ? WHERE thread_id = ? AND state = 'watching'`)
      .run(reason, at, threadId).changes;
    return n ? one(threadId) : null;
  },
  /** A good poll: what it saw and when to look again. */
  observed(threadId: string, o: { head_sha: string; checks: PRWatchChecks; interval_s: number; next_poll_at: string; at: string }) {
    db.prepare(
      `UPDATE pr_watches SET head_sha = ?, checks = ?, failures = 0, error = NULL, interval_s = ?, last_polled_at = ?, next_poll_at = ?, updated_at = ?
       WHERE thread_id = ? AND state = 'watching'`,
    ).run(o.head_sha, JSON.stringify(o.checks), o.interval_s, o.at, o.next_poll_at, o.at, threadId);
  },
  /** A poll that failed. `counts` is false for a rate limit, which waits without spending the failure budget. */
  failed(threadId: string, error: string, counts: boolean, nextPollAt: string, at: string) {
    db.prepare(
      `UPDATE pr_watches SET failures = failures + ?, error = ?, last_polled_at = ?, next_poll_at = ?, updated_at = ? WHERE thread_id = ? AND state = 'watching'`,
    ).run(counts ? 1 : 0, error, at, nextPollAt, at, threadId);
    return one(threadId)!;
  },
  /** The events among `keys` this watch already woke its thread for. */
  seen(threadId: string, keys: string[]): Set<string> {
    if (!keys.length) return new Set();
    const rows = db
      .prepare(`SELECT key FROM pr_watch_events WHERE thread_id = ? AND key IN (${keys.map(() => '?').join(',')})`)
      .all(threadId, ...keys) as { key: string }[];
    return new Set(rows.map((r) => r.key));
  },
  /** The thread was woken for these events by request `requestId`. Run inside the tx that saved the request. */
  woke(threadId: string, events: WatchEventMark[], requestId: string, at: string) {
    const add = db.prepare('INSERT OR IGNORE INTO pr_watch_events (thread_id, key, source, request_id, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const e of events) add.run(threadId, e.key, e.source, requestId, at);
    db.prepare(
      `UPDATE pr_watches SET wakes = wakes + 1, last_wake_at = ?, updated_at = ?,
         state = CASE WHEN wakes + 1 >= ? THEN 'stopped' ELSE state END,
         stop_reason = CASE WHEN wakes + 1 >= ? THEN 'wake_limit' ELSE stop_reason END,
         next_poll_at = CASE WHEN wakes + 1 >= ? THEN NULL ELSE next_poll_at END
       WHERE thread_id = ?`,
    ).run(at, at, MAX_WAKES, MAX_WAKES, MAX_WAKES, threadId);
  },
};
