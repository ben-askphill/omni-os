import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { config, artifactsDir, threadDir, browserOutDir } from './config.ts';
import { channels, events, threads, kv, type Channel, type Thread, type ThreadSource, type ThreadStatus } from './db.ts';
import { getCrew, type CrewRole } from './crew.ts';
import { prepareWorkdir, writeMcpConfig } from './sandbox.ts';
import { describeAttachments, inlinable, messageContent, saveUploads, type Attachment } from './uploads.ts';
import { secretsEnv } from './secrets.ts';
import { type Usage, type Record as StreamRecord } from './stream.ts';
import { publishFeed, publishThread } from './bus.ts';
import { harnessEnv } from './harness/env-guard.ts';
import { CAPABILITIES, isHarnessId, type HarnessId } from './harness/types.ts';
import { getHarness, validateRun } from './harness/catalog.ts';
import { getCatalog } from './harness/catalog-service.ts';
import type { AdapterContext, HarnessAdapter } from './harness/adapter.ts';
import { claudeAdapter } from './harness/claude/adapter.ts';
import { codexAdapter } from './harness/codex/adapter.ts';

const omniUrl = () => `http://127.0.0.1:${config.port}`;

const ADAPTERS: Record<string, HarnessAdapter> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
};
const adapterFor = (harness: string): HarnessAdapter => ADAPTERS[harness] ?? claudeAdapter;
const capsOf = (harness: string) => CAPABILITIES[harness as HarnessId] ?? CAPABILITIES['claude-code'];
const harnessSteers = (threadId: string) => capsOf(threads.get(threadId)?.harness ?? 'claude-code').steer;
/** The CLI name a harness shows in errors and the resume command. */
const CLI_LABEL: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor-agent' };
const cliLabel = (harness: string) => CLI_LABEL[harness] ?? harness;

// ---------- state ----------

/** steer: the agent reads it at its next step. queue: after the current turn. interrupt: stop the turn, then run it. */
export type SendMode = 'steer' | 'queue' | 'interrupt';

interface Msg {
  uuid: string;
  text: string;
  mode: SendMode;
  /** Files Ben attached, already written into the thread's uploads folder. */
  attachments?: Attachment[];
  /** Written while a turn was already running, so the transcript marks where it steered. */
  midTurn?: boolean;
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
interface Live {
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
  resultSeen: boolean;
  spawnFailed: boolean;
  exitedFlag: boolean;
  stderr: string;
  exited: Promise<void>;
  done: () => void;
}

type ResultPayload = Extract<StreamRecord, { kind: 'result' }>['payload'];

const lives = new Map<string, Live>();
const waiting: string[] = []; // thread ids waiting for a slot, FIFO
const waitingMsgs = new Map<string, Msg[]>();
const browserHolder = new Map<string, string>(); // channel id -> thread id whose process holds the profile
let shuttingDown = false;

function emitThread(id: string) {
  const t = threads.get(id);
  if (t) publishFeed({ type: 'thread', thread: t });
}

function addEvent(threadId: string, kind: string, payload: unknown) {
  const row = events.add(threadId, kind, payload);
  publishThread(threadId, row);
  return row;
}

const alive = (c: ChildProcess) => c.exitCode === null && c.signalCode === null;

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

/** A warm claude process exists for this thread. */
export const isLive = (threadId: string) => {
  const l = lives.get(threadId);
  return !!l?.child && !l.closing;
};

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

const eventPayload = (m: Msg) => (m.event.kind === 'user' && m.midTurn ? { ...m.event.payload, mode: m.mode } : m.event.payload);

/** Messages the agent never saw. Recorded so the text is never lost. */
function drop(threadId: string, msgs: Msg[]) {
  for (const m of msgs) addEvent(threadId, m.event.kind, { ...eventPayload(m), dropped: true });
}

// ---------- queue ----------

function deliver(threadId: string, m: Msg) {
  if (shuttingDown) throw new Error('Omni is shutting down');
  let live = lives.get(threadId);
  // Interrupt and send while the process is still starting: stop it like Interrupt does and start fresh with this message.
  if (live?.turn && !live.closing && m.mode === 'interrupt' && (!live.child || !live.initSeen)) {
    stopStartup(live);
    live = lives.get(threadId);
  }
  if (live?.turn && !live.closing) {
    const steerable = harnessSteers(threadId);
    // A harness that can't steer queues a steer, and stops the process on interrupt so the next
    // message resumes the session (there is no mid-turn control to send).
    if (m.mode === 'queue' || (m.mode === 'steer' && !steerable)) live.held.push(m);
    else if (m.mode === 'interrupt' && !steerable) {
      live.held.push(m);
      hardKill(live);
    } else {
      m.midTurn = true;
      send(live, m);
      if (m.mode === 'interrupt') requestInterrupt(live);
    }
  } else {
    if (m.mode === 'interrupt') m.mode = 'steer';
    const list = waitingMsgs.get(threadId) ?? [];
    list.push(m);
    waitingMsgs.set(threadId, list);
    if (!waiting.includes(threadId)) waiting.push(threadId);
    pump();
    if (waiting.includes(threadId)) threads.update(threadId, { status: 'queued' });
  }
  emitThread(threadId);
}

function pump() {
  if (shuttingDown) return;
  for (let i = 0; i < waiting.length && runningCount() < config.maxConcurrent; ) {
    const id = waiting[i];
    // Its old process is still exiting; start fresh once it is gone.
    if (lives.get(id)?.closing) {
      i++;
      continue;
    }
    waiting.splice(i, 1);
    const msgs = waitingMsgs.get(id) ?? [];
    waitingMsgs.delete(id);
    if (msgs.length) begin(id, msgs);
  }
}

/** Start a turn with the first message; the rest follow as if sent mid-turn. */
function begin(threadId: string, [first, ...rest]: Msg[]) {
  const warm = lives.get(threadId);
  if (warm) {
    clearTimeout(warm.idleTimer);
    warm.turn = true;
    threads.update(threadId, { status: 'running' });
    send(warm, first);
  } else if (!launch(threadId, first)) return;
  for (const m of rest) deliver(threadId, m);
  emitThread(threadId);
}

// ---------- process ----------

function writeLine(live: Live, obj: unknown) {
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

const userLine = (live: Live, m: Msg) => ({
  type: 'user',
  message: { role: 'user', content: messageBody(m) },
  parent_tool_use_id: null,
  session_id: live.sessionId,
  uuid: m.uuid,
});

/** stdin is gone: kill it so the close handler fails the turn and records what was not delivered. */
const crash = (live: Live) => live.child && alive(live.child) && live.child.kill('SIGKILL');

function send(live: Live, m: Msg) {
  live.inflight.push(m);
  if (live.child && !writeLine(live, userLine(live, m))) crash(live);
}

function requestInterrupt(live: Live) {
  if (live.interrupt || !live.child) return;
  const id = `omni_int_${randomUUID().slice(0, 8)}`;
  live.interrupt = { id, acked: false };
  if (!writeLine(live, { type: 'control_request', request_id: id, request: { subtype: 'interrupt' } })) return hardKill(live);
  // The CLI normally winds the turn down within a second. If not, fall back to killing it.
  live.interruptTimer = setTimeout(() => live.turn && live.interrupt?.id === id && hardKill(live), config.interruptGraceMs);
}

function clearInterrupt(live: Live) {
  clearTimeout(live.interruptTimer);
  live.interrupt = null;
}

/**
 * The old stop path. The CLI can take seconds to shut down after SIGINT, so from here on new messages wait
 * for a fresh process, and so do the ones held for after this turn. Undelivered steers are dropped on exit.
 */
function hardKill(live: Live) {
  const child = live.child;
  if (!child || live.closing) return;
  live.closing = true;
  clearTimeout(live.idleTimer);
  const id = live.threadId;
  if (live.held.length) {
    waitingMsgs.set(id, [...live.held.splice(0), ...(waitingMsgs.get(id) ?? [])]);
    if (!waiting.includes(id)) waiting.push(id);
  }
  if (alive(child)) {
    live.hardStop = true;
    child.kill('SIGINT');
    setTimeout(() => alive(child) && child.kill('SIGKILL'), 5000);
  }
  emitThread(id);
}

/** Nothing to wind down yet (MCP servers can take 13s to connect): drop what is held and kill it. */
function stopStartup(live: Live) {
  drop(live.threadId, live.held);
  live.held = [];
  if (live.child) hardKill(live);
  else abortStart(live, 'stopped');
}

/** End stdin; the CLI exits on its own. */
function closeLive(live: Live) {
  if (live.closing || !live.child) return;
  live.closing = true;
  clearTimeout(live.idleTimer);
  live.child.stdin?.end();
  const child = live.child;
  setTimeout(() => alive(child) && child.kill('SIGTERM'), 10_000).unref();
  emitThread(live.threadId);
}

function armIdle(live: Live) {
  if (shuttingDown) return;
  clearTimeout(live.idleTimer);
  if (config.keepAliveSeconds <= 0) return closeLive(live);
  live.idleTimer = setTimeout(() => closeLive(live), config.keepAliveSeconds * 1000);
}

/** Forget the process: timers, browser profile, live state. */
function teardown(live: Live) {
  clearTimeout(live.idleTimer);
  clearInterrupt(live);
  if (live.browser && browserHolder.get(live.channelId) === live.threadId) browserHolder.delete(live.channelId);
  if (lives.get(live.threadId) === live) lives.delete(live.threadId);
  live.turn = false;
  live.inflight = [];
  live.held = [];
  live.done();
}

/** Interrupted or shut down before the process was spawned. */
function abortStart(live: Live, status: ThreadStatus) {
  drop(live.threadId, [...live.inflight, ...live.held]);
  teardown(live);
  threads.update(live.threadId, { status });
  emitThread(live.threadId);
  pump();
}

function endTurn(live: Live, status: ThreadStatus) {
  const id = live.threadId;
  live.turn = false;
  clearInterrupt(live);
  const runText = events.lastRunText(id, live.turnFrom);
  live.turnFrom = 0;
  const t = threads.update(id, {
    status,
    has_run: 1,
    last_text: runText ? runText.slice(0, 600) : threads.get(id)?.last_text ?? null,
  });
  emitThread(id);
  if (t?.parent_id && status !== 'stopped' && !shuttingDown) reportToParent(id, status, runText);
  armIdle(live);
  pump();
}

function onResult(live: Live, p: ResultPayload) {
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

function onRecord(live: Live, rec: StreamRecord) {
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
function openTurn(live: Live) {
  live.turn = true;
  clearTimeout(live.idleTimer);
  threads.update(live.threadId, { status: 'running' });
  emitThread(live.threadId);
}

function onExit(live: Live, code: number | null, signal: NodeJS.Signals | null) {
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
    if (thread.parent_id && status !== 'stopped' && !shuttingDown) reportToParent(id, status, runText);
  } else if (thread && live.resultSeen && !thread.has_run) {
    threads.update(id, { has_run: 1, updated_at: thread.updated_at });
  }
  emitThread(id);
  pump();
}

function launch(threadId: string, first: Msg): Live | undefined {
  const thread = threads.get(threadId);
  if (!thread) return;
  let done = () => {};
  const exited = new Promise<void>((r) => (done = r));
  const live: Live = {
    threadId,
    channelId: thread.channel_id,
    child: null,
    write: null,
    flush: null,
    sessionId: thread.session_id,
    turn: true,
    cliTurn: false,
    replayed: false,
    turnFrom: 0,
    inflight: [first],
    held: [],
    interrupt: null,
    hardStop: false,
    closing: false,
    shutdown: false,
    browser: false,
    initSeen: false,
    resultSeen: false,
    spawnFailed: false,
    exitedFlag: false,
    stderr: '',
    exited,
    done,
  };
  lives.set(threadId, live);
  threads.update(threadId, { status: 'running' });
  spawnLive(live, thread).catch((err) => {
    // Never let one broken thread take the whole server down.
    console.error(`[runner] ${threadId} crashed:`, err);
    if (lives.get(threadId) !== live) return;
    addEvent(threadId, 'error', { text: `Omni failed to run this thread: ${(err as Error).message}` });
    if (live.child) crash(live);
    else abortStart(live, 'failed');
  });
  return live;
}

async function spawnLive(live: Live, thread: Thread) {
  const channel = channels.get(thread.channel_id)!;
  const role = getCrew(thread.role);

  // Chrome locks a profile dir: the first live process in a channel keeps it until it exits.
  const holder = browserHolder.get(channel.id);
  const browserBusy = !!holder && holder !== thread.id;
  if (config.browser && !browserBusy) {
    browserHolder.set(channel.id, thread.id);
    live.browser = true;
  }
  const mcpFile = writeMcpConfig({ threadId: thread.id, channel, role, browserBusy, omniUrl: omniUrl() });

  let secretEnv: Record<string, string> = {};
  try {
    secretEnv = await secretsEnv(channel.id);
  } catch (err) {
    addEvent(thread.id, 'error', { text: `Could not read secrets: ${(err as Error).message}` });
  }
  // Interrupted or shut down while secrets were read.
  if (lives.get(thread.id) !== live) return;

  const ctx: AdapterContext = {
    thread,
    channel,
    role,
    systemPrompt: buildSystemPrompt(thread, channel, role),
    mcpFile,
    secretEnv,
    browserBusy,
    omniUrl: omniUrl(),
    resume: !!thread.has_run,
  };
  const session = adapterFor(thread.harness).spawn(ctx, {
    record: (rec) => onRecord(live, rec),
    usage: (u) => {
      kv.set('usage', u);
      publishFeed({ type: 'usage', usage: u });
    },
    session: (sid) => {
      live.sessionId = sid;
      const t = threads.get(thread.id);
      if (t && t.session_id !== sid) threads.update(thread.id, { session_id: sid, updated_at: t.updated_at });
    },
  });
  const child = session.child;
  live.child = child;
  live.write = session.write;
  live.flush = session.flush ?? null;

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => (live.stderr = (live.stderr + d).slice(-8000)));
  child.on('error', (err) => {
    live.spawnFailed = true;
    addEvent(thread.id, 'error', { text: `Could not start ${cliLabel(thread.harness)}: ${err.message}` });
  });
  child.on('close', (code, signal) => {
    live.flush?.();
    onExit(live, code, signal);
  });

  // Messages go in as stream-json lines, so leading dashes or huge pastes never get parsed as flags.
  for (const m of live.inflight) {
    if (!writeLine(live, userLine(live, m))) {
      crash(live);
      break;
    }
  }
  emitThread(thread.id);
}

function reportToParent(childId: string, status: string, text: string) {
  const child = threads.get(childId)!;
  const parent = threads.get(child.parent_id!);
  if (!parent) return;
  const report = {
    text: text || '(no reply)',
    task_id: child.task_id,
    thread_id: child.id,
    title: child.title,
    role: child.role,
    channel: child.channel_id,
    status,
  };
  // Wake the parent, or steer it if busy, exactly like a crewmate messaging firstmate.
  deliver(parent.id, {
    uuid: randomUUID(),
    mode: 'steer',
    event: { kind: 'crew_report', payload: report },
    text:
      `[crew report] task ${child.task_id ?? '(none)'} from ${child.role ?? 'crew'} in #${child.channel_id} ` +
      `(thread ${child.id}), status: ${status}\n\n${report.text}\n\n` +
      'Relay what matters to Ben in one short update. Delegate follow-ups if needed. Do not redo the work.',
  });
}

// ---------- prompts ----------

export function buildSystemPrompt(thread: Thread, channel: Channel, role?: CrewRole) {
  const lines = [
    '# Omni OS context',
    `You are running headless inside Omni OS, Ben's local agent workspace. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you.`,
    `- Thread: ${thread.id}${thread.task_id ? ` (task ${thread.task_id})` : ''}`,
    `- Channel: #${channel.id} (${channel.name}, ${channel.kind})`,
    channel.store_domain ? `- Shopify store: ${channel.store_domain}` : '',
    channel.portal_slug ? `- Ask Phill Portal company slug: ${channel.portal_slug}` : '',
    channel.github_repo ? `- GitHub repo: ${channel.github_repo}` : '',
    thread.branch ? `- You are in a dedicated git worktree on branch ${thread.branch}. Commit here; open a PR when asked.` : '',
    channel.notes ? `- Channel notes: ${channel.notes}` : '',
    '',
    '## Artifacts',
    `Write any HTML page, report, diagram, CSV or document meant for Ben into ${artifactsDir(thread.id)} (env OMNI_ARTIFACTS_DIR).`,
    'Omni renders files there inline in the thread. Prefer a self-contained .html file for anything visual. Mention the filename in your reply.',
    '',
    '## Browser',
    config.browser
      ? `The "omni-browser" MCP is this thread's browser. It keeps this channel's logins between threads. Screenshots land in ${browserOutDir(thread.id)} and show up in the thread.`
      : '',
    '',
    '## Secrets',
    'Channel and global secrets are already in your environment as variables. Never print, echo or write their values anywhere.',
    '',
    '## Reply',
    'Your final message is what gets shown and reported. Lead with the outcome, keep it short, bullets over prose.',
  ];
  if (thread.parent_id) {
    lines.push(
      '',
      '## Delegated task',
      `The conductor handed you this task${thread.task_id ? ` as ${thread.task_id}` : ''}. Your final message is automatically reported back to it. Report outcomes and blockers, even if the answer is "nothing found".`,
    );
  }
  if (role) lines.push('', `## Your role: ${role.name}`, role.charter);
  return lines.filter((l) => l !== '').join('\n').replace(/\n## /g, '\n\n## ');
}

// ---------- public API ----------

export interface CreateThreadInput {
  channel: string;
  prompt: string;
  role?: string | null;
  model?: string | null;
  harness?: string | null;
  title?: string | null;
  parent_id?: string | null;
  task_id?: string | null;
  source?: ThreadSource;
  automation?: string | null;
  /** Files Ben attached to the first message. Validate them with `checkUploads` before calling. */
  files?: File[];
}

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const role = getCrew(input.role);
  const channelId = input.channel || role?.channel || 'inbox';
  const channel = channels.get(channelId);
  if (!channel) throw new Error(`unknown channel "${channelId}"`);

  // Resolve and validate the harness against the catalog. Claude Code is the default, so callers
  // that pass no harness (the menu bar app, the conductor) keep working. Role defaults are #16.
  const harness: HarnessId = isHarnessId(input.harness) ? input.harness : 'claude-code';
  if (input.harness && !isHarnessId(input.harness)) throw new Error(`Unknown harness "${input.harness}".`);
  const cat = getCatalog();
  const hInfo = getHarness(cat, harness);
  if (!hInfo) throw new Error(`Unknown harness "${harness}".`);
  if (!hInfo.available && hInfo.models.length === 0) {
    throw new Error(`${hInfo.name} is not available. Run \`${hInfo.fix ?? ''}\`.`.trim());
  }
  if (input.model) {
    const check = validateRun(cat, harness, input.model, '');
    if (!check.ok) throw new Error(check.error);
  }

  const id = randomUUID();
  const wd = await prepareWorkdir(channel, id);
  const thread = threads.create({
    id,
    channel_id: channel.id,
    title: input.title?.trim() || fallbackTitle(input.prompt),
    status: 'queued',
    role: role?.id ?? null,
    model: input.model || null,
    harness,
    session_id: id,
    cwd: wd.cwd,
    branch: wd.branch,
    parent_id: input.parent_id ?? null,
    task_id: input.task_id ?? (input.parent_id ? `T-${id.slice(0, 4).toUpperCase()}` : null),
    source: input.source ?? 'manual',
    automation: input.automation ?? null,
  });
  const saved = await saveUploads(thread.id, input.files ?? []);
  const attachments = saved.length ? saved : undefined;
  deliver(thread.id, {
    uuid: randomUUID(),
    text: input.prompt,
    mode: 'steer',
    attachments,
    event: { kind: 'user', payload: { text: input.prompt, source: thread.source, ...(attachments && { attachments }) } },
  });
  if (!input.title) void generateTitle(thread.id, input.prompt);
  return threads.get(thread.id)!;
}

export function sendMessage(
  threadId: string,
  prompt: string,
  opts: { from?: 'ben' | 'conductor'; mode?: SendMode; attachments?: Attachment[] } = {},
): Thread {
  if (!threads.get(threadId)) throw new Error('thread not found');
  const attachments = opts.attachments?.length ? opts.attachments : undefined;
  deliver(threadId, {
    uuid: randomUUID(),
    text: prompt,
    mode: opts.mode ?? 'steer',
    attachments,
    event: { kind: 'user', payload: { text: prompt, source: opts.from ?? 'ben', ...(attachments && { attachments }) } },
  });
  return threads.get(threadId)!;
}

/**
 * Waiting for a slot: drop its messages. Mid-turn: drop held messages and ask the CLI to stop the turn;
 * the process stays warm and steers already sent still run next. Hard kill if it does not stop in time,
 * or right away if the process has not started its first turn yet.
 */
export function interruptThread(threadId: string): Thread | undefined {
  const live = lives.get(threadId);
  const w = waiting.indexOf(threadId);
  if (w >= 0) {
    waiting.splice(w, 1);
    drop(threadId, waitingMsgs.get(threadId) ?? []);
    waitingMsgs.delete(threadId);
    if (!live?.turn) threads.update(threadId, { status: 'stopped' });
  }
  // A process already being stopped needs nothing more; what waited for its successor was dropped above.
  if (live?.turn && !live.closing) {
    // Still starting up (MCP servers can take 13s): no turn to wind down, and a queued message would run anyway.
    if (!live.child || !live.initSeen) stopStartup(live);
    else if (!harnessSteers(threadId)) {
      // No graceful interrupt: end the process. The next message resumes the session.
      drop(threadId, live.held);
      live.held = [];
      hardKill(live);
    } else {
      drop(threadId, live.held);
      live.held = [];
      requestInterrupt(live);
    }
  } else if (w < 0 && !live) {
    // Nothing runs it, so a busy status is stale.
    const t = threads.get(threadId);
    if (t && (t.status === 'running' || t.status === 'queued')) threads.update(threadId, { status: 'stopped' });
  }
  emitThread(threadId);
  return threads.get(threadId);
}

export const stopThread = interruptThread;

/** Close every live process (end stdin, SIGTERM after 3s) and resolve once all have exited. */
export async function shutdownAll() {
  shuttingDown = true;
  try {
    for (const id of waiting.splice(0)) {
      drop(id, waitingMsgs.get(id) ?? []);
      waitingMsgs.delete(id);
      if (!lives.get(id)?.turn) threads.update(id, { status: 'stopped' });
      emitThread(id);
    }
    const all = [...lives.values()];
    for (const live of all) {
      clearTimeout(live.idleTimer);
      clearInterrupt(live);
      const child = live.child;
      if (!child) {
        abortStart(live, 'stopped');
        continue;
      }
      live.shutdown = true;
      drop(live.threadId, live.held);
      live.held = [];
      live.closing = true;
      child.stdin?.end();
      const term = setTimeout(() => alive(child) && child.kill('SIGTERM'), 3000);
      const kill = setTimeout(() => alive(child) && child.kill('SIGKILL'), 5000);
      void live.exited.then(() => (clearTimeout(term), clearTimeout(kill)));
    }
    await Promise.all(all.map((l) => l.exited));
  } finally {
    shuttingDown = false;
  }
}

export const getUsage = () => kv.get<Usage>('usage') ?? null;

function fallbackTitle(prompt: string) {
  const first = prompt.trim().split('\n')[0].replace(/\s+/g, ' ');
  return first.length > 70 ? first.slice(0, 67) + '...' : first || 'Untitled';
}

function generateTitle(threadId: string, prompt: string) {
  const child = spawn(
    config.claudeBin,
    ['-p', '--model', 'haiku', '--output-format', 'text', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
    { cwd: tmpdir(), env: harnessEnv('claude-code', { CLAUDE_CODE_ENTRYPOINT: 'omni-os-title' }), stdio: ['pipe', 'pipe', 'ignore'] },
  );
  child.stdin.on('error', () => {});
  child.stdin.end(
    'Write a title of at most 7 words for this task. Plain text, no quotes, no trailing period, no em dashes. ' +
      'Output the title only.\n\nTask:\n' + prompt.slice(0, 3000),
  );
  let out = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
  child.stdout.on('data', (d) => (out += d));
  child.on('close', (code) => {
    clearTimeout(timer);
    const title = out.trim().split('\n').filter(Boolean).pop()?.replace(/^["']|["']$/g, '').slice(0, 90);
    if (code === 0 && title) {
      threads.update(threadId, { title, updated_at: threads.get(threadId)?.updated_at });
      emitThread(threadId);
    }
  });
  child.on('error', () => clearTimeout(timer));
}
