// Live processes, the queue's waiting maps, and the helpers the lifecycle modules share.
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { DeliveryPhase } from '../delivery.ts';
import { about } from '../about.ts';
import { config } from '../config.ts';
import { events, messageRequests, outbox, remoteCommands, threads, type DeliveryState, type EventRow, type MessageRequest, type ThreadStatus } from '../db.ts';
import { bus, EVENT_ADDED, publishFeed, publishThread } from '../bus.ts';
import type { Attachment } from '../uploads.ts';
import { contextAttachments, harnessText } from '../message-context/project.ts';
import type { CommandList } from '../commands.ts';
import type { Live } from './controller.ts';
import { handOverWith } from './switch.ts';
import { CAPABILITIES, type AnyHarnessId } from '../harness/types.ts';
import type { CommandUse, HarnessAdapter, OutgoingMessage } from '../harness/adapter.ts';
import { claudeAdapter } from '../harness/claude/adapter.ts';
import { codexAdapter } from '../harness/codex/adapter.ts';
import { cursorAdapter } from '../harness/cursor/adapter.ts';
import { hermesAdapter, runsApiAdapter } from '../harness/hermes/adapter.ts';
import { cursorCloudAdapter } from '../harness/cursor-cloud/adapter.ts';
import { customHarness, customHarnesses } from '../harness/custom.ts';
import { harnessName, missingHarness } from '../harness/registry.ts';
import { detachedSession } from '../harness/session.ts';

/** Where a thread's MCP servers reach this server: the port it bound, which differs from the configured one when that is 0. */
export const omniUrl = () => `http://127.0.0.1:${about.port}`;

const ADAPTERS: Record<string, HarnessAdapter> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
  hermes: hermesAdapter,
  'cursor-cloud': cursorCloudAdapter,
};
/**
 * A harness this machine does not have: a custom harness whose file is gone or not synced here yet, or an id no build
 * knows. Its session runs nothing: every message gets the reason and the turn fails. spawn.ts refuses such a thread
 * before this, so it is the last guard, never a fallback onto another harness.
 */
function missingAdapter(harness: string): HarnessAdapter {
  const reason = missingHarness(harness) ?? `No harness ${harness} on this machine.`;
  return {
    id: harness as AnyHarnessId,
    capabilities: NO_CAPS,
    freshSessionId: (t) => t.id,
    spawn(_ctx, cb) {
      const session = detachedSession(cb, {
        send(m) {
          cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
          cb.record({ kind: 'error', payload: { text: reason } });
          cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
          session.end('terminate');
          return true;
        },
        interrupt: () => true,
      });
      return session;
    },
  };
}

/** What a missing harness can do: nothing that would start work. */
const NO_CAPS = { ...CAPABILITIES.hermes, steer: false, interrupt: false };

/** The adapter a thread's harness runs on. A custom harness runs on the Runs API adapter; an unknown id refuses. */
export function adapterFor(harness: string): HarnessAdapter {
  const builtIn = ADAPTERS[harness];
  if (builtIn) return builtIn;
  const custom = customHarness(harness);
  return custom ? runsApiAdapter(custom.id, custom.capabilities) : missingAdapter(harness);
}
const capsOf = (harness: string) => CAPABILITIES[harness as keyof typeof CAPABILITIES] ?? customHarness(harness)?.capabilities ?? NO_CAPS;
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
/** A custom harness's cap is in its file. An id with no harness here takes the smallest, though it never starts. */
export const capFor = (harness: string) => CAPS[harness] ?? customHarness(harness)?.cap ?? 1;
/** Every harness's cap, custom ones included, as this machine announces them to the others (sync/devices.ts). */
export const slotCaps = (): Record<string, number> => ({ ...CAPS, ...Object.fromEntries(customHarnesses().map((h) => [h.id, h.cap])) });

/** The CLI name a harness shows in errors and the resume command. */
const CLI_LABEL: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor-agent', hermes: 'Hermes', 'cursor-cloud': 'Cursor Cloud' };
export const cliLabel = (harness: string) => CLI_LABEL[harness] ?? harnessName(harness);

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
  /**
   * `routed`: Ben's message as one agent of a group thread reads it, recorded hidden (runner/members.ts). `notice`:
   * Omni telling an agent which files another agent changed (runner/collisions.ts), recorded hidden too.
   */
  event: { kind: 'user' | 'crew_report' | 'routed' | 'notice'; payload: Record<string, unknown> };
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
  /**
   * Ben's message to a thread another machine holds, which that machine has not taken yet (run-on.ts): its name, and
   * when it was sent. It leaves the list once the holder answers: taken, it shows in the transcript when the turn
   * syncs back; refused or expired, it shows there as not delivered, with why (remote-outcomes.ts).
   */
  forwarded_to?: string;
  sent_at?: string;
}

/**
 * One long-lived claude process per thread. It runs many turns and stays warm in between. Its state is the thread's
 * controller (controller.ts), read here and moved only through the controller's methods.
 */
export type { Live } from './controller.ts';

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
/** Called once a thread's turn is over: ended, failed, stopped or refused before it started (runner/members.ts). */
export const turnEnded: ((threadId: string, status: ThreadStatus) => void)[] = [];
/** Cancel pending group starts and stop the member sessions (runner/members.ts). */
export const groupStopping: ((threadId: string, stop: (sessionId: string) => void) => void)[] = [];
export function endedTurn(threadId: string, status: ThreadStatus) {
  for (const f of turnEnded) {
    try {
      f(threadId, status);
    } catch (err) {
      console.error(`[runner] after the turn of ${threadId}:`, err);
    }
  }
}
/** Called for every tool call a run records: (the session that ran it, its row, its payload) (runner/collisions.ts). */
export const toolUsed: ((sessionThread: string, row: EventRow, payload: unknown) => void)[] = [];
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

/** `agent`: the agent that wrote the row, on the rows a run of the thread writes. None on Ben's and Omni's own. */
export function addEvent(threadId: string, kind: string, payload: unknown, agent: string | null = null) {
  const row = events.add(threadId, kind, payload, undefined, agent);
  // A member's session writes into its group thread's transcript (db/repos/events.ts), which the clients watch.
  publishThread(row.thread_id, row);
  // The step a running thread is on may have moved (step-line.ts).
  bus.emit(EVENT_ADDED, row.thread_id, kind);
  if (row.thread_id !== threadId) bus.emit(EVENT_ADDED, threadId, kind);
  if (kind === 'tool_use') {
    for (const f of toolUsed) {
      try {
        f(threadId, row, payload);
      } catch (err) {
        console.error(`[runner] after a tool call in ${threadId}:`, err);
      }
    }
  }
  return row;
}

/** Every task still running, oldest first, for the sidebar and /api/tasks. */
export const activeTasks = (): ActiveTask[] =>
  [...lives.values()].flatMap((l) => [...l.tasks.values()]).sort((a, b) => a.started_at.localeCompare(b.started_at));

/** Every mod status line still pinned, oldest first, for the thread views and /api/mods. */
export const activeMods = (): ModStatus[] =>
  [...lives.values()].flatMap((l) => [...l.mods.values()]).sort((a, b) => a.updated_at.localeCompare(b.updated_at));

export const publishMods = () => publishFeed({ type: 'mods', mods: activeMods() });

/** The process is gone: its mods went with it. */
export function clearMods(live: Live) {
  if (live.clearMods()) publishMods();
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
  for (const [h, cap] of Object.entries(slotCaps())) out[h] = { running: running[h] ?? 0, cap };
  return out;
}

/** This Mac runs the thread: a process is attached, or it waits for a slot. */
export const runsHere = (threadId: string) => lives.has(threadId) || waiting.includes(threadId);

/** A warm claude process exists for this thread. */
export const isLive = (threadId: string) => {
  const l = lives.get(threadId);
  return !!l?.session && !l.closing;
};

/** Ask a warm process for a fresh context reading. False when there is none to ask. */
export function refreshContext(threadId: string): boolean {
  const l = lives.get(threadId);
  return !!l?.session && !l.closing && !!l.session.requestContext?.();
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

/** A group agent's copy of Ben's message waits as his message (runner/members.ts). */
const shownKind = (k: Exclude<Msg['event']['kind'], 'notice'>): PendingMsg['kind'] => (k === 'routed' ? 'user' : k);
/** Omni's notices to an agent are no message of Ben's: they never show as pending. */
const shown = (m: Msg): m is Msg & { event: { kind: Exclude<Msg['event']['kind'], 'notice'> } } => m.event.kind !== 'notice';

const pendingView = (m: Msg & { event: { kind: Exclude<Msg['event']['kind'], 'notice'> } }, state: PendingMsg['state']): PendingMsg => {
  const p = m.event.payload as ShownPayload;
  return pendingRow({ uuid: m.uuid, kind: shownKind(m.event.kind), text: p.text ?? m.text, mode: m.mode, state }, p, {
    ...(m.requestId && { request_id: m.requestId, delivery: state }),
    ...(m.attachments?.length && { attachments: m.attachments }),
    ...(m.contexts?.length && { context: m.contexts }),
  });
};

/**
 * A saved request as the runner carries it. Only for one Omni wrote itself; Ben's go through `messageFor` (api.ts).
 * Its records go with it: a new thread's first message, kept here when the machine it was sent to could not take it
 * (handoff.ts restoreFresh), keeps its machine mentions for the agent.
 */
export const requestMsg = (r: MessageRequest): Msg => ({
  uuid: r.id,
  requestId: r.request_id,
  text: r.prompt,
  mode: r.mode,
  ...(r.context?.length && { contexts: r.context }),
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
    ...(live?.inflight ?? []).filter(shown).map((m) => pendingView(m, 'sent')),
    ...(live?.held ?? []).filter(shown).map((m) => pendingView(m, 'held')),
    ...(waitingMsgs.get(threadId) ?? []).filter(shown).map((m) => pendingView(m, 'waiting')),
    // A worktree thread's first prompt while the worktree is made: saved, waiting for it.
    ...(threads.get(threadId)?.setup === 'preparing' ? messageRequests.unstarted(threadId) : []).map(
      (r): PendingMsg =>
        pendingRow({ uuid: r.id, kind: shownKind(r.kind), text: r.prompt, mode: r.mode, state: 'waiting' }, { source: r.source }, {
          request_id: r.request_id,
          delivery: r.state,
          ...(r.attachments?.length && { attachments: r.attachments }),
          ...(r.context?.length && { context: r.context }),
        }),
    ),
    ...messageRequests.parked(threadId).map(
      (r): PendingMsg =>
        pendingRow({ uuid: r.id, kind: shownKind(r.kind), text: (r.payload?.text as string | undefined) ?? r.prompt, mode: r.mode, state: 'held' }, { source: r.source, ...r.payload }, {
          request_id: r.request_id,
          delivery: r.state,
          ...(r.attachments?.length && { attachments: r.attachments }),
          ...(r.context?.length && { context: r.context }),
        }),
    ),
    ...forwardedFrom(threadId),
  ];
}

/** Ben's messages this machine forwarded to the thread's holder that no machine has answered yet. */
function forwardedFrom(threadId: string): PendingMsg[] {
  const self = outbox.machineId();
  return remoteCommands
    .open(threadId)
    .filter((c) => c.kind === 'message' && c.sender === self)
    .map((c) => ({
      ...pendingRow({ uuid: `command:${c.id}`, kind: 'user', text: c.prompt, mode: c.mode ?? 'steer', state: 'sent' }, { source: c.source ?? 'ben' }, {
        request_id: c.id,
        ...(c.context?.length && { context: c.context }),
      }),
      forwarded_to: c.target_name,
      sent_at: c.created_at,
    }));
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
  if (!live.keepUnread(msgs)) drop(live.threadId, msgs);
}

/** startup: no child yet, or init has not arrived. running: the CLI has begun a turn. */
export const deliveryPhase = (live: Live): DeliveryPhase => (live.session && live.initSeen ? 'running' : 'startup');

export const hasBackground = (live: Live) => [...live.tasks.values()].some((t) => t.background);

// ---------- process ----------

/** A message as the harness gets it. Context is projected here, so a check of the file holds now, not when it was sent. */
export function outgoing(live: Live, m: Msg): OutgoingMessage {
  // A thread deleted meanwhile (by sync, from the other Mac) has no checkout to place it in; never throw on the write path.
  const thread = threads.get(live.threadId);
  const text = thread ? harnessText(m.text, m.contexts, thread) : m.text;
  // The images its context items name travel as attachments, so each harness takes them its own way.
  const attachments = [...(m.attachments ?? []), ...contextAttachments(m.contexts)];
  return { uuid: m.uuid, text, attachments, commands: m.commands ?? [] };
}

/** Hand a message to the session. False when it can't take it. */
export const deliver = (live: Live, m: Msg) => !!live.session?.send(outgoing(live, m));

/** The session can't take input: kill it so the exit fails the turn and records what was not delivered. */
export const crash = (live: Live) => live.session?.alive && live.session.end('kill');

/** Write a message to the harness. Before the process exists it waits in inflight, and spawn writes it. */
export function send(live: Live, m: Msg) {
  if (live.handoverDue) handOverWith(live, m);
  live.enqueue(m);
  if (!live.session) return;
  // The checkout before this turn is still being saved: written once it is (runner/snapshots.ts).
  if (live.gate) {
    live.gateMessage(m);
    return;
  }
  // Marked first: a write that fails can still have reached the harness.
  track(m, 'sent');
  if (!deliver(live, m)) crash(live);
}
