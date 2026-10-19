import { db, threads, type LimitStop } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { claim, registerHandler } from '../apply.ts';

// A thread's limit stop between Macs (apps/server/runner/limits.ts), keyed by the thread's id and apart from the thread
// row, which never carries it: last writer wins on the stop alone. The Mac that ran the turn records it, schedules
// or cancels it and takes it to send the continuation; either Mac clears it with a message, Stop or archive. The
// other Mac keeps a copy marked limit_elsewhere, so its Needs you lists the blocker with the reset time while only
// the owner resumes it. A stop whose thread has not arrived yet waits in sync_deferred.

const STATES = new Set(['limited', 'scheduled']);
const threadHere = db.prepare('SELECT 1 FROM threads WHERE id = ?');

registerHandler('limit_stop', {
  serialize(threadId) {
    const l = db
      .prepare('SELECT limit_state, limit_resets_at, limit_id, limit_machine FROM threads WHERE id = ? AND limit_state IS NOT NULL')
      .get(threadId) as unknown as LimitStop | undefined;
    return l ?? null;
  },
  apply(change, ctx) {
    if (!threadHere.get(change.entity_id)) throw new Error(`thread ${change.entity_id} not here yet`);
    const l = (change.data ?? {}) as Partial<LimitStop>;
    if (change.op === 'upsert' && (!STATES.has(l.limit_state as string) || typeof l.limit_id !== 'string' || !l.limit_id)) return false;
    if (!claim(change)) return false;
    if (change.op === 'delete') {
      db.prepare(
        'UPDATE threads SET limit_state = NULL, limit_resets_at = NULL, limit_id = NULL, limit_machine = NULL, limit_elsewhere = 0 WHERE id = ?',
      ).run(change.entity_id);
      return true;
    }
    // Owned by the Mac that ran the turn, which is the sender for every write but a clear.
    const machine = l.limit_machine ?? change.machine_id;
    db.prepare('UPDATE threads SET limit_state = ?, limit_resets_at = ?, limit_id = ?, limit_machine = ?, limit_elsewhere = ? WHERE id = ?').run(
      l.limit_state!,
      l.limit_resets_at ?? null,
      l.limit_id!,
      machine,
      machine === ctx.machineId ? 0 : 1,
      change.entity_id,
    );
    return true;
  },
  notify(change) {
    // The thread view shows the card; Needs you lists the blocker.
    const t = threads.get(change.entity_id);
    if (t) publishFeed({ type: 'thread', thread: t });
    publishFeed({ type: 'needs_you', thread_id: change.entity_id });
  },
});
