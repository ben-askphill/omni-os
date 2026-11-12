// Keeps the change log from growing without end. Every handler on a machine applies a change as the whole row it
// names (last writer wins, or insert once by uid), so of all the rows one machine pushed for one item, only its
// newest still matters: an older row is superseded by a later one with a higher seq, which a machine pulling after
// any cursor still gets. Rows are kept per machine, not per item, so last-writer-wins across machines decides the
// same way it did before the older rows went.
//
// Two parts:
// - compactStep: a one-time pass over a log that already grew, scanning down from the newest row in steps. The
//   Durable Object runs a few steps per alarm (maintain.ts) and resumes from a saved cursor: one unbounded loop
//   runs past the object's CPU limit, which resets it and fails every request it was serving.
// - prune (RelayStore.push, once the index exists): deletes the superseded rows as each push lands, so the log stays
//   at one row per item per machine.
// The change data in R2 is not deleted here: a batch object is shared by every row of one push, and R2 is not what
// hit the cap.
import type { Sql } from './store.ts';

/** The index prune and compaction look rows up by. Created only after compaction, when the database has room. */
export const KEY_INDEX = 'changes_key';

export const key = (machine: string, entity: string, entityId: string) => JSON.stringify([machine, entity, entityId]);

/** Rows scanned per compaction step. */
export const COMPACT_STEP_ROWS = 5000;

/**
 * Items remembered at most, so `seen` fits in a Durable Object's memory however many items the log holds. Past it
 * the set starts over: an item then keeps one more older row, which is space, never a wrong answer.
 */
export const SEEN_MAX = 200_000;

/**
 * The items that already have a row at or above `from`, newest first, up to `max`: their older rows are superseded.
 * Rebuilds a lost step's state. Reads in steps, so a long log never comes back as one result.
 */
export function keysFrom(sql: Sql, from: number, max = SEEN_MAX, stepRows = COMPACT_STEP_ROWS): Set<string> {
  const seen = new Set<string>();
  for (let below = topCursor(sql); seen.size < max; ) {
    const rows = sql
      .exec('SELECT seq, machine_id, entity, entity_id FROM changes WHERE seq >= ? AND seq < ? ORDER BY seq DESC LIMIT ?', from, below, stepRows)
      .toArray() as { seq: number; machine_id: string; entity: string; entity_id: string }[];
    if (!rows.length) break;
    for (const r of rows) seen.add(key(r.machine_id, r.entity, r.entity_id));
    below = Number(rows[rows.length - 1].seq);
  }
  return seen;
}

/**
 * One step: the rows below `below`, newest first, up to `maxRows`. A row whose item already has a newer row from the
 * same machine (in `seen`) is deleted; the others join `seen`. Returns the lowest seq scanned, the cursor for the
 * next step, or null when no row is left below `below`. Safe to stop after any step and resume with keysFrom(cursor).
 */
export function compactStep(
  sql: Sql,
  transaction: <T>(fn: () => T) => T,
  below: number,
  seen: Set<string>,
  maxRows = COMPACT_STEP_ROWS,
  maxSeen = SEEN_MAX,
): { next: number | null; removed: number } {
  if (seen.size >= maxSeen) seen.clear();
  const rows = sql
    .exec('SELECT seq, machine_id, entity, entity_id FROM changes WHERE seq < ? ORDER BY seq DESC LIMIT ?', below, maxRows)
    .toArray() as { seq: number; machine_id: string; entity: string; entity_id: string }[];
  if (!rows.length) return { next: null, removed: 0 };
  const stale: number[] = [];
  for (const r of rows) {
    const k = key(r.machine_id, r.entity, r.entity_id);
    if (seen.has(k)) stale.push(Number(r.seq));
    else seen.add(k);
  }
  transaction(() => {
    for (const seq of stale) sql.exec('DELETE FROM changes WHERE seq = ?', seq);
  });
  return { next: Number(rows[rows.length - 1].seq), removed: stale.length };
}

/** The highest seq in the log plus one: where a fresh compaction starts. */
export function topCursor(sql: Sql): number {
  const [row] = sql.exec('SELECT COALESCE(MAX(seq), 0) + 1 AS top FROM changes').toArray() as { top: number }[];
  return Number(row.top);
}

/** Create the lookup index prune needs. Throws when the database has no room for it. */
export function createKeyIndex(sql: Sql) {
  sql.exec(`CREATE INDEX IF NOT EXISTS ${KEY_INDEX} ON changes (machine_id, entity, entity_id, seq)`);
}
