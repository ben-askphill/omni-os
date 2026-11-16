import { bus, SYNCED_AUTOMATION_RUN } from '../../bus.ts';
import { db } from '../../db.ts';
import { registerHandler } from '../apply.ts';

// Automation runs: insert-only, keyed by uid, like events. A run whose thread has not arrived yet waits for it. Each new
// record rechecks its automation's failure streak (automation-pause.ts), since the run's failed thread can arrive first.

interface RunData {
  uid: string;
  automation: string;
  thread_id: string | null;
  trigger: string;
  created_at: string;
  /** Set for a skipped run (precheck failed, catch-up too old). Absent from an older Mac. */
  skip_reason?: string | null;
}

registerHandler('automation_run', {
  serialize(uid) {
    return (
      (db.prepare('SELECT uid, automation, thread_id, trigger, created_at, skip_reason FROM automation_runs WHERE uid = ?').get(uid) as unknown as
        | RunData
        | undefined) ?? null
    );
  },
  apply(change) {
    if (change.op === 'delete') return db.prepare('DELETE FROM automation_runs WHERE uid = ?').run(change.entity_id).changes > 0;
    const r = change.data as RunData;
    return (
      db
        .prepare(
          'INSERT INTO automation_runs (uid, automation, thread_id, trigger, created_at, skip_reason) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING',
        )
        .run(change.entity_id, r.automation, r.thread_id ?? null, r.trigger, r.created_at ?? change.ts, r.skip_reason ?? null).changes > 0
    );
  },
  notify(change) {
    if (change.op !== 'delete') bus.emit(SYNCED_AUTOMATION_RUN, (change.data as RunData).automation);
  },
});
