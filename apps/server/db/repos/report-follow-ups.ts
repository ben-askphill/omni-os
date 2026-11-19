import { db } from '../connection.ts';

/**
 * Delegations whose report wakes the parent (apps/server/runner/queue.ts fileReport): the Conductor passed
 * `follow_up: true` because it will act on the report itself. Without a row, a delegate-only parent gets the report
 * shown in its transcript and reads it with Ben's next message. Local to this Mac, where the parent delegated from.
 */
export const reportFollowUps = {
  has: (childId: string) => !!db.prepare('SELECT 1 FROM report_follow_ups WHERE thread_id = ?').get(childId),
  set: (childId: string) => {
    db.prepare('INSERT OR IGNORE INTO report_follow_ups (thread_id) VALUES (?)').run(childId);
  },
};
