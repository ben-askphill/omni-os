import { bus, SYNC_BATCH } from '../bus.ts';
import { db, SEED_TS, syncMeta, tx, type SyncEntity } from '../db.ts';
import type { RemoteChange } from './transport.ts';
import { gateChange, logRefused } from './verify.ts';

// Remote changes into the local db. Each entity has a handler; apps/server/sync/handlers/ registers them.
// Handlers write with plain SQL, never through the db.ts repos, so an applied change is not queued to go back out.

export interface ApplyContext {
  /** This machine's sync id. */
  machineId: string;
  /** First-key auto-trust requires a current Connect registration reported by this relay. */
  pairedMachines?: ReadonlySet<string>;
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

/** Drop an entity's handler, so its outbox rows are held again. For tests. */
export const unregisterHandler = (entity: SyncEntity) => void handlers.delete(entity);

export const getHandler = (entity: SyncEntity) => handlers.get(entity);
export const registeredEntities = (): SyncEntity[] => [...handlers.keys()];

/** True when (ts, machine) is later than (ts2, machine2): time first, machine id breaks a tie. */
export const later = (ts: string, machine: string, ts2: string, machine2: string) =>
  ts > ts2 || (ts === ts2 && machine > machine2);

/**
 * Last-writer-wins gate for a handler: true when the change is newer than the last write this row took,
 * local or remote, and records it as the last write. Call it inside apply, before writing.
 * A seeded copy (SEED_TS, another Mac's first arm) only fills a gap: it never replaces a row this Mac has.
 */
export function claim(change: RemoteChange): boolean {
  const last = syncMeta.get(change.entity, change.entity_id);
  if (last && (change.ts === SEED_TS || !later(change.ts, change.machine_id, last.ts, last.machine_id))) return false;
  syncMeta.set(change.entity, change.entity_id, change.ts, change.machine_id);
  return true;
}

// A change already deferred for the same reason is left as it is. Every sync cycle retries every deferred row, and
// rewriting each one (its change JSON spills onto overflow pages) once a cycle kept the disk busy without end.
function defer(change: RemoteChange, err: unknown) {
  db.prepare(
    `INSERT INTO sync_deferred (seq, change, error) VALUES (?, ?, ?)
     ON CONFLICT(seq) DO UPDATE SET error = excluded.error, tries = tries + 1
     WHERE sync_deferred.error IS NOT excluded.error`,
  ).run(change.seq, JSON.stringify(change), (err as Error)?.message ?? String(err));
}

// A change its handler could not apply (most often its thread is not on this machine) is tried on every sync for its
// first ten minutes, then at most once every tenth of the time it has waited, and at least once an hour. A thread that
// never comes (deleted here, or never synced) stops costing a pass on every sync, and one that comes late brings its
// changes within a tenth of their wait. Kept in memory, so a restart tries them all again. A change the gate holds (no
// handler, a key or Trust to wait for) is tried on every sync as before.
const EVERY_SYNC_MS = 10 * 60_000;
const MAX_WAIT_MS = 60 * 60_000;
const stuck = new Map<number, { since: number; next: number }>();

function backOff(seq: number, now: number) {
  const since = stuck.get(seq)?.since ?? now;
  const age = now - since;
  stuck.set(seq, { since, next: age < EVERY_SYNC_MS ? now : now + Math.min(MAX_WAIT_MS, age / 10) });
}

/**
 * Apply one remote change. A change that fails is kept in sync_deferred and retried, never lost or fatal. Its
 * signature is checked first (sync/verify.ts): a refused one is logged and skipped, and the handler sees the change
 * without its signature.
 */
export function applyChange(signed: RemoteChange, ctx: ApplyContext, now = Date.now()): ApplyOutcome {
  const handler = handlers.get(signed.entity);
  let applied: boolean;
  let change = signed;
  let handled = false;
  try {
    if (!handler) throw new Error(`no handler for ${signed.entity}`);
    const gate = gateChange(signed, undefined, ctx.pairedMachines);
    if (gate.kind === 'defer') throw new Error(gate.reason);
    if (gate.kind === 'refuse') {
      tx(() => {
        logRefused(gate.change, gate.reason, false);
        db.prepare('DELETE FROM sync_deferred WHERE seq = ?').run(signed.seq);
      });
      stuck.delete(signed.seq);
      return 'skipped';
    }
    change = gate.change;
    handled = true;
    applied = tx(() => {
      const ok = handler.apply(change, ctx);
      // In the same commit as the write, so a change that fails is not logged on each retry.
      if (gate.unverified) logRefused(change, gate.unverified, true);
      db.prepare('DELETE FROM sync_deferred WHERE seq = ?').run(change.seq);
      return ok;
    });
  } catch (err) {
    defer(signed, err);
    if (handled) backOff(signed.seq, now);
    else stuck.delete(signed.seq);
    return 'deferred';
  }
  stuck.delete(signed.seq);
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
  const applied: RemoteChange[] = [];
  applying++;
  try {
    for (const c of changes) {
      const outcome = applyChange(c, ctx);
      stats[outcome]++;
      if (outcome === 'applied') applied.push(c);
    }
  } finally {
    applying--;
  }
  batchDone(applied);
  return stats;
}

/** Inside applyBatch or retryDeferred: a write the bus reports now came from another machine, and its batch is not done. */
let applying = 0;
export const applyingSync = () => applying > 0;

/** Tell listeners that need a whole batch (automation-pause.ts) which changes it applied. */
function batchDone(applied: RemoteChange[]) {
  if (!applied.length) return;
  try {
    bus.emit(SYNC_BATCH, applied);
  } catch (err) {
    console.error('[sync] a batch listener failed:', (err as Error).message);
  }
}

/** The deferred queue in relay order, for retries and first-key pairing checks. */
export function deferredChanges(): RemoteChange[] {
  return (db.prepare('SELECT change FROM sync_deferred ORDER BY seq').all() as { change: string }[]).map((r) => JSON.parse(r.change) as RemoteChange);
}

/**
 * Try the deferred changes that are due again, oldest first, until a pass applies nothing more. A pass after one that
 * applied something tries every change, waiting or not: what landed may be what they wait for.
 */
export function retryDeferred(ctx: ApplyContext, now = Date.now()): ApplyStats {
  const stats: ApplyStats = { applied: 0, skipped: 0, deferred: 0 };
  const applied: RemoteChange[] = [];
  applying++;
  try {
    for (let all = false; ; all = true) {
      const rows = deferredChanges();
      const here = new Set(rows.map((r) => r.seq));
      for (const seq of stuck.keys()) if (!here.has(seq)) stuck.delete(seq);
      let progress = 0;
      stats.deferred = 0;
      for (const r of rows) {
        if (!all && (stuck.get(r.seq)?.next ?? now) > now) {
          stats.deferred++;
          continue;
        }
        const outcome = applyChange(r, ctx, now);
        if (outcome === 'deferred') stats.deferred++;
        else (stats[outcome]++, progress++);
        if (outcome === 'applied') applied.push(r);
      }
      if (!progress || !stats.deferred) return stats;
    }
  } finally {
    applying--;
    batchDone(applied);
  }
}

export const deferredCount = () => (db.prepare('SELECT COUNT(*) AS n FROM sync_deferred').get() as { n: number }).n;
