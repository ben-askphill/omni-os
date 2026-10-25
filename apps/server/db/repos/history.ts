import { db } from '../connection.ts';
import { EVENT_COLUMNS, type EventRow } from './events.ts';

// The reads behind bounded thread history (apps/server/history.ts, docs/internals/thread-history.md). Every one is a
// keyset read on an index, bounded by a LIMIT or by the few rows it names; tests/history-budget.test.ts runs EXPLAIN
// QUERY PLAN on each. Kinds are literals, never parameters: SQLite only uses a partial index it can prove matches.

/** A row as a page reads it: its payload only when it fits rowBytes, else null (read by id if the page keeps it). */
export interface Probe {
  id: number;
  thread_id: string;
  kind: string;
  created_at: string;
  /** The stored payload's size, read from the record header. */
  bytes: number;
  payload: string | null;
}

/** Exclusive id bounds, like the stream's `after`. */
export interface Bounds {
  after?: number;
  before?: number;
}

const PROBE = `SELECT id, thread_id, kind, created_at, octet_length(payload) AS bytes,
  CASE WHEN octet_length(payload) <= ? THEN payload END AS payload
  FROM events WHERE thread_id = ? AND id > ? AND id < ?`;
const ids = (n: number) => Array(n).fill('?').join(', ');

/** Every statement, by name. The plan test reads them from here. */
export const HISTORY_SQL = {
  newest: `${PROBE} ORDER BY id DESC LIMIT ?`,
  oldest: `${PROBE} ORDER BY id LIMIT ?`,
  payload: 'SELECT payload FROM events WHERE id = ?',
  turnStart: `SELECT id FROM events WHERE thread_id = ? AND kind = 'result' AND id > ? AND id < ? ORDER BY id DESC LIMIT 1`,
  resultsBelow: `SELECT COUNT(*) AS n FROM events WHERE thread_id = ? AND kind = 'result' AND id < ?`,
  initBelow: `SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind = 'init' AND id < ? ORDER BY id DESC LIMIT 1`,
  resultBelow: `SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind = 'result' AND id < ? ORDER BY id DESC LIMIT 1`,
  calls: (n: number) =>
    `SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind = 'tool_use' AND json_extract(payload, '$.id') IN (${ids(n)})`,
  answers: (n: number) =>
    `SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind = 'question_answer' AND json_extract(payload, '$.id') IN (${ids(n)})`,
  row: `SELECT ${EVENT_COLUMNS} FROM events WHERE id = ? AND thread_id = ?`,
  has: 'SELECT 1 FROM events WHERE id = ? AND thread_id = ?',
} as const;

const NO_END = Number.MAX_SAFE_INTEGER;

/**
 * The newest row per json `$.id`, ascending: what the fold's lookup by id ends up holding. Sorted here, since an
 * ORDER BY id would steer SQLite to events_thread and read the whole thread.
 */
function newestById(rows: EventRow[]): EventRow[] {
  const byId = new Map<string, EventRow>();
  for (const r of rows) {
    const id = (JSON.parse(r.payload) as { id?: unknown }).id;
    if (typeof id === 'string' && r.id > (byId.get(id)?.id ?? 0)) byId.set(id, r);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export const history = {
  /** Up to `limit` rows in (after, before), newest first. */
  newest: (threadId: string, b: Bounds, limit: number, rowBytes: number) =>
    db.prepare(HISTORY_SQL.newest).all(rowBytes, threadId, b.after ?? 0, b.before ?? NO_END, limit) as unknown as Probe[],
  /** Up to `limit` rows in (after, before), oldest first. */
  oldest: (threadId: string, b: Bounds, limit: number, rowBytes: number) =>
    db.prepare(HISTORY_SQL.oldest).all(rowBytes, threadId, b.after ?? 0, b.before ?? NO_END, limit) as unknown as Probe[],
  /** A row's payload, by id: an oversized row a page keeps. */
  payload: (id: number) => (db.prepare(HISTORY_SQL.payload).get(id) as { payload: string }).payload,
  /** The newest result with after < id < at: the end of the turn before the one holding `at`. */
  turnStart: (threadId: string, at: number, after = 0) =>
    (db.prepare(HISTORY_SQL.turnStart).get(threadId, after, at) as { id: number } | undefined)?.id ?? null,
  /** Results under `id`: the turns a head does not hold. */
  resultsBelow: (threadId: string, id: number) =>
    (db.prepare(HISTORY_SQL.resultsBelow).get(threadId, id) as { n: number }).n,
  /** The newest `init` or `result` under `id`. */
  latestBelow: (threadId: string, kind: 'init' | 'result', id: number) =>
    (db.prepare(kind === 'init' ? HISTORY_SQL.initBelow : HISTORY_SQL.resultBelow).get(threadId, id) as EventRow | undefined) ?? null,
  /** The tool_use rows of these calls, newest per call, ascending. */
  calls(threadId: string, callIds: readonly string[]): EventRow[] {
    if (!callIds.length) return [];
    return newestById(db.prepare(HISTORY_SQL.calls(callIds.length)).all(threadId, ...callIds) as unknown as EventRow[]);
  },
  /** The question_answer rows of these questions, newest per question, ascending. */
  answers(threadId: string, questionIds: readonly string[]): EventRow[] {
    if (!questionIds.length) return [];
    return newestById(db.prepare(HISTORY_SQL.answers(questionIds.length)).all(threadId, ...questionIds) as unknown as EventRow[]);
  },
  /** One whole row of the thread, null when the id is another thread's or none. */
  row: (threadId: string, id: number) => (db.prepare(HISTORY_SQL.row).get(id, threadId) as EventRow | undefined) ?? null,
  /** Whether the thread has this event, without reading it. */
  has: (threadId: string, id: number) => !!db.prepare(HISTORY_SQL.has).get(id, threadId),
};
