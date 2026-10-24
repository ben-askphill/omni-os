import { createHash } from 'node:crypto';
import { isDeliveryAhead, isPendingDelivery, type TriggerDelivery, type TriggerDeliveryState, type TriggerSource } from '@omni/shared/automation-triggers.ts';
import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';

// What started, or did not start, an event automation (apps/server/automation-triggers.ts). A row per automation and
// source event, saved before any thread is made. Synced (sync/handlers/trigger-delivery.ts), so the Mac that runs
// automations starts what the other one saw.

interface Row extends Omit<TriggerDelivery, 'id' | 'context'> {
  uid: string;
  context: string;
}

const COLUMNS = 'uid, automation, source, source_id, summary, context, state, reason, owner, source_thread, thread_id, attempt, created_at, updated_at';

const toDelivery = ({ uid, context, ...r }: Row): TriggerDelivery => ({ id: uid, ...r, context: JSON.parse(context) as Record<string, string> });

/**
 * A hash of the parts shaped as a v4 uuid: the same event for the same automation gets the same id on every Mac. A
 * thread's id is its harness session id too, and the harnesses take only well-formed uuids.
 */
function stableId(...parts: string[]) {
  const h = createHash('sha256').update(parts.join('\n')).digest('hex');
  const variant = '89ab'[parseInt(h[16], 16) % 4];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Bus event: a pending delivery arrived from the other Mac. apps/server/automation-triggers.ts starts it if this Mac runs automations. */
export const DELIVERY_PENDING = 'trigger_delivery:pending';

export const deliveryId = (automation: string, source: TriggerSource, sourceId: string) => stableId('delivery', automation, source, sourceId);
/**
 * The thread an attempt of a delivery starts. Fixed in advance, so a restart after the thread was made finds it
 * instead of making a second, and each attempt has its own: a retry never finds the failed one's. The first attempt's
 * id is what it was before there were attempts.
 */
export const deliveryThreadId = (id: string, attempt = 1) => (attempt <= 1 ? stableId('delivery-thread', id) : stableId('delivery-thread', id, String(attempt)));

/** Deliveries this process is starting right now: the claim that keeps a skip, a retry and a second pass out of a start in flight. */
const starting = new Set<string>();

export type NewDelivery = Pick<TriggerDelivery, 'automation' | 'source' | 'source_id' | 'summary' | 'context' | 'state' | 'reason' | 'owner' | 'source_thread'>;

export const triggerDeliveries = {
  /** Save one. A second save of the same event changes nothing and returns the first, with fresh false. */
  add(d: NewDelivery): { delivery: TriggerDelivery; fresh: boolean } {
    const uid = deliveryId(d.automation, d.source, d.source_id);
    return tx(() => {
      const at = now();
      const fresh =
        db
          .prepare(`INSERT INTO trigger_deliveries (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?) ON CONFLICT(uid) DO NOTHING`)
          .run(uid, d.automation, d.source, d.source_id, d.summary, JSON.stringify(d.context), d.state, d.reason, d.owner, d.source_thread, at, at).changes > 0;
      if (fresh) record('trigger_delivery', uid);
      return { delivery: triggerDeliveries.get(uid)!, fresh };
    });
  },

  get(id: string): TriggerDelivery | undefined {
    const row = db.prepare(`SELECT ${COLUMNS} FROM trigger_deliveries WHERE uid = ?`).get(id) as unknown as Row | undefined;
    return row && toDelivery(row);
  },

  /** Accepted or held, oldest first: what the Mac that runs automations still has to start. */
  pending(): TriggerDelivery[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM trigger_deliveries WHERE state IN ('received', 'accepted', 'queued') ORDER BY created_at, uid`).all() as unknown as Row[]).map(
      toDelivery,
    );
  },

  /** An automation's deliveries, newest first, `limit` of them after the one `before` names. `more` when older ones exist. */
  page(automation: string, limit: number, before?: string): { rows: TriggerDelivery[]; more: boolean } {
    const cursor = before ? triggerDeliveries.get(before) : undefined;
    const rows = (
      cursor
        ? db
            .prepare(`SELECT ${COLUMNS} FROM trigger_deliveries WHERE automation = ? AND (created_at, uid) < (?, ?) ORDER BY created_at DESC, uid DESC LIMIT ?`)
            .all(automation, cursor.created_at, cursor.id, limit + 1)
        : db.prepare(`SELECT ${COLUMNS} FROM trigger_deliveries WHERE automation = ? ORDER BY created_at DESC, uid DESC LIMIT ?`).all(automation, limit + 1)
    ) as unknown as Row[];
    return { rows: rows.slice(0, limit).map(toDelivery), more: rows.length > limit };
  },

  /** The thread whose event started this one, when a delivery started it. */
  sourceOf(threadId: string): string | null {
    const row = db.prepare('SELECT source_thread FROM trigger_deliveries WHERE thread_id = ? LIMIT 1').get(threadId) as { source_thread: string | null } | undefined;
    return row?.source_thread ?? null;
  },

  /**
   * Take a pending delivery to start it, or null when it is not pending any more or this process is already starting it.
   * The row is read here, not taken from a list read earlier, so a skip that landed since is seen. Hand it back with
   * `release` when the start is over, whatever came of it.
   */
  claim(id: string): TriggerDelivery | null {
    const cur = triggerDeliveries.get(id);
    if (!cur || !isPendingDelivery(cur.state) || starting.has(id)) return null;
    starting.add(id);
    return cur;
  },

  release(id: string) {
    starting.delete(id);
  },

  isStarting: (id: string) => starting.has(id),

  /**
   * Move a delivery on: to a higher state of the same attempt, never back. False when it had already moved on, or is
   * on another attempt than the one the caller started, so of two callers settling the same delivery only the first
   * wins, and a late answer for an old attempt changes nothing.
   */
  settle(id: string, attempt: number, state: TriggerDeliveryState, patch: { reason?: string | null; thread_id?: string | null } = {}): boolean {
    return tx(() => {
      const cur = triggerDeliveries.get(id);
      if (!cur || cur.attempt !== attempt || !isDeliveryAhead({ attempt, state }, cur)) return false;
      db.prepare('UPDATE trigger_deliveries SET state = ?, reason = ?, thread_id = ?, updated_at = ? WHERE uid = ?').run(
        state,
        patch.reason ?? null,
        patch.thread_id ?? cur.thread_id,
        now(),
        id,
      );
      record('trigger_delivery', id);
      return true;
    });
  },

  /**
   * Skip a delivery that has not started: final. False when it is on another attempt than the caller saw, is being
   * started in this process, has a thread, or is already started or skipped. The update names all of that, so a skip
   * racing a start or a retry changes nothing it should not.
   */
  skip(id: string, attempt: number, reason: string): boolean {
    if (starting.has(id)) return false;
    return tx(() => {
      const changed = db
        .prepare(
          `UPDATE trigger_deliveries SET state = 'skipped', reason = ?, updated_at = ?
           WHERE uid = ? AND attempt = ? AND thread_id IS NULL AND state IN ('received', 'accepted', 'queued', 'failed')`,
        )
        .run(reason, now(), id, attempt).changes;
      if (changed) record('trigger_delivery', id);
      return changed > 0;
    });
  },

  /**
   * Go again: a failed delivery with no thread becomes the next attempt, pending. False for anything else, and for a
   * caller that saw an earlier attempt, so two clicks on Retry make one attempt. The caller has checked that no thread
   * of this attempt exists (automation-deliveries.ts); this is the check-and-set that makes the click count once.
   */
  retry(id: string, attempt: number, to: 'accepted' | 'queued', owner: string | null): boolean {
    if (starting.has(id)) return false;
    return tx(() => {
      const changed = db
        .prepare(
          `UPDATE trigger_deliveries SET attempt = attempt + 1, state = ?, reason = NULL, owner = ?, updated_at = ?
           WHERE uid = ? AND attempt = ? AND state = 'failed' AND thread_id IS NULL`,
        )
        .run(to, owner, now(), id, attempt).changes;
      if (changed) record('trigger_delivery', id);
      return changed > 0;
    });
  },

  /** How many of the automation's threads are queued or running on this Mac: its runs that are going. Another Mac's are its own load, and a Mac that died mid-run must not hold slots here. */
  liveRuns(automation: string): number {
    return (
      db
        .prepare(`SELECT COUNT(*) AS n FROM threads WHERE automation = ? AND status IN ('queued', 'running') AND (run_machine IS NULL OR run_machine = ?)`)
        .get(automation, outbox.machineId() ?? '') as { n: number }
    ).n;
  },

  /**
   * The thread this attempt of a delivery made, or an earlier attempt did, newest first. One exists: a run was admitted,
   * so nothing may start another, whatever else is true of the delivery now.
   */
  admitted(id: string, attempt: number): string | null {
    for (let k = attempt; k >= 1; k--) {
      const thread = deliveryThreadId(id, k);
      if (db.prepare('SELECT 1 FROM threads WHERE id = ?').get(thread)) return thread;
    }
    return null;
  },
};
