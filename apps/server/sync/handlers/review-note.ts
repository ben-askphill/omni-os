import { diffSelection } from '@omni/shared/message-context-diff.ts';
import { parseNoteBody, type ReviewNote } from '@omni/shared/review-notes.ts';
import { publishFeed } from '../../bus.ts';
import { db, reviewNotes, threads } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';

// Review notes on a thread's Changes diff (db/repos/review-notes.ts): last writer wins on the whole row, keyed by
// the note's id. One whose thread has not arrived yet waits in sync_deferred. A note that does not parse is dropped,
// never written: the anchor and body are checked as the route checks them.

const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const timeOrNull = (v: unknown) => (isTime(v) ? v : null);

/** The thread each applied change touched, for notify: a deleted note's row is gone by then. */
const threadOf = new Map<string, string>();

registerHandler('review_note', {
  serialize(id) {
    return reviewNotes.get(id);
  },
  apply(change) {
    const id = change.entity_id;
    if (change.op === 'delete') {
      const here = reviewNotes.get(id);
      if (!claim(change) || !here) return false;
      db.prepare('DELETE FROM review_notes WHERE id = ?').run(id);
      threadOf.set(id, here.thread_id);
      return true;
    }
    const d = (change.data ?? {}) as Partial<Record<keyof ReviewNote, unknown>>;
    const anchor = diffSelection.parse(d.anchor, 1);
    const body = parseNoteBody(d.body);
    if (typeof d.thread_id !== 'string' || !anchor.ok || !body.ok) return false;
    // Before claim, so a deferred change is not taken as the last write and skipped when it is retried.
    if (!threads.get(d.thread_id)) throw new Error(`thread ${d.thread_id} not here yet`);
    if (!claim(change)) return false;
    const created = isTime(d.created_at) ? d.created_at : change.ts;
    db.prepare(
      `INSERT INTO review_notes (id, thread_id, path, anchor, body, resolved_at, sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, path = excluded.path, anchor = excluded.anchor, body = excluded.body,
         resolved_at = excluded.resolved_at, sent_at = excluded.sent_at, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    ).run(id, d.thread_id, anchor.value.path, JSON.stringify(anchor.value), body.value, timeOrNull(d.resolved_at), timeOrNull(d.sent_at), created, isTime(d.updated_at) ? d.updated_at : created);
    threadOf.set(id, d.thread_id);
    return true;
  },
  notify(change) {
    const thread = threadOf.get(change.entity_id);
    threadOf.delete(change.entity_id);
    if (thread) publishFeed({ type: 'review_notes', thread_id: thread });
  },
});
