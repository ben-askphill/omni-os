import { db, syncMeta, tx, type SyncEntity } from '../db.ts';
import type { RemoteChange } from './transport.ts';

// Remote changes into the local db. Each entity has a handler; server/sync/handlers/ registers them.
// Handlers write with plain SQL, never through the db.ts repos, so an applied change is not queued to go back out.

export interface ApplyContext {
  /** This machine's sync id. */
  machineId: string;
}

export interface SyncHandler {
  /** The change data for a local row the outbox names, or null when the row is gone (the change is dropped). */
  serialize(entityId: string): unknown;
  /**
   * Write a remote change. Runs inside a transaction with the rest of its bookkeeping. Return false when it
   * changed nothing (older, or already here). Throw to defer it, for instance when a row it refers to is missing.
   */
  apply(change: RemoteChange, ctx: ApplyContext): boolean;
  /** After the transaction commits, for an applied change: tell open clients (bus.ts). */
  notify?(change: RemoteChange): void;
}

export type ApplyOutcome = 'applied' | 'skipped' | 'deferred';

export interface ApplyStats {
  applied: number;
  skipped: number;
  deferred: number;
}

const handlers = new Map<SyncEntity, SyncHandler>();

/** Add or replace the handler for an entity. Pushes and pulls for that entity start with the next sync. */
export function registerHandler(entity: SyncEntity, handler: SyncHandler) {
  handlers.set(entity, handler);
}

export const getHandler = (entity: SyncEntity) => handlers.get(entity);
export const registeredEntities = (): SyncEntity[] => [...handlers.keys()];

/** True when (ts, machine) is later than (ts2, machine2): time first, machine id breaks a tie. */
export const later = (ts: string, machine: string, ts2: string, machine2: string) =>
  ts > ts2 || (ts === ts2 && machine > machine2);

/**
 * Last-writer-wins gate for a handler: true when the change is newer than the last write this row took,
 * local or remote, and records it as the last write. Call it inside apply, before writing.
 */
export function claim(change: RemoteChange): boolean {
  const last = syncMeta.get(change.entity, change.entity_id);
  if (last && !later(change.ts, change.machine_id, last.ts, last.machine_id)) return false;
  syncMeta.set(change.entity, change.entity_id, change.ts, change.machine_id);
  return true;
}

function defer(change: RemoteChange, err: unknown) {
  db.prepare(
    `INSERT INTO sync_deferred (seq, change, error) VALUES (?, ?, ?)
     ON CONFLICT(seq) DO UPDATE SET error = excluded.error, tries = tries + 1`,
  ).run(change.seq, JSON.stringify(change), (err as Error)?.message ?? String(err));
}

/** Apply one remote change. A change that fails is kept in sync_deferred and retried, never lost or fatal. */
export function applyChange(change: RemoteChange, ctx: ApplyContext): ApplyOutcome {
  const handler = handlers.get(change.entity);
  let applied: boolean;
  try {
    if (!handler) throw new Error(`no handler for ${change.entity}`);
    applied = tx(() => {
      const ok = handler.apply(change, ctx);
      db.prepare('DELETE FROM sync_deferred WHERE seq = ?').run(change.seq);
      return ok;
    });
  } catch (err) {
    defer(change, err);
    return 'deferred';
  }
  if (applied) {
    try {
      handler.notify?.(change);
    } catch (err) {
      console.error(`[sync] notify for ${change.entity} failed:`, (err as Error).message);
    }
  }
  return applied ? 'applied' : 'skipped';
}

export function applyBatch(changes: RemoteChange[], ctx: ApplyContext): ApplyStats {
  const stats: ApplyStats = { applied: 0, skipped: 0, deferred: 0 };
  for (const c of changes) stats[applyChange(c, ctx)]++;
  return stats;
}

/** Try the deferred changes again, oldest first, until a pass applies nothing more. */
export function retryDeferred(ctx: ApplyContext): ApplyStats {
  const stats: ApplyStats = { applied: 0, skipped: 0, deferred: 0 };
  for (;;) {
    const rows = db.prepare('SELECT change FROM sync_deferred ORDER BY seq').all() as { change: string }[];
    let progress = 0;
    stats.deferred = 0;
    for (const r of rows) {
      const outcome = applyChange(JSON.parse(r.change) as RemoteChange, ctx);
      if (outcome === 'deferred') stats.deferred++;
      else (stats[outcome]++, progress++);
    }
    if (!progress || !stats.deferred) return stats;
  }
}

export const deferredCount = () => (db.prepare('SELECT COUNT(*) AS n FROM sync_deferred').get() as { n: number }).n;
