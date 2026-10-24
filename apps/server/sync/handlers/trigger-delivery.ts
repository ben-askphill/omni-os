import { DELIVERY_RANK, isPendingDelivery, type TriggerDelivery, type TriggerDeliveryState } from '@omni/shared/automation-triggers.ts';
import { db } from '../../db.ts';
import { DELIVERY_PENDING } from '../../db/repos/trigger-deliveries.ts';
import { bus, publishFeed } from '../../bus.ts';
import { registerHandler } from '../apply.ts';

// Event-trigger deliveries (apps/server/automation-triggers.ts), keyed by their uid, which both Macs derive from the
// same event. Not last-writer-wins: a delivery only moves forward, so a copy the other Mac saved before this one
// started it never takes it back to held. One that arrives pending is started here if this Mac runs automations.

type Data = Omit<TriggerDelivery, 'id' | 'context'> & { uid: string; context: string };

const COLUMNS = 'uid, automation, source, source_id, summary, context, state, reason, owner, source_thread, thread_id, created_at, updated_at';

registerHandler('trigger_delivery', {
  serialize(uid) {
    return (db.prepare(`SELECT ${COLUMNS} FROM trigger_deliveries WHERE uid = ?`).get(uid) as unknown as Data | undefined) ?? null;
  },
  apply(change) {
    if (change.op === 'delete') return db.prepare('DELETE FROM trigger_deliveries WHERE uid = ?').run(change.entity_id).changes > 0;
    const d = change.data as Data;
    if (!(d.state in DELIVERY_RANK)) return false;
    const cur = db.prepare('SELECT state, thread_id FROM trigger_deliveries WHERE uid = ?').get(change.entity_id) as
      | { state: TriggerDeliveryState; thread_id: string | null }
      | undefined;
    if (!cur)
      return (
        db
          .prepare(`INSERT INTO trigger_deliveries (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
          .run(
            change.entity_id,
            d.automation,
            d.source,
            d.source_id,
            d.summary,
            typeof d.context === 'string' ? d.context : JSON.stringify(d.context ?? {}),
            d.state,
            d.reason ?? null,
            d.owner ?? null,
            d.source_thread ?? null,
            d.thread_id ?? null,
            d.created_at ?? change.ts,
            d.updated_at ?? change.ts,
          ).changes > 0
      );
    if (DELIVERY_RANK[d.state] <= DELIVERY_RANK[cur.state]) return false;
    db.prepare('UPDATE trigger_deliveries SET state = ?, reason = ?, thread_id = ?, updated_at = ? WHERE uid = ?').run(
      d.state,
      d.reason ?? null,
      d.thread_id ?? cur.thread_id,
      d.updated_at ?? change.ts,
      change.entity_id,
    );
    return true;
  },
  notify(change) {
    const d = change.data as Data | null;
    if (!d) return;
    publishFeed({ type: 'automation_delivery', automation: d.automation });
    if (isPendingDelivery(d.state)) bus.emit(DELIVERY_PENDING);
  },
});
