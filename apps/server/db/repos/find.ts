import { findHits, likePattern, likeSafe, type FindAnswer } from '@omni/shared/thread-find.ts';
import { db } from '../connection.ts';

// Find in a thread (packages/shared/thread-find.ts): every row of the kinds a find looks in, read in id order on
// events_thread and matched in JS, so the count is the same pattern the Web UI highlights. A query LIKE can match the
// way the pattern does narrows the read first; any other (a quote, a backslash, a letter outside ASCII) reads them all.
// Kinds are literals, never parameters, like the history reads.

const KINDS = `kind IN ('user', 'assistant_text', 'crew_report', 'error', 'tool_use', 'tool_result')`;

export const FIND_SQL = {
  all: `SELECT id, kind, payload FROM events WHERE thread_id = ? AND ${KINDS} ORDER BY id`,
  like: `SELECT id, kind, payload FROM events WHERE thread_id = ? AND ${KINDS} AND payload LIKE ? ESCAPE '\\' ORDER BY id`,
} as const;

type Row = { id: number; kind: string; payload: string };

/** The matches of `q` in a thread, every event it ever had: held by a client or not, shown or folded away. */
export function findInThread(threadId: string, q: string): FindAnswer {
  const t = q.trim();
  const rows = likeSafe(t)
    ? (db.prepare(FIND_SQL.like).iterate(threadId, likePattern(t)) as Iterable<Row>)
    : (db.prepare(FIND_SQL.all).iterate(threadId) as Iterable<Row>);
  return findHits(rows, t);
}
