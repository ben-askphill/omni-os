import { randomUUID } from 'node:crypto';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

export interface EventRow {
  id: number;
  thread_id: string;
  kind: string;
  payload: string;
  created_at: string;
}

/** Kinds whose text is worth searching. */
const SEARCHABLE = new Set(['user', 'assistant_text', 'crew_report', 'error']);

/** The columns clients read. The uid is sync's own key, kept out of the API. */
export const EVENT_COLUMNS = 'id, thread_id, kind, payload, created_at';

/** Add an event's text to search. events.add and a synced event both call it. */
export function indexEvent(threadId: string, kind: string, payload: unknown, eventId: number) {
  if (!SEARCHABLE.has(kind)) return;
  const text = (payload as { text?: string })?.text;
  if (text) db.prepare('INSERT INTO search_fts (body, thread_id, event_id) VALUES (?, ?, ?)').run(text, threadId, eventId);
}

export const events = {
  add(threadId: string, kind: string, payload: unknown, createdAt?: string): EventRow {
    const json = JSON.stringify(payload);
    const ts = createdAt ?? now();
    const uid = randomUUID();
    const id = tx(() => {
      const res = db
        .prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(uid, threadId, kind, json, ts);
      const id = Number(res.lastInsertRowid);
      indexEvent(threadId, kind, payload, id);
      record('event', uid);
      return id;
    });
    return { id, thread_id: threadId, kind, payload: json, created_at: ts };
  },
  since: (threadId: string, afterId = 0) =>
    db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND id > ? ORDER BY id`)
      .all(threadId, afterId) as unknown as EventRow[],
  uidOf: (id: number) => (db.prepare('SELECT uid FROM events WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? null,
  lastAssistantText(threadId: string): string | null {
    const row = db
      .prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'assistant_text' ORDER BY id DESC LIMIT 1`)
      .get(threadId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload).text as string) : null;
  },
  /** All assistant text produced by the most recent run (after the last message the agent actually saw, and after `after`). */
  lastRunText(threadId: string, after = 0): string {
    const rows = db
      .prepare(
        `SELECT payload FROM events WHERE thread_id = ? AND kind = 'assistant_text'
         AND id > MAX(COALESCE((SELECT MAX(id) FROM events WHERE thread_id = ? AND kind IN ('user', 'crew_report')
           AND json_extract(payload, '$.dropped') IS NOT 1), 0), ?) ORDER BY id`,
      )
      .all(threadId, threadId, after) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload).text as string).join('\n\n');
  },
  /** The text of the thread's first message: a team lead's brief. */
  firstUserText(threadId: string): string | null {
    const row = db.prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'user' ORDER BY id LIMIT 1`).get(threadId) as
      | { payload: string }
      | undefined;
    return row ? ((JSON.parse(row.payload).text as string) ?? null) : null;
  },
  /** The text of the thread's last message that was not dropped. */
  lastUserText(threadId: string): string {
    const row = db
      .prepare(
        `SELECT payload FROM events WHERE thread_id = ? AND kind = 'user' AND json_extract(payload, '$.dropped') IS NOT 1 ORDER BY id DESC LIMIT 1`,
      )
      .get(threadId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload).text as string) ?? '' : '';
  },
  /**
   * The commands Ben used most recently on a harness, in any thread, newest first and each once.
   * Only messages he typed count: in Omni or in claude-bar's hotkey prompt, not the Conductor's or an Automation's.
   */
  recentCommands(harness: string, limit = 20): string[] {
    const rows = db
      .prepare(
        `SELECT json_extract(e.payload, '$.slash.command.name') AS name FROM events e JOIN threads t ON t.id = e.thread_id
         WHERE e.kind = 'user' AND t.harness = ? AND json_extract(e.payload, '$.source') IN ('manual', 'ben', 'capture')
           AND json_extract(e.payload, '$.slash.command.name') IS NOT NULL
         GROUP BY name ORDER BY MAX(e.id) DESC LIMIT ?`,
      )
      .all(harness, limit) as { name: string }[];
    return rows.map((r) => r.name);
  },
};
