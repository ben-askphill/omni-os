import { randomUUID } from 'node:crypto';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

export interface EventRow {
  id: number;
  thread_id: string;
  kind: string;
  payload: string;
  created_at: string;
  /** The agent that wrote it, by id: the thread's agent on the rows its runs write. Null on Ben's and Omni's rows. */
  agent: string | null;
}

/** Kinds whose text is worth searching. */
const SEARCHABLE = new Set(['user', 'assistant_text', 'crew_report', 'error']);

/** The columns clients read. The uid is sync's own key, kept out of the API. */
export const EVENT_COLUMNS = 'id, thread_id, kind, payload, created_at, agent';

/** Add an event's text to search. events.add and a synced event both call it. */
export function indexEvent(threadId: string, kind: string, payload: unknown, eventId: number) {
  if (!SEARCHABLE.has(kind)) return;
  const text = (payload as { text?: string })?.text;
  if (text) db.prepare('INSERT INTO search_fts (body, thread_id, event_id) VALUES (?, ?, ?)').run(text, threadId, eventId);
}

/**
 * Where a thread's rows live (ADR 0019). A member's session runs in a hidden thread (source `member`, db/repos/members.ts)
 * whose rows go into the group thread it sits in, written as the member's agent, so every transcript reader finds them
 * there. The mapping never changes once the member thread exists.
 */
const homes = new Map<string, { thread: string; agent: string | null } | null>();
function homeOf(threadId: string): { thread: string; agent: string | null } | null {
  if (homes.has(threadId)) return homes.get(threadId)!;
  const row = db.prepare(`SELECT parent_id, role FROM threads WHERE id = ? AND source = 'member'`).get(threadId) as { parent_id: string | null; role: string | null } | undefined;
  const home = row?.parent_id ? { thread: row.parent_id, agent: row.role } : null;
  // A thread row that is not there yet (a synced row on its way) is looked up again next time.
  if (row) homes.set(threadId, home);
  return home;
}

/** The thread whose transcript holds `threadId`'s rows: its group thread for a member's session, else itself. */
export const transcriptOf = (threadId: string) => homeOf(threadId)?.thread ?? threadId;

/**
 * The rows one agent's session wrote in a transcript: a member's own, or, in a thread with members, the lead's and
 * Ben's (every row no member wrote). `sql` goes after a WHERE on thread_id.
 */
function scopeOf(threadId: string): { thread: string; sql: string; args: (string | null)[]; member: boolean } {
  const home = homeOf(threadId);
  if (home) return { thread: home.thread, sql: 'AND agent IS ?', args: [home.agent], member: true };
  const seated = db.prepare('SELECT 1 FROM thread_members WHERE thread_id = ? AND lead = 0 LIMIT 1').get(threadId);
  if (!seated) return { thread: threadId, sql: '', args: [], member: false };
  return { thread: threadId, sql: 'AND (agent IS NULL OR agent NOT IN (SELECT agent FROM thread_members WHERE thread_id = ? AND lead = 0))', args: [threadId], member: false };
}

/**
 * The assistant text of the most recent run, oldest first: after the last message the agent actually saw, and after
 * `after`. In a thread with members, only the rows of the session `threadId` runs (scopeOf): a message to members only
 * (one with `to`) is not one its lead saw.
 */
function runTexts(threadId: string, after: number): string[] {
  const s = scopeOf(threadId);
  const seen = s.member ? '' : `AND (kind != 'user' OR json_extract(payload, '$.to') IS NULL)`;
  const rows = db
    .prepare(
      `SELECT payload FROM events WHERE thread_id = ? AND kind = 'assistant_text' ${s.sql}
       AND id > MAX(COALESCE((SELECT MAX(id) FROM events WHERE thread_id = ? AND kind IN ('user', 'crew_report', 'routed') ${s.sql} ${seen}
         AND json_extract(payload, '$.dropped') IS NOT 1), 0), ?) ORDER BY id`,
    )
    .all(s.thread, ...s.args, s.thread, ...s.args, after) as { payload: string }[];
  return rows.map((r) => JSON.parse(r.payload).text as string);
}

export const events = {
  /** `agent`: the agent that wrote the row, for a row a run of the thread wrote (runner/state.ts addEvent). */
  add(given: string, kind: string, payload: unknown, createdAt?: string, writer: string | null = null): EventRow {
    // A member's session writes into its group thread, as its agent (homeOf).
    const home = homeOf(given);
    const threadId = home?.thread ?? given;
    const agent = writer ?? home?.agent ?? null;
    const json = JSON.stringify(payload);
    const ts = createdAt ?? now();
    const uid = randomUUID();
    const id = tx(() => {
      const res = db
        .prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at, agent) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid, threadId, kind, json, ts, agent);
      const id = Number(res.lastInsertRowid);
      indexEvent(threadId, kind, payload, id);
      record('event', uid);
      return id;
    });
    return { id, thread_id: threadId, kind, payload: json, created_at: ts, agent };
  },
  /** The `team` row that makes a thread a one-thread team (runner/team.ts), as stored, or null for any other thread. */
  teamOf: (threadId: string) =>
    (db.prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'team' ORDER BY id LIMIT 1`).get(threadId) as { payload: string } | undefined)?.payload ?? null,
  /** A team thread's lead messages to its members (`source: lead`) and Omni's wakes of its lead (`source: team`), in order. */
  teamMessages: (threadId: string) =>
    db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind = 'user' AND json_extract(payload, '$.source') IN ('lead', 'team')
         AND json_extract(payload, '$.dropped') IS NOT 1 ORDER BY id`,
      )
      .all(threadId) as unknown as EventRow[],
  /** The `ask` event in `parentId` that started `childId` (ask.ts), as stored, or null when that child was no Ask. */
  askFor: (parentId: string, childId: string) =>
    (
      db
        .prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'ask' AND json_extract(payload, '$.thread_id') = ? ORDER BY id DESC LIMIT 1`)
        .get(parentId, childId) as { payload: string } | undefined
    )?.payload ?? null,
  /** The thread's newest event id, 0 for none: where a run stood when it ended. */
  lastId: (threadId: string) => Number((db.prepare('SELECT MAX(id) AS id FROM events WHERE thread_id = ?').get(transcriptOf(threadId)) as { id: number | null }).id ?? 0),
  /** The transcript after `afterId`: a member's session reads its group thread's. */
  since: (threadId: string, afterId = 0) =>
    db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND id > ? ORDER BY id`)
      .all(transcriptOf(threadId), afterId) as unknown as EventRow[],
  /** Whether the thread has a message, reply or tool call after this event id: something a session there never saw. */
  hasContentAfter: (threadId: string, afterId: number) =>
    !!db
      .prepare(
        `SELECT 1 FROM events WHERE thread_id = ? AND id > ? AND kind IN ('user', 'crew_report', 'assistant_text', 'tool_use', 'tool_result')
         AND json_extract(payload, '$.dropped') IS NOT 1 LIMIT 1`,
      )
      .get(transcriptOf(threadId), afterId),
  /** When the thread's model last did anything (a reply, a tool call or result, a turn's end), null if never. */
  lastModelAt: (threadId: string) => {
    const s = scopeOf(threadId);
    return (
      db
        .prepare(`SELECT MAX(created_at) AS at FROM events WHERE thread_id = ? AND kind IN ('assistant_text', 'tool_use', 'tool_result', 'result') ${s.sql}`)
        .get(s.thread, ...s.args) as { at: string | null }
    ).at;
  },
  /**
   * The tasks with a stored event since `since` whose newest event is not their end, each with its start's payload
   * (null when that row is missing). For the sub-agents another machine runs (apps/server/delegating.ts).
   */
  openTasksSince: (since: string) =>
    db
      .prepare(
        `WITH latest AS (
           SELECT thread_id, json_extract(payload, '$.task_id') AS task_id, MAX(id) AS id FROM events INDEXED BY events_task_at
           WHERE kind = 'task' AND created_at > ? GROUP BY thread_id, task_id)
         SELECT l.thread_id, l.task_id,
           (SELECT s.payload FROM events s WHERE s.thread_id = l.thread_id AND s.kind = 'task' AND json_extract(s.payload, '$.task_id') = l.task_id
              AND json_extract(s.payload, '$.event') = 'started' ORDER BY s.id LIMIT 1) AS started
         FROM latest l JOIN events e ON e.id = l.id
         WHERE json_extract(e.payload, '$.event') IS NOT 'ended'`,
      )
      .all(since) as { thread_id: string; task_id: string; started: string | null }[],
  /** The agent that wrote a row, by its id. */
  agentOf: (id: number) => (db.prepare('SELECT agent FROM events WHERE id = ?').get(id) as { agent: string | null } | undefined)?.agent ?? null,
  idOf: (uid: string) => (db.prepare('SELECT id FROM events WHERE uid = ?').get(uid) as { id: number } | undefined)?.id ?? null,
  uidOf: (id: number) => (db.prepare('SELECT uid FROM events WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? null,
  lastAssistantText(threadId: string): string | null {
    const s = scopeOf(threadId);
    const row = db
      .prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'assistant_text' ${s.sql} ORDER BY id DESC LIMIT 1`)
      .get(s.thread, ...s.args) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload).text as string) : null;
  },
  /** All assistant text produced by the most recent run (after the last message the agent actually saw, and after `after`). */
  lastRunText(threadId: string, after = 0): string {
    return runTexts(threadId, after).join('\n\n');
  },
  /** The last assistant text of the most recent run, the reply a push alert previews. Empty when the run wrote none. */
  lastRunReply(threadId: string, after = 0): string {
    return runTexts(threadId, after).at(-1) ?? '';
  },
  /** A thread's question and question_answer events (packages/shared/question.ts), oldest first; with `id`, one question's. */
  questions(threadId: string, id?: string): EventRow[] {
    const one = id ? `AND json_extract(payload, '$.id') = ?` : '';
    return db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind IN ('question', 'question_answer') ${one} ORDER BY id`)
      .all(transcriptOf(threadId), ...(id ? [id] : [])) as unknown as EventRow[];
  },
  /** A thread's collision and collision_cleared rows (packages/shared/collisions.ts), oldest first. */
  collisions(threadId: string): EventRow[] {
    return db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND kind IN ('collision', 'collision_cleared') ORDER BY id`)
      .all(transcriptOf(threadId)) as unknown as EventRow[];
  },
  /** The payload of a thread's tool_use event, by the tool call's id. */
  toolUse(threadId: string, toolUseId: string): { id: string; name: string; input: unknown; parent?: string | null } | null {
    const row = db
      .prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'tool_use' AND json_extract(payload, '$.id') = ? ORDER BY id DESC LIMIT 1`)
      .get(transcriptOf(threadId), toolUseId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  },
  /** Every Artifact tool call that has a result, oldest first, for linking what was published before Omni tracked it. */
  artifactCalls(): { thread_id: string; use: string; result: string }[] {
    return db
      .prepare(
        `SELECT u.thread_id, u.payload AS use, r.payload AS result FROM events u
         JOIN events r ON r.thread_id = u.thread_id AND r.kind = 'tool_result' AND json_extract(r.payload, '$.tool_use_id') = json_extract(u.payload, '$.id')
         WHERE u.kind = 'tool_use' AND json_extract(u.payload, '$.name') = 'Artifact' ORDER BY r.id`,
      )
      .all() as { thread_id: string; use: string; result: string }[];
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
   * The commands the user used most recently on a harness, in any thread, newest first and each once.
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
