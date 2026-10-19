import { advanceRead, db, type Completion, type ResultRead } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { registerHandler } from '../apply.ts';

// Needs you between Macs (db/repos/needs-you.ts). A completion is insert-only, keyed by uid like an event: only the
// Mac that ran the turn writes one, so a result has one identity everywhere. A result_read, keyed by thread id,
// carries the newest result read there by (n, uid), and only ever moves the watermark forward: a late or repeated
// read is a no-op, so both Macs end on the newest read either made, in any arrival order. Neither touches the
// thread row. One whose thread has not arrived yet waits in sync_deferred.

const STATUSES = new Set(['done', 'failed', 'stopped']);
const plainN = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

registerHandler('completion', {
  serialize(uid) {
    const c = db.prepare('SELECT uid, thread_id, status, n, event_uid, created_at FROM completions WHERE uid = ?').get(uid) as unknown as
      | Omit<Completion, 'seq'>
      | undefined;
    return c ?? null;
  },
  apply(change) {
    // Nothing deletes a result: a thread's delete takes its own with it.
    if (change.op === 'delete') return false;
    const c = (change.data ?? {}) as Partial<Completion>;
    if (!c.thread_id || !STATUSES.has(c.status as string) || !plainN(c.n)) return false;
    return (
      db
        .prepare(
          `INSERT INTO completions (uid, thread_id, status, n, event_uid, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING`,
        )
        .run(change.entity_id, c.thread_id, c.status!, c.n, c.event_uid ?? null, c.created_at ?? change.ts).changes > 0
    );
  },
  notify(change) {
    publishFeed({ type: 'needs_you', thread_id: (change.data as Completion).thread_id });
  },
});

registerHandler('result_read', {
  serialize(threadId) {
    return (db.prepare('SELECT thread_id, n, uid, read_at FROM result_reads WHERE thread_id = ?').get(threadId) as unknown as ResultRead | undefined) ?? null;
  },
  apply(change) {
    if (change.op === 'delete') return false;
    const r = (change.data ?? {}) as Partial<ResultRead>;
    if (typeof r.uid !== 'string' || !r.uid || !plainN(r.n)) return false;
    // The result itself need not be here yet: the watermark names its place, and it arrives already read.
    return advanceRead({ thread_id: change.entity_id, n: r.n, uid: r.uid, read_at: r.read_at ?? change.ts });
  },
  notify(change) {
    publishFeed({ type: 'needs_you', thread_id: change.entity_id });
  },
});
