import { randomUUID } from 'node:crypto';
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import type { ReviewNote } from '@omni/shared/review-notes.ts';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

// Review notes on a thread's Changes diff (packages/shared/review-notes.ts). Every write records the row for sync
// (sync/handlers/review-note.ts), where the newest write of the whole row wins.

export type { ReviewNote };

type Row = Omit<ReviewNote, 'anchor'> & { path: string; anchor: string };

const COLUMNS = 'id, thread_id, path, anchor, body, resolved_at, sent_at, created_at, updated_at';

const toNote = ({ path: _path, anchor, ...r }: Row): ReviewNote => ({ ...r, anchor: JSON.parse(anchor) as DiffSelection });

export const reviewNotes = {
  get(id: string): ReviewNote | null {
    const r = db.prepare(`SELECT ${COLUMNS} FROM review_notes WHERE id = ?`).get(id) as Row | undefined;
    return r ? toNote(r) : null;
  },
  /** Oldest first. */
  byThread(threadId: string): ReviewNote[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM review_notes WHERE thread_id = ? ORDER BY created_at, id`).all(threadId) as Row[]).map(toNote);
  },
  count: (threadId: string) => (db.prepare('SELECT COUNT(*) AS n FROM review_notes WHERE thread_id = ?').get(threadId) as { n: number }).n,

  create(threadId: string, anchor: DiffSelection, body: string): ReviewNote {
    return tx(() => {
      const id = randomUUID();
      const at = now();
      db.prepare(`INSERT INTO review_notes (${COLUMNS}) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).run(id, threadId, anchor.path, JSON.stringify(anchor), body, at, at);
      record('review_note', id);
      return reviewNotes.get(id)!;
    });
  },

  /** A new body reopens a sent note, so the next send carries it. Resolving keeps the body; reopening clears resolved_at. */
  update(id: string, change: { body?: string; resolved?: boolean }): ReviewNote | null {
    return tx(() => {
      const cur = reviewNotes.get(id);
      if (!cur) return null;
      const body = change.body ?? cur.body;
      const sent_at = body !== cur.body ? null : cur.sent_at;
      const resolved_at = change.resolved === undefined ? cur.resolved_at : change.resolved ? (cur.resolved_at ?? now()) : null;
      if (body === cur.body && sent_at === cur.sent_at && resolved_at === cur.resolved_at) return cur;
      db.prepare('UPDATE review_notes SET body = ?, sent_at = ?, resolved_at = ?, updated_at = ? WHERE id = ?').run(body, sent_at, resolved_at, now(), id);
      record('review_note', id);
      return reviewNotes.get(id)!;
    });
  },

  /** Send open notes carried these. */
  markSent(ids: readonly string[]): ReviewNote[] {
    return tx(() => {
      const at = now();
      return ids.flatMap((id) => {
        const res = db.prepare('UPDATE review_notes SET sent_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
        if (!res.changes) return [];
        record('review_note', id);
        return [reviewNotes.get(id)!];
      });
    });
  },

  remove(id: string): boolean {
    return tx(() => {
      const res = db.prepare('DELETE FROM review_notes WHERE id = ?').run(id);
      if (res.changes) record('review_note', id, 'delete');
      return res.changes > 0;
    });
  },
};
