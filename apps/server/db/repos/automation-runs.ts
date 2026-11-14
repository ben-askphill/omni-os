import { randomUUID } from 'node:crypto';
import { db, tx } from '../connection.ts';
import { record } from '../sync.ts';

export const automationRuns = {
  add(automation: string, threadId: string, trigger: string): { id: number; uid: string } {
    const uid = randomUUID();
    return tx(() => {
      const res = db
        .prepare('INSERT INTO automation_runs (uid, automation, thread_id, trigger) VALUES (?, ?, ?, ?)')
        .run(uid, automation, threadId, trigger);
      record('automation_run', uid);
      return { id: Number(res.lastInsertRowid), uid };
    });
  },
  /** A scheduled run that was skipped before anything started (automations.ts): no thread, only why. */
  skip(automation: string, trigger: string, reason: string): { id: number; uid: string } {
    const uid = randomUUID();
    return tx(() => {
      const res = db
        .prepare('INSERT INTO automation_runs (uid, automation, thread_id, trigger, skip_reason) VALUES (?, ?, NULL, ?, ?)')
        .run(uid, automation, trigger, reason);
      record('automation_run', uid);
      return { id: Number(res.lastInsertRowid), uid };
    });
  },
};
