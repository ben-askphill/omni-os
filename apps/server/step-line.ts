// The step a running thread is on, in one line ("Step 3 of 5 · Compare prices", or a phase like "Searching the web"),
// for the Inbox cards and the desktop app's notifications. Derived from the running turn's events on each read
// (@omni/shared/steps.ts), never stored: sync brings the events, so every machine derives the same line. It goes out
// as `step` on every thread the clients list, open or get from the feed, next to `delegating`, and only while the
// thread runs and is on a step. When a call or an answer moves it, the thread goes out on the feed again (watchSteps).
// A delegated thread also carries its list in brief as `progress` on its parent's detail and the feed, running or not,
// for the delegation card (progressField).
import { ANSWER_EVENT, QUESTION_EVENT } from '@omni/shared/question.ts';
import { stepLine, stepProgress, turnSteps, type ProgressField, type StepField, type StepsView } from '@omni/shared/steps.ts';
import { buildItems, isAsking, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { bus, EVENT_ADDED, publishFeed, type FeedEvent } from './bus.ts';
import { db, events, threads } from './db.ts';

/** Calls whose input makes the list: every other call's input is left out of the read, since only its name counts. */
const LIST_CALLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'mcp__omni-steps__set_steps', 'mcp__omni_steps__set_steps'];

/** The kinds that make up a turn's steps. */
const KINDS = ['user', 'crew_report', 'assistant_text', 'tool_use', 'tool_result', 'result', 'error', QUESTION_EVENT, ANSWER_EVENT];

/** The input fields plainCall words a call's "now" from: kept short, the rest of a call's input is left out. */
const NOW_KEYS = ['description', 'file_path', 'notebook_path', 'path', 'pattern', 'query', 'url', 'title', 'role'];
const NOW_INPUT = `json_object(${NOW_KEYS.map((k) => `'${k}', substr(json_extract(payload, '$.input.${k}'), 1, 120)`).join(', ')})`;

/**
 * The newest turn's rows: from the first message after the end that came before the newest message, so a running turn
 * and a finished one read alike. Read trimmed, since a long turn's calls can carry whole files: a call keeps its name,
 * parent and the few fields its plain words use, a result its first characters, a message only its start.
 */
function turnRows(threadId: string): TranscriptEvent[] {
  return db
    .prepare(
      `SELECT id, kind, created_at, CASE
         WHEN kind = 'tool_use' AND json_extract(payload, '$.name') NOT IN (${LIST_CALLS.map(() => '?').join(', ')})
           THEN json_object('id', json_extract(payload, '$.id'), 'name', json_extract(payload, '$.name'), 'parent', json_extract(payload, '$.parent'), 'input', json(${NOW_INPUT}))
         WHEN kind = 'tool_result'
           THEN json_object('tool_use_id', json_extract(payload, '$.tool_use_id'), 'is_error', json(CASE WHEN json_extract(payload, '$.is_error') THEN 'true' ELSE 'false' END), 'text', substr(json_extract(payload, '$.text'), 1, 200))
         WHEN kind IN ('user', 'crew_report', 'assistant_text') THEN json_object('text', substr(json_extract(payload, '$.text'), 1, 40))
         ELSE payload END AS payload
       FROM events WHERE thread_id = ? AND kind IN (${KINDS.map(() => '?').join(', ')})
       AND id >= (SELECT MIN(id) FROM events WHERE thread_id = ? AND kind IN ('user', 'crew_report')
         AND id > COALESCE((SELECT MAX(id) FROM events WHERE thread_id = ? AND kind IN ('result', 'error')
           AND id < (SELECT MAX(id) FROM events WHERE thread_id = ? AND kind IN ('user', 'crew_report'))), 0))
       ORDER BY id`,
    )
    .all(...LIST_CALLS, threadId, ...KINDS, threadId, threadId, threadId) as unknown as TranscriptEvent[];
}

/** The newest turn's steps per thread, the newest event and whether it ran when read, so a list read does no fold twice. */
const read = new Map<string, { last: number; live: boolean; view: StepsView | null }>();

function viewOf(id: string, live: boolean): StepsView | null {
  const last = events.lastId(id);
  const hit = read.get(id);
  if (hit?.last === last && hit.live === live) return hit.view;
  const rows = turnRows(id);
  const view = rows.length ? turnSteps(buildItems(rows).items, { live, asking: live && isAsking(rows) }) : null;
  read.set(id, { last, live, view });
  return view;
}

/** A thread that can sit on a delegation card: one another thread delegated to, a team member included. */
const delegated = (t: { parent_id?: string | null; source?: string | null }) => !!t.parent_id && t.source !== 'member';

type Read = { id: string; status?: string; parent_id?: string | null; source?: string | null };

/** The running thread's step line, or null. */
export function threadStep(t: { id: string; status?: string }): string | null {
  if (t.status !== 'running') {
    if (!delegated(t as Read)) read.delete(t.id);
    return null;
  }
  return stepLine(viewOf(t.id, true));
}

export const stepField = (t: { id: string; status?: string }): StepField => {
  const step = threadStep(t);
  return step ? { step } : {};
};

/** A delegated thread's list in brief (StepProgress), running or not, or null with no list. */
export function threadProgress(t: Read) {
  if (!delegated(t)) return null;
  return stepProgress(viewOf(t.id, t.status === 'running'));
}

/** `progress` on a delegated thread its parent's detail lists or the feed sends, for the delegation cards. */
export const progressField = (t: Read): ProgressField => {
  const progress = threadProgress(t);
  return progress ? { progress } : {};
};

/** What the feed has to send again when it moves: the step line, and a delegated thread's brief with its "now". */
const signature = (t: Read) => {
  const line = threadStep(t);
  const p = t.status === 'running' ? threadProgress(t) : null;
  return p ? `${line}\n${p.at}/${p.done}/${p.count}/${p.state}/${p.title}/${p.now}` : line;
};

/** The kinds that can move the line. */
const MOVES = new Set(['tool_use', 'tool_result', 'assistant_text', 'user', QUESTION_EVENT, ANSWER_EVENT]);

/** How long a burst of rows waits before the line is read again: a turn's calls come in bursts. */
export const STEP_SETTLE_MS = 250;

/**
 * Sends a running thread on the feed again when its step line changed, or a delegated one's brief (`signature`), once a
 * burst of its rows settles. A thread update for some other reason carries the line already, so it counts as sent.
 * Returns the stop.
 */
export function watchSteps(): () => void {
  const sent = new Map<string, string | null>();
  const timers = new Map<string, NodeJS.Timeout>();
  const check = (id: string) => {
    timers.delete(id);
    const t = threads.get(id);
    if (!t) return;
    const line = signature(t);
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
    const t = e.thread as Read;
    const line = signature(t);
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
