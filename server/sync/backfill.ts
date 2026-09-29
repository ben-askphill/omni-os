import { db, outbox, tx, type SyncEntity } from '../db.ts';

// Queue every existing row for the relay again: after moving to a new Supabase project, or when the relay lost
// history. The first sync on a machine already queues everything (outbox.arm); this is for later.
// Idempotent: a row with an upsert already waiting is left alone, so running it twice queues nothing new.

export interface BackfillCount {
  entity: SyncEntity;
  /** Rows the table has. */
  total: number;
  /** Newly queued. */
  queued: number;
  /** Already waiting in the outbox. */
  alreadyQueued: number;
  /** Last written by another machine, which sends its own writes. */
  elsewhere: number;
}

/** Each table's rows as (k, o1, o2), k the sync entity id and o1, o2 the order: parents first, oldest first. */
const SOURCES: [SyncEntity, string][] = [
  ['channel', 'SELECT id AS k, created_at AS o1, rowid AS o2 FROM channels'],
  ['thread', 'SELECT id AS k, created_at AS o1, rowid AS o2 FROM threads'],
  ['event', 'SELECT uid AS k, id AS o1, 0 AS o2 FROM events'],
  ['artifact', 'SELECT uid AS k, id AS o1, 0 AS o2 FROM artifacts'],
  ['automation_run', 'SELECT uid AS k, id AS o1, 0 AS o2 FROM automation_runs'],
  ['kv', `SELECT key AS k, key AS o1, 0 AS o2 FROM kv WHERE key NOT LIKE 'sync.%'`],
];

/**
 * Queue every row this machine may send. A last-writer-wins row keeps the time of its last write, so it never
 * wins over a newer write on the other Mac. A row whose last writer is another machine is left to that machine.
 * Throws when sync was never set up here.
 */
export function backfill(opts: { onProgress?: (count: BackfillCount) => void } = {}): BackfillCount[] {
  const self = outbox.machineId();
  if (!self) throw new Error('sync is not set up on this machine: sign in from Settings, Sync first');
  const now = new Date().toISOString();
  const out: BackfillCount[] = [];
  for (const [entity, select] of SOURCES) {
    const count = tx(() => {
      const from = `FROM (${select}) s LEFT JOIN sync_meta m ON m.entity = :entity AND m.entity_id = s.k`;
      const mine = '(m.machine_id IS NULL OR m.machine_id = :self)';
      const waiting = `EXISTS (SELECT 1 FROM sync_outbox o WHERE o.entity = :entity AND o.entity_id = s.k AND o.op = 'upsert')`;
      const before = db
        .prepare(
          `SELECT COUNT(*) AS total, COALESCE(SUM(NOT ${mine}), 0) AS elsewhere, COALESCE(SUM(${mine} AND ${waiting}), 0) AS alreadyQueued ${from}`,
        )
        .get({ entity, self }) as { total: number; elsewhere: number; alreadyQueued: number };
      const last = (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM sync_outbox').get() as { id: number }).id;
      const res = db
        .prepare(
          `INSERT INTO sync_outbox (entity, entity_id, op, ts)
           SELECT :entity, s.k, 'upsert', COALESCE(m.ts, :now) ${from}
           WHERE s.k IS NOT NULL AND ${mine} AND NOT ${waiting} ORDER BY s.o1, s.o2`,
        )
        .run({ entity, self, now });
      // A row no machine has claimed yet is this one's now, as a write through the repos would record.
      db.prepare(
        `INSERT OR IGNORE INTO sync_meta (entity, entity_id, ts, machine_id)
         SELECT entity, entity_id, ts, :self FROM sync_outbox WHERE id > :last AND entity IN ('channel', 'thread', 'kv', 'artifact')`,
      ).run({ self, last });
      return { entity, ...before, queued: Number(res.changes) };
    });
    out.push(count);
    opts.onProgress?.(count);
  }
  return out;
}
