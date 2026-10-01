// Live processes, the queue's waiting maps, and the helpers the lifecycle modules share.
import { readFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { DeliveryPhase } from '../delivery.ts';
import { config } from '../config.ts';
import { events, threads } from '../db.ts';
import { publishFeed, publishThread } from '../bus.ts';
import { describeAttachments, inlinable, messageContent, type Attachment } from '../uploads.ts';
import type { CommandList } from '../commands.ts';
import { CAPABILITIES, type HarnessId } from '../harness/types.ts';
import type { CommandUse, HarnessAdapter } from '../harness/adapter.ts';
import { claudeAdapter } from '../harness/claude/adapter.ts';
import { codexAdapter } from '../harness/codex/adapter.ts';
import { cursorAdapter } from '../harness/cursor/adapter.ts';
import { hermesAdapter } from '../harness/hermes/adapter.ts';

export const omniUrl = () => `http://127.0.0.1:${config.port}`;

const ADAPTERS: Record<string, HarnessAdapter> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  hermes: hermesAdapter,
};
export const adapterFor = (harness: string): HarnessAdapter => ADAPTERS[harness] ?? claudeAdapter;
const capsOf = (harness: string) => CAPABILITIES[harness as HarnessId] ?? CAPABILITIES['claude-code'];
export const harnessSteers = (threadId: string) => capsOf(threads.get(threadId)?.harness ?? 'claude-code').steer;

/** The concurrency cap for a harness. Claude Code uses OMNI_MAX_CONCURRENT. */
const CAPS: Record<string, number> = {
  'claude-code': config.maxConcurrent,
  codex: config.maxConcurrentCodex,
  cursor: config.maxConcurrentCursor,
  hermes: config.maxConcurrentHermes,
};
export const capFor = (harness: string) => CAPS[harness] ?? config.maxConcurrent;

/** The CLI name a harness shows in errors and the resume command. */
const CLI_LABEL: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor-agent', hermes: 'Hermes' };
export const cliLabel = (harness: string) => CLI_LABEL[harness] ?? harness;

// ---------- state ----------

/** steer: the agent reads it at its next step. queue: after the current turn. interrupt: stop the turn, then run it. */
export type SendMode = 'steer' | 'queue' | 'interrupt';

export interface Msg {
  uuid: string;
  text: string;
  mode: SendMode;
  /** Files Ben attached, already written into the thread's uploads folder. */
  attachments?: Attachment[];
  /** Written while a turn was already running, so the transcript marks where it steered. */
  midTurn?: boolean;
  /** Harness commands the text names, for the adapter. */
  commands?: CommandUse[];
  /** Recorded when the CLI replays this uuid, so it lands exactly where the agent saw it. */
  event: { kind: 'user' | 'crew_report'; payload: Record<string, unknown> };
}

export interface PendingMsg {
  uuid: string;
  kind: 'user' | 'crew_report';
  text: string;
  source?: string;
  mode: SendMode;
  /** waiting: for a free slot. sent: on stdin, read at the next step. held: runs after this turn. */
  state: 'waiting' | 'sent' | 'held';
  task_id?: string;
  role?: string;
}

/** One long-lived claude process per thread. It runs many turns and stays warm in between. */
export interface Live {
  threadId: string;
  channelId: string;
  /** null while secrets and the MCP config are prepared; inflight is written right after spawn. */
  child: ChildProcess | null;
  /** The adapter's stdin encoder, set right after spawn. */
  write: ((obj: unknown) => boolean) | null;
  /** Flush buffered adapter stdout on close. */
  flush: (() => void) | null;
  sessionId: string;
  /** A turn is in progress. Holds a concurrency slot. */
  turn: boolean;
  /** The CLI itself is inside a turn: between its init and its result. False in the gap between two queued turns. */
  cliTurn: boolean;
  /** One of our messages was replayed since the last result, so a zero-turn result answers it. */
  replayed: boolean;
  /** A turn the CLI opened by itself reports only the text written after this event id. */
  turnFrom: number;
  inflight: Msg[];
  held: Msg[];
  idleTimer?: ReturnType<typeof setTimeout>;
  interruptTimer?: ReturnType<typeof setTimeout>;
  /** Interrupt sent for the current turn; acked once the CLI answers the control request. */
  interrupt: { id: string; acked: boolean } | null;
  hardStop: boolean;
  /** stdin ended or the process is being killed. New messages wait for a fresh process. */
  closing: boolean;
  shutdown: boolean;
  /** Holds the channel's persistent browser profile. */
  browser: boolean;
  initSeen: boolean;
  /** Tasks the CLI runs beside the turn, by task id, until they end. Background ones keep the process alive. */
  tasks: Map<string, ActiveTask>;
  /** Progress persisted per task, at most every TASK_PROGRESS_MS. */
  taskSaved: Map<string, number>;
  /** The commands the process listed itself, once it has. */
  commands: CommandList | null;
  resultSeen: boolean;
  spawnFailed: boolean;
  exitedFlag: boolean;
  stderr: string;
  exited: Promise<void>;
  done: () => void;
}

/** A sub-agent, background shell or workflow still running in some thread's process. */
export interface ActiveTask {
  thread_id: string;
  channel_id: string;
  task_id: string;
  tool_use_id?: string;
  description: string;
  subagent_type?: string;
  task_type?: string;
  background: boolean;
  started_at: string;
  last_tool?: string;
  tool_uses?: number;
  tokens?: number;
  summary?: string;
}

export const lives = new Map<string, Live>();
export const waiting: string[] = []; // thread ids waiting for a slot, FIFO
export const waitingMsgs = new Map<string, Msg[]>();
export const browserHolder = new Map<string, string>(); // channel id -> thread id whose process holds the profile

// A let binding cannot be assigned from another module. Queue and session both read this.
let shuttingDown = false;
export const isShuttingDown = () => shuttingDown;
export const setShuttingDown = (on: boolean) => {
  shuttingDown = on;
};

// Queue and records own these. Session and the exit path call them without importing those modules back.
function unready(name: string): never {
  throw new Error(`runner ${name} is not ready`);
}
let pumpImpl: () => void = () => unready('pump');
let reportImpl: (childId: string, status: string, text: string) => void = () => unready('reportToParent');
let endTasksImpl: (live: Live) => void = () => unready('endTasks');
export const pump = () => pumpImpl();
export const reportToParent = (childId: string, status: string, text: string) => reportImpl(childId, status, text);
export const endTasks = (live: Live) => endTasksImpl(live);
export const bindPump = (fn: () => void) => {
  pumpImpl = fn;
};
export const bindReportToParent = (fn: (childId: string, status: string, text: string) => void) => {
  reportImpl = fn;
};
export const bindEndTasks = (fn: (live: Live) => void) => {
  endTasksImpl = fn;
};

export function emitThread(id: string) {
  const t = threads.get(id);
  if (t) publishFeed({ type: 'thread', thread: t });
}

export function addEvent(threadId: string, kind: string, payload: unknown) {
  const row = events.add(threadId, kind, payload);
  publishThread(threadId, row);
  return row;
}

export const alive = (c: ChildProcess) => c.exitCode === null && c.signalCode === null;

/** Every task still running, oldest first, for the sidebar and /api/tasks. */
export const activeTasks = (): ActiveTask[] =>
  [...lives.values()].flatMap((l) => [...l.tasks.values()]).sort((a, b) => a.started_at.localeCompare(b.started_at));

export const runningCount = () => [...lives.values()].filter((l) => l.turn).length;
export const queuedCount = () => waiting.length;

/** Running turns per harness, for the usage card footer and the harness endpoint. */
export const runningByHarness = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const l of lives.values()) {
    if (!l.turn) continue;
    const h = threads.get(l.threadId)?.harness ?? 'claude-code';
    out[h] = (out[h] ?? 0) + 1;
  }
  return out;
};

/** Running turns and cap per harness, for the usage card footer and the status endpoint. */
export function slotsByHarness(): Record<string, { running: number; cap: number }> {
  const running = runningByHarness();
  const out: Record<string, { running: number; cap: number }> = {};
  for (const h of Object.keys(CAPS)) out[h] = { running: running[h] ?? 0, cap: capFor(h) };
  return out;
}

/** This Mac runs the thread: a process is attached, or it waits for a slot. */
export const runsHere = (threadId: string) => lives.has(threadId) || waiting.includes(threadId);

/** A warm claude process exists for this thread. */
export const isLive = (threadId: string) => {
  const l = lives.get(threadId);
  return !!l?.child && !l.closing;
};

/** The commands a thread's running process listed itself, MCP prompts included. Null while none has. */
export function threadCommands(threadId: string): CommandList | null {
  return lives.get(threadId)?.commands ?? null;
}

const pendingView = (m: Msg, state: PendingMsg['state']): PendingMsg => {
  const p = m.event.payload as { text?: string; source?: string; task_id?: string | null; role?: string | null };
  return { uuid: m.uuid, kind: m.event.kind, text: p.text ?? m.text, source: p.source, mode: m.mode, state, task_id: p.task_id ?? undefined, role: p.role ?? undefined };
};

/** Messages the agent has not seen yet. Not in the transcript until their replay arrives. */
export function pendingFor(threadId: string): PendingMsg[] {
  const live = lives.get(threadId);
  return [
    ...(live?.inflight ?? []).map((m) => pendingView(m, 'sent')),
    ...(live?.held ?? []).map((m) => pendingView(m, 'held')),
    ...(waitingMsgs.get(threadId) ?? []).map((m) => pendingView(m, 'waiting')),
  ];
}

export const eventPayload = (m: Msg) => (m.event.kind === 'user' && m.midTurn ? { ...m.event.payload, mode: m.mode } : m.event.payload);

/** Messages the agent never saw. Recorded so the text is never lost. */
export function drop(threadId: string, msgs: Msg[]) {
  for (const m of msgs) addEvent(threadId, m.event.kind, { ...eventPayload(m), dropped: true });
}

/** startup: no child yet, or init has not arrived. running: the CLI has begun a turn. */
export const deliveryPhase = (live: Live): DeliveryPhase => (live.child && live.initSeen ? 'running' : 'startup');

export const hasBackground = (live: Live) => [...live.tasks.values()].some((t) => t.background);

// ---------- process ----------

export function writeLine(live: Live, obj: unknown) {
  return live.write ? live.write(obj) : false;
}

/**
 * Attachments add a note naming every file and where it is on disk, and images small enough for the
 * API ride along as real image blocks, so the agent sees them without a Read.
 */
function messageBody(m: Msg): string | ReturnType<typeof messageContent> {
  const attachments = m.attachments ?? [];
  if (!attachments.length) return m.text;
  const text = `${m.text}\n\n${describeAttachments(attachments)}`;
  return messageContent(
    text,
    attachments.filter(inlinable).map((a) => ({ mime: a.mime, data: readFileSync(a.path).toString('base64') })),
  );
}

export const userLine = (live: Live, m: Msg) => ({
  type: 'user',
  message: { role: 'user', content: messageBody(m) },
  parent_tool_use_id: null,
  session_id: live.sessionId,
  uuid: m.uuid,
  // Side channel for adapters that need the raw text, attachment paths and commands (Codex sends
  // images as localImage paths and skills as skill items). The Claude adapter strips this before
  // writing to its stdin.
  _omni: { text: m.text, attachments: m.attachments ?? [], commands: m.commands ?? [] },
});

/** stdin is gone: kill it so the close handler fails the turn and records what was not delivered. */
export const crash = (live: Live) => live.child && alive(live.child) && live.child.kill('SIGKILL');

export function send(live: Live, m: Msg) {
  live.inflight.push(m);
  if (live.child && !writeLine(live, userLine(live, m))) crash(live);
}
