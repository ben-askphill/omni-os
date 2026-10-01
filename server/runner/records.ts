// Stream records: tasks, results, and the process exit.
import { events, threads, type ThreadStatus } from '../db.ts';
import { publishFeed } from '../bus.ts';
import { turnFinished } from '../sync/files.ts';
import { type Record as StreamRecord, type TaskUpdate } from '../stream.ts';
import { armIdle, clearInterrupt, endTurn, teardown } from './session.ts';
import {
  activeTasks,
  addEvent,
  bindEndTasks,
  cliLabel,
  drop,
  emitThread,
  eventPayload,
  hasBackground,
  isShuttingDown,
  pump,
  reportToParent,
  send,
  type Live,
} from './state.ts';

type ResultPayload = Extract<StreamRecord, { kind: 'result' }>['payload'];

const TASK_PROGRESS_MS = 20_000;

// Progress comes in bursts from every agent at once; one feed update per second is plenty.
let tasksTimer: ReturnType<typeof setTimeout> | undefined;
function publishTasks(now = false) {
  if (now) {
    clearTimeout(tasksTimer);
    tasksTimer = undefined;
    return publishFeed({ type: 'tasks', tasks: activeTasks() });
  }
  tasksTimer ??= setTimeout(() => {
    tasksTimer = undefined;
    publishFeed({ type: 'tasks', tasks: activeTasks() });
  }, 1000);
}

export function onTask(live: Live, u: TaskUpdate) {
  const id = live.threadId;
  const known = live.tasks.get(u.task_id);
  if (u.event === 'started') {
    live.tasks.set(u.task_id, {
      thread_id: id,
      channel_id: live.channelId,
      task_id: u.task_id,
      tool_use_id: u.tool_use_id,
      description: u.description || 'Task',
      subagent_type: u.subagent_type,
      task_type: u.task_type,
      // Agents started with run_in_background say so here; a foreground one can be backgrounded later.
      background: !!u.background,
      started_at: new Date().toISOString(),
    });
    live.taskSaved.set(u.task_id, Date.now());
    addEvent(id, 'task', u);
    return publishTasks(true);
  }
  if (u.event === 'progress') {
    if (!known) return;
    Object.assign(known, {
      description: u.description ?? known.description,
      background: u.background ?? known.background,
      last_tool: u.last_tool ?? known.last_tool,
      tool_uses: u.tool_uses ?? known.tool_uses,
      tokens: u.tokens ?? known.tokens,
      summary: u.summary ?? known.summary,
    });
    // A task backgrounded mid-turn now keeps the process alive; a stored row keeps the transcript honest.
    const last = live.taskSaved.get(u.task_id) ?? 0;
    if (u.background !== undefined || Date.now() - last >= TASK_PROGRESS_MS) {
      live.taskSaved.set(u.task_id, Date.now());
      addEvent(id, 'task', u);
    }
    return publishTasks();
  }
  // Ended. The CLI can report the end twice (a status patch, then the notification); keep the first.
  if (!known) return;
  live.tasks.delete(u.task_id);
  live.taskSaved.delete(u.task_id);
  addEvent(id, 'task', u);
  publishTasks(true);
  if (!live.turn && !hasBackground(live)) armIdle(live);
}

/** The process is gone: whatever it still ran ended with it. */
export function endTasks(live: Live) {
  if (!live.tasks.size) return;
  for (const t of live.tasks.values()) addEvent(live.threadId, 'task', { task_id: t.task_id, tool_use_id: t.tool_use_id, event: 'ended', status: 'stopped' });
  live.tasks.clear();
  live.taskSaved.clear();
  publishTasks(true);
}

bindEndTasks(endTasks);

export function onResult(live: Live, p: ResultPayload) {
  const id = live.threadId;
  live.resultSeen = true;
  live.cliTurn = false;
  const answered = live.replayed;
  live.replayed = false;
  // On resume the CLI can flush a leftover background task as an empty zero-turn result, before it has
  // taken any message of ours. Not a turn.
  if (p.ok && !p.turns && !answered) return;
  // A local slash command (/cost, /context, /compact) never calls the model: zero turns, and its output
  // is the result text, with no assistant message to duplicate.
  if (p.ok && !p.turns && p.text?.trim()) addEvent(id, 'assistant_text', { text: p.text });
  const intr = live.interrupt;
  // Unacked and ok: the turn finished before the CLI read our interrupt. The CLI answers it in the gap
  // before its next turn (and it stops nothing), or during that turn, which it then stops.
  const stopped = !!intr && (intr.acked || !p.ok);
  // The result text duplicates the last assistant message; keep only the metadata.
  addEvent(id, 'result', { ...p, text: undefined, stopped: stopped || undefined });
  if (!live.turn) return;
  if (stopped) clearInterrupt(live);
  // Steers the CLI has not replayed yet: it starts the next turn with them on its own.
  if (live.inflight.length) return emitThread(id);
  const next = live.held.shift();
  if (next) {
    send(live, next);
    return emitThread(id);
  }
  endTurn(live, stopped ? 'stopped' : p.ok ? 'done' : 'failed');
}

export function onRecord(live: Live, rec: StreamRecord) {
  const id = live.threadId;
  switch (rec.kind) {
    case 'replay': {
      const i = live.inflight.findIndex((m) => m.uuid === rec.payload.uuid);
      if (i < 0) return;
      const [m] = live.inflight.splice(i, 1);
      live.replayed = true;
      addEvent(id, m.event.kind, eventPayload(m));
      return emitThread(id);
    }
    case 'control':
      if (live.interrupt?.id !== rec.payload.request_id) return;
      // Answered between two CLI turns there was nothing to stop: the queued messages run as the next turn
      // like after any interrupt, and that turn must not be killed by the grace timer or marked stopped.
      if (rec.payload.subtype === 'success' && live.cliTurn) live.interrupt.acked = true;
      else clearInterrupt(live); // nothing to interrupt; the turn ends on its own
      return;
    case 'init':
      live.cliTurn = true;
      // The CLI emits one per turn. Only the first per process is worth showing.
      if (live.initSeen) return;
      live.initSeen = true;
      addEvent(id, 'init', rec.payload);
      return;
    case 'result':
      return onResult(live, rec.payload);
    case 'task':
      return onTask(live, rec.payload);
    default: {
      // The model is working with no turn of ours open: a background task finished and the CLI runs a turn
      // about it by itself. Track it like any other so status, last_text and the parent report follow.
      const opens = !live.turn && !live.closing && (rec.kind === 'assistant_text' || (rec.kind === 'tool_use' && !rec.payload.parent));
      if (opens) openTurn(live);
      const row = addEvent(id, rec.kind, rec.payload);
      if (opens) live.turnFrom = row.id - 1;
    }
  }
}

/** A turn the CLI started on its own. It takes a slot even past the cap: the work is already running. */
export function openTurn(live: Live) {
  live.turn = true;
  clearTimeout(live.idleTimer);
  threads.update(live.threadId, { status: 'running' });
  emitThread(live.threadId);
}

export function onExit(live: Live, code: number | null, signal: NodeJS.Signals | null) {
  if (live.exitedFlag) return;
  live.exitedFlag = true;
  const id = live.threadId;
  const wasTurn = live.turn;
  const undelivered = [...live.inflight, ...live.held];
  teardown(live);
  const thread = threads.get(id);
  if (thread && wasTurn) {
    const status: ThreadStatus = live.hardStop ? 'stopped' : 'failed';
    const runText = events.lastRunText(id);
    if (live.shutdown) addEvent(id, 'error', { text: 'Omni shut down while this turn was running.' });
    else if (!live.hardStop && !live.spawnFailed) {
      const how = code === null ? `signal ${signal}` : `code ${code}`;
      addEvent(id, 'error', { text: `${cliLabel(thread.harness)} exited with ${how}.\n${live.stderr.trim().slice(-2000)}` });
    }
    drop(id, undelivered);
    threads.update(id, {
      status,
      // Once the CLI has written the session file, later messages must --resume it.
      has_run: live.resultSeen || thread.has_run ? 1 : 0,
      last_text: runText ? runText.slice(0, 600) : thread.last_text,
    });
    if (thread.parent_id && status !== 'stopped' && !isShuttingDown()) reportToParent(id, status, runText);
  } else if (thread && live.resultSeen && !thread.has_run) {
    threads.update(id, { has_run: 1, updated_at: thread.updated_at });
  }
  if (thread && (wasTurn || live.resultSeen)) void turnFinished(id);
  emitThread(id);
  pump();
}
