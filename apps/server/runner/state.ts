// Live processes, the queue's waiting maps, and the helpers the lifecycle modules share.
import { readFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { HandoverP } from '@omni/shared/run-switch.ts';
import type { DeliveryPhase } from '../delivery.ts';
import { about } from '../about.ts';
import { config } from '../config.ts';
import { events, messageRequests, threads, type DeliveryState, type MessageRequest } from '../db.ts';
import { publishFeed, publishThread } from '../bus.ts';
import { describeAttachments, inlinable, messageContent, type Attachment } from '../uploads.ts';
import { contextAttachments, harnessText } from '../message-context/project.ts';
import type { CommandList } from '../commands.ts';
import { handOverWith } from './switch.ts';
import { CAPABILITIES, type HarnessId } from '../harness/types.ts';
import type { CommandUse, HarnessAdapter } from '../harness/adapter.ts';
import { claudeAdapter } from '../harness/claude/adapter.ts';
import { codexAdapter } from '../harness/codex/adapter.ts';
import { cursorAdapter } from '../harness/cursor/adapter.ts';
import { hermesAdapter } from '../harness/hermes/adapter.ts';
import { cursorCloudAdapter } from '../harness/cursor-cloud/adapter.ts';

/** Where a thread's MCP servers reach this server: the port it bound, which differs from the configured one when that is 0. */
export const omniUrl = () => `http://127.0.0.1:${about.port}`;

const ADAPTERS: Record<string, HarnessAdapter> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  hermes: hermesAdapter,
  'cursor-cloud': cursorCloudAdapter,
};
export const adapterFor = (harness: string): HarnessAdapter => ADAPTERS[harness] ?? claudeAdapter;
const capsOf = (harness: string) => CAPABILITIES[harness as HarnessId] ?? CAPABILITIES['claude-code'];
export const harnessSteers = (threadId: string) => capsOf(threads.get(threadId)?.harness ?? 'claude-code').steer;
/** What a send or Stop during a live turn can do on the thread's harness (delivery.ts). */
export const deliveryCaps = (threadId: string) => {
  const c = capsOf(threads.get(threadId)?.harness ?? 'claude-code');
  return { steer: c.steer, interrupt: c.interrupt };
};

/** The concurrency cap for a harness. Claude Code uses OMNI_MAX_CONCURRENT. */
const CAPS: Record<string, number> = {
  'claude-code': config.maxConcurrent,
  codex: config.maxConcurrentCodex,
  cursor: config.maxConcurrentCursor,
  hermes: config.maxConcurrentHermes,
  'cursor-cloud': config.maxConcurrentCursorCloud,
};
export const capFor = (harness: string) => CAPS[harness] ?? config.maxConcurrent;

/** The CLI name a harness shows in errors and the resume command. */
const CLI_LABEL: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor-agent', hermes: 'Hermes', 'cursor-cloud': 'Cursor Cloud' };
export const cliLabel = (harness: string) => CLI_LABEL[harness] ?? harness;

// ---------- state ----------

/** steer: the agent reads it at its next step. queue: after the current turn. interrupt: stop the turn, then run it. */
export type SendMode = 'steer' | 'queue' | 'interrupt';

export interface Msg {
  /** For a message sent through the API, also its message_requests row id (db/repos/requests.ts). */
  uuid: string;
  /** The client's request id. Set only on messages with a durable row, whose delivery state is tracked. */
  requestId?: string;
  text: string;
  mode: SendMode;
  /** Files Ben attached, already written into the thread's uploads folder. */
  attachments?: Attachment[];
  /** Records Ben attached. Turned into text only when written to the harness (userLine). */
  contexts?: MessageContext[];
  /** Written while a turn was already running, so the transcript marks where it steered. */
  midTurn?: boolean;
  /** Harness commands the text names, for the adapter. */
  commands?: CommandUse[];
  /** Recorded when the CLI replays this uuid, so it lands exactly where the agent saw it. */
  event: { kind: 'user' | 'crew_report'; payload: Record<string, unknown> };
  /** Omni wrote it (a crew report, a team's go): Ben can resume or discard it, not edit or move it. */
  byOmni?: boolean;
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
  /** A crew report: the thread that reported. */
  thread_id?: string;
  /** Messages sent through the API: the client's request id, and where the durable row says it is (db/repos/requests.ts). */
  request_id?: string;
  delivery?: DeliveryState;
  attachments?: Attachment[];
  context?: MessageContext[];
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
  /** Ask the harness for a full context reading. Null when it can't. */
  requestContext: (() => boolean) | null;
  sessionId: string;
  /** The harness it was spawned for. A switch synced from another machine changes the thread's, not this process's. */
  harness?: string;
  /** A turn is in progress. Holds a concurrency slot. */
  turn: boolean;
  /** The CLI itself is inside a turn: between its init and its result. False in the gap between two queued turns. */
  cliTurn: boolean;
  /** One of our messages was replayed since the last result, so a zero-turn result answers it. */
  replayed: boolean;
  /** The harness refused this turn at its usage limit (and when it resets, if it said). A failed result makes it a limit stop. */
  limit: { resets_at: number | null } | null;
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
  /** The status line each mod set with $.ui.status, by plugin, until it clears it or the process ends. */
  mods: Map<string, ModStatus>;
  /** The commands the process listed itself, once it has. */
  commands: CommandList | null;
  resultSeen: boolean;
  spawnFailed: boolean;
  exitedFlag: boolean;
  stderr: string;
  exited: Promise<void>;
  done: () => void;
  /** The turn whose snapshots are being saved (runner/snapshots.ts), until it ends. */
  snap?: string | null;
  /** Set while the checkout is saved before a turn: messages wait in `gated` until it is, so the harness edits nothing first. */
  gate?: Promise<void> | null;
  gated?: Msg[];
  /** The message carrying the handover, and the event recorded once the harness reads it (runner/switch.ts). */
  handover?: { uuid: string; done: HandoverP };
  /** A handover still waits for a message that is not a command: the next one sent carries it. */
  handoverDue?: boolean;
  /** Set while the thread is handed to another Mac (session.ts releaseForHandoff): what the process never read goes here, not dropped. */
  released?: Msg[];
}

/** A sub-agent, background shell or workflow still running in some thread's process. */
export interface ActiveTask {
  thread_id: string;
  channel_id: string;
  /** The team lead a member thread runs under: the sidebar lists the lead, so the agent nests there. */
  lead_id?: string;
  task_id: string;
  tool_use_id?: string;
  description: string;
  subagent_type?: string;
  task_type?: string;
  /** An agent it spawned (Agent call, workflow, fork, teammate), not a background shell or monitor. */
  subagent: boolean;
  /** The stored row that started it, for jumping to that point in the thread. */
  event_id?: number;
  background: boolean;
  started_at: string;
  last_tool?: string;
  tool_uses?: number;
  tokens?: number;
  summary?: string;
}

/** A mod's pinned status line in some thread's running process. One per plugin. */
export interface ModStatus {
  thread_id: string;
  channel_id: string;
  plugin: string;
  text: string;
  updated_at: string;
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

/** An error the API answers with `status`. */
export const refusal = (message: string, status: number) => Object.assign(new Error(message), { status });

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

/** Every mod status line still pinned, oldest first, for the thread views and /api/mods. */
export const activeMods = (): ModStatus[] =>
  [...lives.values()].flatMap((l) => [...l.mods.values()]).sort((a, b) => a.updated_at.localeCompare(b.updated_at));

export const publishMods = () => publishFeed({ type: 'mods', mods: activeMods() });

/** The process is gone: its mods went with it. */
export function clearMods(live: Live) {
  if (!live.mods.size) return;
  live.mods.clear();
  publishMods();
}

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

/** Ask a warm process for a fresh context reading. False when there is none to ask. */
export function refreshContext(threadId: string): boolean {
  const l = lives.get(threadId);
  return !!l?.child && !l.closing && !!l.requestContext?.();
}

/** The current process's commands, MCP prompts included. A closing process may belong to the previous harness. */
export function threadCommands(threadId: string): CommandList | null {
  const live = lives.get(threadId);
  return live && !live.closing ? live.commands : null;
}

type ShownPayload = { text?: string; source?: string; task_id?: string | null; role?: string | null; thread_id?: string | null };

/** A pending row as the clients get it. Only a crew report names the thread that reported. */
const pendingRow = (
  base: Pick<PendingMsg, 'uuid' | 'kind' | 'text' | 'mode' | 'state'>,
  p: ShownPayload,
  rest: Pick<PendingMsg, 'request_id' | 'delivery' | 'attachments' | 'context'>,
): PendingMsg => ({
  uuid: base.uuid, kind: base.kind, text: base.text, source: p.source, mode: base.mode, state: base.state, task_id: p.task_id ?? undefined, role: p.role ?? undefined,
  ...(base.kind === 'crew_report' && p.thread_id && { thread_id: p.thread_id }),
  ...rest,
});

const pendingView = (m: Msg, state: PendingMsg['state']): PendingMsg => {
  const p = m.event.payload as ShownPayload;
  return pendingRow({ uuid: m.uuid, kind: m.event.kind, text: p.text ?? m.text, mode: m.mode, state }, p, {
    ...(m.requestId && { request_id: m.requestId, delivery: state }),
    ...(m.attachments?.length && { attachments: m.attachments }),
    ...(m.contexts?.length && { context: m.contexts }),
  });
};

/** A saved request as the runner carries it. Only for one Omni wrote itself; Ben's go through `messageFor` (api.ts). */
export const requestMsg = (r: MessageRequest): Msg => ({
  uuid: r.id,
  requestId: r.request_id,
  text: r.prompt,
  mode: r.mode,
  event: { kind: r.kind, payload: r.payload ?? { text: r.prompt, source: r.source } },
  byOmni: true,
});

/**
 * Messages the agent has not seen yet. Not in the transcript until their replay arrives. Last, the ones a restart
 * parked: shown as held, with their delivery saying whether they wait for Resume or may already have been read.
 */
export function pendingFor(threadId: string): PendingMsg[] {
  const live = lives.get(threadId);
  return [
    ...(live?.inflight ?? []).map((m) => pendingView(m, 'sent')),
    ...(live?.held ?? []).map((m) => pendingView(m, 'held')),
    ...(waitingMsgs.get(threadId) ?? []).map((m) => pendingView(m, 'waiting')),
    // A worktree thread's first prompt while the worktree is made: saved, waiting for it.
    ...(threads.get(threadId)?.setup === 'preparing' ? messageRequests.unstarted(threadId) : []).map(
      (r): PendingMsg =>
        pendingRow({ uuid: r.id, kind: r.kind, text: r.prompt, mode: r.mode, state: 'waiting' }, { source: r.source }, {
          request_id: r.request_id,
          delivery: r.state,
          ...(r.attachments?.length && { attachments: r.attachments }),
          ...(r.context?.length && { context: r.context }),
        }),
    ),
    ...messageRequests.parked(threadId).map(
      (r): PendingMsg =>
        pendingRow({ uuid: r.id, kind: r.kind, text: (r.payload?.text as string | undefined) ?? r.prompt, mode: r.mode, state: 'held' }, { source: r.source, ...r.payload }, {
          request_id: r.request_id,
          delivery: r.state,
          ...(r.attachments?.length && { attachments: r.attachments }),
          ...(r.context?.length && { context: r.context }),
        }),
    ),
  ];
}

/** Record where a durable message is now. A message without a request row (a thread's first prompt) has nothing to track. */
export function track(m: Msg, state: DeliveryState, eventId?: number) {
  if (m.requestId) messageRequests.mark(m.uuid, state, eventId);
}

export const eventPayload = (m: Msg) => (m.event.kind === 'user' && m.midTurn ? { ...m.event.payload, mode: m.mode } : m.event.payload);

/**
 * Messages the agent never saw. Recorded so the text is never lost. While Omni shuts down, a durable one is
 * parked for after the restart instead (recovered, or uncertain once it was written to the harness).
 */
export function drop(threadId: string, msgs: Msg[]) {
  for (const m of msgs) {
    if (m.requestId && shuttingDown && messageRequests.park(m.uuid)) continue;
    track(m, 'dropped');
    addEvent(threadId, m.event.kind, { ...eventPayload(m), dropped: true });
  }
}

/** Messages this process will never read: kept for the Mac the thread is handed to, else dropped. */
export function unread(live: Live, msgs: Msg[]) {
  if (live.released) live.released.push(...msgs);
  else drop(live.threadId, msgs);
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
function messageBody(text: string, attachments: Attachment[]): string | ReturnType<typeof messageContent> {
  if (!attachments.length) return text;
  return messageContent(
    `${text}\n\n${describeAttachments(attachments)}`,
    attachments.filter(inlinable).map((a) => ({ mime: a.mime, data: readFileSync(a.path).toString('base64') })),
  );
}

export const userLine = (live: Live, m: Msg) => {
  // Context is projected here, as the harness gets it, so a check of the file holds now, not when it was sent. A thread
  // deleted meanwhile (by sync, from the other Mac) has no checkout to place it in; never throw on the write path.
  const thread = threads.get(live.threadId);
  const text = thread ? harnessText(m.text, m.contexts, thread) : m.text;
  // The images its context items name travel as attachments, so each harness takes them its own way.
  const attachments = [...(m.attachments ?? []), ...contextAttachments(m.contexts)];
  return {
    type: 'user',
    message: { role: 'user', content: messageBody(text, attachments) },
    parent_tool_use_id: null,
    session_id: live.sessionId,
    uuid: m.uuid,
    // Side channel for adapters that need the raw text, attachment paths and commands (Codex sends
    // images as localImage paths and skills as skill items). The Claude adapter strips this before
    // writing to its stdin.
    _omni: { text, attachments, commands: m.commands ?? [] },
  };
};

/** stdin is gone: kill it so the close handler fails the turn and records what was not delivered. */
export const crash = (live: Live) => live.child && alive(live.child) && live.child.kill('SIGKILL');

/** Write a message to the harness. Before the process exists it waits in inflight, and spawn writes it. */
export function send(live: Live, m: Msg) {
  if (live.handoverDue) handOverWith(live, m);
  live.inflight.push(m);
  if (!live.child) return;
  // The checkout before this turn is still being saved: written once it is (runner/snapshots.ts).
  if (live.gate) {
    (live.gated ??= []).push(m);
    return;
  }
  // Marked first: a write that fails can still have reached the harness.
  track(m, 'sent');
  if (!writeLine(live, userLine(live, m))) crash(live);
}
