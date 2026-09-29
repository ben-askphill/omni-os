import { db } from '../../db.ts';
import { registerHandler } from '../apply.ts';

// Automation runs: insert-only, keyed by uid, like events. A run whose thread has not arrived yet waits for it.

interface RunData {
  uid: string;
  automation: string;
  thread_id: string | null;
  trigger: string;
  created_at: string;
}

registerHandler('automation_run', {
  serialize(uid) {
    return (
      (db.prepare('SELECT uid, automation, thread_id, trigger, created_at FROM automation_runs WHERE uid = ?').get(uid) as unknown as
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
          'INSERT INTO automation_runs (uid, automation, thread_id, trigger, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING',
        )
        .run(change.entity_id, r.automation, r.thread_id ?? null, r.trigger, r.created_at ?? change.ts).changes > 0
    );
  },
});
