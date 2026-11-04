import { db, EVENT_COLUMNS, indexEvent, type EventRow } from '../../db.ts';
import { ANSWER_EVENT, QUESTION_EVENT } from '@omni/shared/question.ts';
import { SECRET_ANSWER_EVENT, SECRET_REQUEST_EVENT } from '@omni/shared/secret-request.ts';
import { publishFeed, publishThread } from '../../bus.ts';
import { scrubSecrets } from '../../secret-scrub.ts';
import { registerHandler } from '../apply.ts';

// Events: insert-only, keyed by uid, so a change pulled twice lands once. The local id is assigned on arrival,
// which keeps each thread's events in the order its machine wrote them.

/** A request asked or settled on the other Mac adds or clears a Needs you blocker here. */
const NEEDS_YOU_KINDS = new Set([QUESTION_EVENT, ANSWER_EVENT, SECRET_REQUEST_EVENT, SECRET_ANSWER_EVENT]);

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
    const payload = scrubSecrets(e.payload);
    const res = db
      .prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING')
      .run(change.entity_id, e.thread_id, e.kind, JSON.stringify(payload), e.created_at);
    if (!res.changes) return false;
    indexEvent(e.thread_id, e.kind, payload, Number(res.lastInsertRowid));
    return true;
  },
  notify(change) {
    if (change.op === 'delete') return;
    const row = byUid(change.entity_id);
    if (!row) return;
    publishThread(row.thread_id, row);
    if (NEEDS_YOU_KINDS.has(row.kind)) publishFeed({ type: 'needs_you', thread_id: row.thread_id });
  },
});
