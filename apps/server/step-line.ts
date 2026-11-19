// The step a running thread is on, in one line ("Step 3 of 5 · Compare prices", or a phase like "Searching the web"),
// for the Inbox cards and the desktop app's notifications. Derived from the running turn's events on each read
// (@omni/shared/steps.ts), never stored: sync brings the events, so every machine derives the same line. It goes out
// as `step` on every thread the clients list, open or get from the feed, next to `delegating`, and only while the
// thread runs and is on a step. When a call or an answer moves it, the thread goes out on the feed again (watchSteps).
import { ANSWER_EVENT, QUESTION_EVENT } from '@omni/shared/question.ts';
import { stepLine, turnSteps } from '@omni/shared/steps.ts';
import { buildItems, isAsking, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { bus, EVENT_ADDED, publishFeed, type FeedEvent } from './bus.ts';
import { db, events, threads } from './db.ts';

/** The field a client thread carries. Absent unless it runs and is on a step. */
export interface StepField {
  step?: string;
}

/** Calls whose input makes the list: every other call's input is left out of the read, since only its name counts. */
const LIST_CALLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'mcp__omni-steps__set_steps', 'mcp__omni_steps__set_steps'];

/** The kinds that make up a turn's steps. */
const KINDS = ['user', 'crew_report', 'assistant_text', 'tool_use', 'tool_result', 'result', 'error', QUESTION_EVENT, ANSWER_EVENT];

/**
 * The running turn's rows: from the first message after the last turn's end. Read trimmed, since a long turn's calls
 * can carry whole files: a call keeps its name and parent, a result its first characters, a message only its start.
 */
function turnRows(threadId: string): TranscriptEvent[] {
  return db
    .prepare(
      `SELECT id, kind, created_at, CASE
         WHEN kind = 'tool_use' AND json_extract(payload, '$.name') NOT IN (${LIST_CALLS.map(() => '?').join(', ')})
           THEN json_object('id', json_extract(payload, '$.id'), 'name', json_extract(payload, '$.name'), 'parent', json_extract(payload, '$.parent'), 'input', json('{}'))
         WHEN kind = 'tool_result'
           THEN json_object('tool_use_id', json_extract(payload, '$.tool_use_id'), 'is_error', json(CASE WHEN json_extract(payload, '$.is_error') THEN 'true' ELSE 'false' END), 'text', substr(json_extract(payload, '$.text'), 1, 200))
         WHEN kind IN ('user', 'crew_report', 'assistant_text') THEN json_object('text', substr(json_extract(payload, '$.text'), 1, 40))
         ELSE payload END AS payload
       FROM events WHERE thread_id = ? AND kind IN (${KINDS.map(() => '?').join(', ')})
       AND id >= (SELECT MIN(id) FROM events WHERE thread_id = ? AND kind IN ('user', 'crew_report')
         AND id > COALESCE((SELECT MAX(id) FROM events WHERE thread_id = ? AND kind IN ('result', 'error')), 0))
       ORDER BY id`,
    )
    .all(...LIST_CALLS, threadId, ...KINDS, threadId, threadId) as unknown as TranscriptEvent[];
}

/** The last line read per thread and the newest event it was read at, so a list read does no fold twice. */
const read = new Map<string, { last: number; line: string | null }>();

/** The running thread's step line, or null. */
export function threadStep(t: { id: string; status?: string }): string | null {
  if (t.status !== 'running') {
    read.delete(t.id);
    return null;
  }
  const last = events.lastId(t.id);
  const hit = read.get(t.id);
  if (hit?.last === last) return hit.line;
  const rows = turnRows(t.id);
  const line = rows.length ? stepLine(turnSteps(buildItems(rows).items, { live: true, asking: isAsking(rows) })) : null;
  read.set(t.id, { last, line });
  return line;
}

export const stepField = (t: { id: string; status?: string }): StepField => {
  const step = threadStep(t);
  return step ? { step } : {};
};

/** The kinds that can move the line. */
const MOVES = new Set(['tool_use', 'tool_result', 'assistant_text', 'user', QUESTION_EVENT, ANSWER_EVENT]);

/** How long a burst of rows waits before the line is read again: a turn's calls come in bursts. */
export const STEP_SETTLE_MS = 250;

/**
 * Sends a running thread on the feed again when its step line changed, once a burst of its rows settles. A thread
 * update for some other reason carries the line already, so it counts as sent. Returns the stop.
 */
export function watchSteps(): () => void {
  const sent = new Map<string, string | null>();
  const timers = new Map<string, NodeJS.Timeout>();
  const check = (id: string) => {
    timers.delete(id);
    const t = threads.get(id);
    if (!t) return;
    const line = threadStep(t);
    if ((sent.get(id) ?? null) === line) return;
    sent.set(id, line);
    publishFeed({ type: 'thread', thread: t });
  };
  const onEvent = (threadId: string, kind: string) => {
    if (!MOVES.has(kind) || timers.has(threadId)) return;
    const timer = setTimeout(() => check(threadId), STEP_SETTLE_MS);
    timer.unref();
    timers.set(threadId, timer);
  };
  const onFeed = (e: FeedEvent) => {
    if (e.type !== 'thread') return;
    const t = e.thread as { id: string; status?: string };
    const line = threadStep(t);
    if (line === null && t.status !== 'running') sent.delete(t.id);
    else sent.set(t.id, line);
  };
  bus.on(EVENT_ADDED, onEvent);
  bus.on('feed', onFeed);
  return () => {
    bus.off(EVENT_ADDED, onEvent);
    bus.off('feed', onFeed);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
