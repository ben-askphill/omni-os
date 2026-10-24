import { createHash } from 'node:crypto';
import { DELIVERY_RANK, type TriggerDelivery, type TriggerDeliveryState, type TriggerSource } from '@omni/shared/automation-triggers.ts';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

// What started, or did not start, an event automation (apps/server/automation-triggers.ts). A row per automation and
// source event, saved before any thread is made. Synced (sync/handlers/trigger-delivery.ts), so the Mac that runs
// automations starts what the other one saw.

interface Row extends Omit<TriggerDelivery, 'id' | 'context'> {
  uid: string;
  context: string;
}

const COLUMNS = 'uid, automation, source, source_id, summary, context, state, reason, owner, source_thread, thread_id, created_at, updated_at';

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
/** The thread a delivery starts. Fixed in advance, so a restart after the thread was made finds it instead of making a second. */
export const deliveryThreadId = (id: string) => stableId('delivery-thread', id);

export type NewDelivery = Pick<TriggerDelivery, 'automation' | 'source' | 'source_id' | 'summary' | 'context' | 'state' | 'reason' | 'owner' | 'source_thread'>;

export const triggerDeliveries = {
  /** Save one. A second save of the same event changes nothing and returns the first, with fresh false. */
  add(d: NewDelivery): { delivery: TriggerDelivery; fresh: boolean } {
    const uid = deliveryId(d.automation, d.source, d.source_id);
    return tx(() => {
      const at = now();
      const fresh =
        db
          .prepare(`INSERT INTO trigger_deliveries (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(uid) DO NOTHING`)
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

  recent(automation: string, limit = 5): TriggerDelivery[] {
    return (
      db.prepare(`SELECT ${COLUMNS} FROM trigger_deliveries WHERE automation = ? ORDER BY created_at DESC, uid DESC LIMIT ?`).all(automation, limit) as unknown as Row[]
    ).map(toDelivery);
  },

  /** The thread whose event started this one, when a delivery started it. */
  sourceOf(threadId: string): string | null {
    const row = db.prepare('SELECT source_thread FROM trigger_deliveries WHERE thread_id = ? LIMIT 1').get(threadId) as { source_thread: string | null } | undefined;
    return row?.source_thread ?? null;
  },

  /**
   * Move a delivery to a later state, never back: a pending one only. False when it had already moved on, so of two
   * callers settling the same delivery only the first wins.
   */
  settle(id: string, state: TriggerDeliveryState, patch: { reason?: string | null; thread_id?: string | null } = {}): boolean {
    return tx(() => {
      const cur = triggerDeliveries.get(id);
      if (!cur || DELIVERY_RANK[state] <= DELIVERY_RANK[cur.state]) return false;
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
};
