import { db, EVENT_COLUMNS, indexEvent, type EventRow } from '../../db.ts';
import { publishThread } from '../../bus.ts';
import { registerHandler } from '../apply.ts';

// Events: insert-only, keyed by uid, so a change pulled twice lands once. The local id is assigned on arrival,
// which keeps each thread's events in the order its machine wrote them.

interface EventData {
  uid: string;
  thread_id: string;
  kind: string;
  /** The payload as JSON, not the stored string. */
  payload: unknown;
  created_at: string;
}

const byUid = (uid: string) =>
  db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE uid = ?`).get(uid) as unknown as EventRow | undefined;

registerHandler('event', {
  serialize(uid) {
    const e = byUid(uid);
    return e ? ({ uid, thread_id: e.thread_id, kind: e.kind, payload: JSON.parse(e.payload), created_at: e.created_at } satisfies EventData) : null;
  },
  apply(change) {
    if (change.op === 'delete') {
      const e = byUid(change.entity_id);
      if (!e) return false;
      db.prepare('DELETE FROM search_fts WHERE event_id = ?').run(e.id);
      return db.prepare('DELETE FROM events WHERE id = ?').run(e.id).changes > 0;
    }
    const e = change.data as EventData;
    const res = db
      .prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING')
      .run(change.entity_id, e.thread_id, e.kind, JSON.stringify(e.payload), e.created_at);
    if (!res.changes) return false;
    indexEvent(e.thread_id, e.kind, e.payload, Number(res.lastInsertRowid));
    return true;
  },
  notify(change) {
    if (change.op === 'delete') return;
    const row = byUid(change.entity_id);
    if (row) publishThread(row.thread_id, row);
  },
});
