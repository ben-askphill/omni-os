import { randomUUID } from 'node:crypto';
import { db, now, tx } from './connection.ts';

/** What the sync relay carries. Events, artifacts and automation runs are keyed by their uid, the rest by id or key. */
export type SyncEntity = 'channel' | 'thread' | 'event' | 'artifact' | 'automation_run' | 'kv';
export type SyncOp = 'upsert' | 'delete';

export interface OutboxRow {
  id: number;
  entity: SyncEntity;
  entity_id: string;
  op: SyncOp;
  ts: string;
}

// ---------- sync outbox ----------

/** Rows where the newest write wins. Events and automation runs are insert-only. */
const LWW = new Set<SyncEntity>(['channel', 'thread', 'kv', 'artifact']);
/** kv keys that stay on this machine: the sync cursor, machine id, switches and path map. */
export const localKey = (key: string) => key.startsWith('sync.');

/** This machine's sync id once sync was set up here. Until then nothing is recorded, so an Omni without sync writes no extra rows. */
let armedId: string | null = null;

/** Read the stored machine id once the kv table exists. server/db.ts calls this on import, after migrate. */
export function loadArmed() {
  const row = db.prepare(`SELECT value FROM kv WHERE key = 'sync.machine_id'`).get() as { value: string } | undefined;
  armedId = row?.value ?? null;
  if (armedId) armedId = JSON.parse(armedId) as string;
}

/** Note that a row changed. Call it inside the write's tx. Remote-applied changes never call it, so nothing echoes back. */
export function record(entity: SyncEntity, entityId: string, op: SyncOp = 'upsert') {
  if (!armedId) return;
  let ts = now();
  // A write here always comes after the last write the row took: in the same millisecond, or after one from a Mac
  // whose clock runs ahead. Otherwise the other Mac would keep the older value while this one shows the newer.
  const last = LWW.has(entity) ? syncMeta.get(entity, entityId)?.ts : undefined;
  if (last && ts <= last) ts = new Date(Date.parse(last) + 1).toISOString();
  db.prepare('INSERT INTO sync_outbox (entity, entity_id, op, ts) VALUES (?, ?, ?, ?)').run(entity, entityId, op, ts);
  if (LWW.has(entity)) syncMeta.set(entity, entityId, ts, armedId);
  onRecord?.();
}
let onRecord: (() => void) | null = null;

/**
 * The time a last-writer-wins row is queued with by the first arm: before any real write. A Mac joining later
 * seeds its built-in channels and kv too, and those are defaults, not edits newer than the other Mac's. A seeded
 * copy therefore loses to any write, and never replaces a row the receiving Mac already has (apply.ts claim).
 */
export const SEED_TS = '1970-01-01T00:00:00.000Z';

/** Queue every row there is, parents first, the first time sync is set up on this machine. */
function seed(machineId: string) {
  const ts = now();
  const q = (entity: SyncEntity, select: string) =>
    db
      .prepare(`INSERT INTO sync_outbox (entity, entity_id, op, ts) SELECT '${entity}', k, 'upsert', ? FROM (${select})`)
      .run(LWW.has(entity) ? SEED_TS : ts);
  q('channel', 'SELECT id AS k FROM channels ORDER BY created_at, rowid');
  q('thread', 'SELECT id AS k FROM threads ORDER BY created_at, rowid');
  q('event', 'SELECT uid AS k FROM events ORDER BY id');
  q('artifact', 'SELECT uid AS k FROM artifacts ORDER BY id');
  q('automation_run', 'SELECT uid AS k FROM automation_runs ORDER BY id');
  q('kv', `SELECT key AS k FROM kv WHERE key NOT LIKE 'sync.%' ORDER BY key`);
  db.prepare(
    `INSERT OR REPLACE INTO sync_meta (entity, entity_id, ts, machine_id)
     SELECT entity, entity_id, ts, ? FROM sync_outbox WHERE entity IN ('channel', 'thread', 'kv', 'artifact')`,
  ).run(machineId);
}

/** The same read as kv.get. Inlined so this module does not import kv, which records through here. */
function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export const outbox = {
  /** This machine's sync id, or null when sync was never set up here. */
  machineId: () => armedId,
  /**
   * Turn recording on for good and return this machine's id: the stored one, else `machineId`, else a new uuid.
   * The first arm also queues the existing history. server/sync/worker.ts calls it; nothing else should.
   * `hardware` (server/sync/hardware.ts) is stored with it. A stored one that differs means this data folder was
   * copied from another Mac, which still has that id: this one takes a new id, and pulls and seeds again from the
   * start, as a first arm does, so neither Mac skips the other's changes as its own.
   */
  arm(machineId?: string, hardware?: string | null): string {
    return tx(() => {
      const setLocal = (key: string, value: unknown) =>
        db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
      const stored = kvGet<string>('sync.hardware_id');
      if (hardware && stored !== hardware) setLocal('sync.hardware_id', hardware);
      if (armedId && !(hardware && stored && stored !== hardware)) return armedId;
      const moved = !!armedId;
      const id = moved ? randomUUID() : (machineId ?? randomUUID());
      setLocal('sync.machine_id', id);
      if (moved) {
        // The copy's queue and parked changes were the other Mac's to send and apply. Seeded rows (SEED_TS) only
        // fill gaps over there, so nothing here overwrites what that Mac has; everything it has comes back here.
        setLocal('sync.cursor', 0);
        db.exec('DELETE FROM sync_outbox; DELETE FROM sync_deferred');
      }
      // A thread mid-run as sync is set up is this machine's run, and its row should say so.
      db.prepare(`UPDATE threads SET run_machine = ? WHERE status IN ('running','queued') AND run_machine IS NULL`).run(id);
      seed(id);
      armedId = id;
      return id;
    });
  },
  /** The oldest queued changes for these entities. Rows for other entities wait until a handler exists. */
  pending(limit: number, entities: readonly SyncEntity[]): OutboxRow[] {
    return db
      .prepare(`SELECT * FROM sync_outbox WHERE entity IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT ?`)
      .all(JSON.stringify(entities), limit) as unknown as OutboxRow[];
  },
  /** Called after each recorded write, so the worker can push soon. Only schedule work in it: it runs inside the write's tx. */
  onRecord(fn: (() => void) | null) {
    onRecord = fn;
  },
  /**
   * Queue a row again after a remote change was applied to it, for a handler that kept part of the row as this
   * machine has it: the other machines then get the row as it is here, with a newer ts. Call it inside apply.
   */
  requeue(entity: SyncEntity, entityId: string) {
    record(entity, entityId);
  },
  /** Drop rows the relay took. */
  ack(ids: readonly number[]) {
    db.prepare('DELETE FROM sync_outbox WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
  },
  /** Rows waiting for these entities, and rows held for entities with no handler. */
  counts(entities: readonly SyncEntity[]): { pending: number; held: number } {
    return db
      .prepare(
        `SELECT COALESCE(SUM(entity IN (SELECT value FROM json_each(?1))), 0) AS pending,
                COALESCE(SUM(entity NOT IN (SELECT value FROM json_each(?1))), 0) AS held FROM sync_outbox`,
      )
      .get(JSON.stringify(entities)) as { pending: number; held: number };
  },
};

/** Last writer per last-writer-wins row. server/sync/apply.ts compares a remote change against it. */
export const syncMeta = {
  get: (entity: SyncEntity, entityId: string) =>
    db.prepare('SELECT ts, machine_id FROM sync_meta WHERE entity = ? AND entity_id = ?').get(entity, entityId) as
      | { ts: string; machine_id: string }
      | undefined,
  set: (entity: SyncEntity, entityId: string, ts: string, machineId: string) =>
    db
      .prepare(
        `INSERT INTO sync_meta (entity, entity_id, ts, machine_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity, entity_id) DO UPDATE SET ts = excluded.ts, machine_id = excluded.machine_id`,
      )
      .run(entity, entityId, ts, machineId),
};
