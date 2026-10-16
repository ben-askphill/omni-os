// createThread, sendMessage, and postMessage. Slash commands are resolved here, then delivered.
import { randomUUID } from 'node:crypto';
import { channels, folders, messageRequests, outbox, requestFingerprint, threads, type DeliveryState, type MessageRequest, type Thread, type ThreadSource } from '../db.ts';
import { getCrew } from '../crew.ts';
import { commandsFolder, prepareWorkdir } from '../sandbox.ts';
import { prepareTurn, turnBlocked } from '../sync/guard.ts';
import { parseSlash, resolveSlash, slashRecord, type SlashCommand, type SlashRecord } from '../../shared/slash.ts';
import { listCommands, peekCommands } from '../commands.ts';
import { withMentions } from '../mentions.ts';
import { saveUploads, type Attachment } from '../uploads.ts';
import type { HarnessId } from '../harness/types.ts';
import type { Catalog } from '../harness/catalog.ts';
import { freshCatalog, getCatalog } from '../harness/catalog-service.ts';
import { resolveRun } from '../harness/resolve.ts';
import type { CommandUse } from '../harness/adapter.ts';
import { assembling, deliver, settleTeam } from './queue.ts';
import { fallbackTitle, generateTitle } from './aux.ts';
import { addEvent, emitThread, isShuttingDown, runsHere, threadCommands, type SendMode } from './state.ts';

// ---------- slash commands ----------

/** How long a message that names a command waits for a command list that isn't cached. It goes as plain text after. */
const SLASH_WAIT_MS = 5000;

/** Whether a message names a command anywhere: at its start or as a Mention. */
const namesCommand = (prompt: string) => {
  const { lead, mentions } = parseSlash(prompt);
  return !!lead || mentions.length > 0;
};

/**
 * Wait, within a bound, for a folder's first command list when a message names a command. A warm
 * thread's own list, or a cached one (a stale one refreshes in the background), is used at once.
 */
async function warmCommands(harness: string, cwd: string, prompt: string, threadId?: string) {
  if (!namesCommand(prompt)) return;
  if ((threadId && threadCommands(threadId)) || peekCommands(harness as HarnessId, cwd).status !== 'loading') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([listCommands(harness as HarnessId, cwd, { wait: true }), new Promise((r) => (timer = setTimeout(r, SLASH_WAIT_MS)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A message against the thread's command list, or the folder's cached one: the text the harness
 * gets, the user event's `slash` field (the harness command it starts with and its Mentions), and
 * the commands as the adapter runs them (a Codex skill goes with its file).
 */
function slashFor(prompt: string, commands: () => SlashCommand[]): { text: string; slash?: SlashRecord; commands?: CommandUse[] } {
  if (!namesCommand(prompt)) return { text: prompt };
  const list = commands();
  // A harness runs a command only at the very start of its text. So a harness command goes there,
  // and an Omni command, which runs only from a thread's reply box, goes after a space as text.
  const r = resolveSlash(prompt, list);
  const shift = r?.kind === 'omni' ? 1 : r?.kind === 'harness' ? -r.token.start : 0;
  const text = shift > 0 ? ` ${prompt}` : prompt.slice(-shift);
  const slash = slashRecord(prompt, list);
  if (!slash) return { text };
  const uses = [...(slash.command ? [slash.command] : []), ...(slash.mentions ?? [])].map(({ name, start, end }) => {
    const path = list.find((c) => c.name === name)?.path;
    return { name, start: start + shift, end: end + shift, ...(path && { path }) };
  });
  return { text, slash, commands: uses };
}

// ---------- public API ----------

export interface CreateThreadInput {
  channel: string;
  prompt: string;
  role?: string | null;
  model?: string | null;
  harness?: string | null;
  effort?: string | null;
  title?: string | null;
  parent_id?: string | null;
  task_id?: string | null;
  source?: ThreadSource;
  automation?: string | null;
  /** A sidebar folder of the channel to file the thread in, by id or name. A name no folder has makes one. */
  folder?: string | null;
  /** Files Ben attached to the first message. Validate them with `checkUploads` before calling. */
  files?: File[];
}

/** Resolve the run, make the workdir and write the row. Nothing is delivered yet. */
async function openThread(input: CreateThreadInput, status: Thread['status'] = 'queued') {
  const role = getCrew(input.role);
  const channelId = input.channel || role?.channel || 'inbox';
  const channel = channels.get(channelId);
  if (!channel) throw new Error(`unknown channel "${channelId}"`);

  // Resolve harness/model/effort: the thread's own choice, then the role's default, then the channel's, then Claude Code.
  // On a miss, probe the harnesses that are down and try again: Ben may have just logged in.
  const channelDefaults = { harness: channel.default_harness ?? undefined, model: channel.default_model ?? undefined, effort: channel.default_effort ?? undefined };
  const resolve = (cat: Catalog, withChannel = true) =>
    resolveRun(
      { harness: input.harness, model: input.model, effort: input.effort },
      role ? { harness: role.harness, model: role.model, effort: role.effort } : undefined,
      cat,
      withChannel ? channelDefaults : undefined,
    );
  let run = resolve(getCatalog());
  if (!run.ok) run = resolve(await freshCatalog());
  // A channel default the catalog no longer has (a retired model) never blocks a thread: drop it.
  if (!run.ok) run = resolve(getCatalog(), false);
  if (!run.ok) throw new Error(run.error);
  const harness = run.harness;
  const effort = run.effort;

  const filedIn = input.folder?.trim() ? (folders.find(channel.id, input.folder) ?? folders.create({ channel_id: channel.id, name: input.folder })) : null;

  const id = randomUUID();
  const wd = await prepareWorkdir(channel, id, { remote: harness === 'hermes' });
  const thread = threads.create({
    id,
    channel_id: channel.id,
    title: input.title?.trim() || fallbackTitle(input.prompt),
    status,
    role: role?.id ?? null,
    model: run.model || null,
    harness,
    effort,
    session_id: id,
    cwd: wd.cwd,
    branch: wd.branch,
    parent_id: input.parent_id ?? null,
    task_id: input.task_id ?? (input.parent_id ? `T-${id.slice(0, 4).toUpperCase()}` : null),
    source: input.source ?? 'manual',
    automation: input.automation ?? null,
    folder_id: filedIn?.id ?? null,
  });
  return { thread, channel, harness, folder: commandsFolder(channel) ?? wd.cwd };
}

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const { thread, harness, folder } = await openThread(input);
  const saved = await saveUploads(thread.id, input.files ?? []);
  const attachments = saved.length ? saved : undefined;
  await warmCommands(harness, folder, input.prompt);
  const { text, slash, commands } = slashFor(input.prompt, () => peekCommands(harness as HarnessId, folder).commands);
  deliver(thread.id, {
    uuid: randomUUID(),
    text: withMentions(text, { cwd: thread.cwd, threadId: thread.id }),
    mode: 'steer',
    attachments,
    commands,
    event: {
      kind: 'user',
      payload: { text: input.prompt, source: thread.source, ...(slash && { slash }), ...(attachments && { attachments }) },
    },
  });
  if (!input.title) void generateTitle(thread.id, input.prompt);
  return threads.get(thread.id)!;
}

export interface TeamTask {
  prompt: string;
  title?: string | null;
  role?: string | null;
  task_id?: string | null;
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
}

export interface CreateTeamInput {
  channel: string;
  /** What the team is for. The lead gets it with every member's reply once the last one reports. */
  prompt: string;
  title?: string | null;
  /** The lead's role, and each member's unless the task names one. */
  role?: string | null;
  parent_id?: string | null;
  task_id?: string | null;
  source?: ThreadSource;
  tasks: TeamTask[];
}

/**
 * One lead thread in the channel with a member thread per task under it. The members run now; the lead
 * waits (shown as running) and runs once, when the last member reports, to combine their replies.
 */
export async function createTeam(input: CreateTeamInput): Promise<{ lead: Thread; members: Thread[] }> {
  if (!input.tasks.length) throw new Error('a team needs at least one task');
  const { thread: lead } = await openThread({ ...input, source: input.source ?? 'conductor' }, 'running');
  addEvent(lead.id, 'user', { text: input.prompt, source: lead.source });
  if (!input.title) void generateTitle(lead.id, input.prompt);
  const members: Thread[] = [];
  // A member can finish before the last one is created; the lead settles once all of them exist.
  assembling.add(lead.id);
  try {
    for (const [i, t] of input.tasks.entries()) {
      members.push(
        await createThread({
          ...t,
          channel: lead.channel_id,
          role: t.role ?? input.role,
          parent_id: lead.id,
          task_id: t.task_id ?? (lead.task_id ? `${lead.task_id}.${i + 1}` : null),
          source: 'team',
        }),
      );
    }
  } catch (err) {
    // A member that could not start: the lead fails with the reason instead of waiting for it forever.
    addEvent(lead.id, 'error', { text: `Could not start task ${input.tasks[members.length]?.title ?? members.length + 1}: ${(err as Error).message}` });
    threads.update(lead.id, { status: members.length ? 'running' : 'failed' });
    if (!members.length) throw err;
  } finally {
    assembling.delete(lead.id);
  }
  settleTeam(lead.id);
  emitThread(lead.id);
  return { lead: threads.get(lead.id)!, members };
}

export function sendMessage(
  threadId: string,
  prompt: string,
  opts: {
    from?: 'ben' | 'conductor';
    mode?: SendMode;
    attachments?: Attachment[];
    /** A durable request (postMessage): its row id becomes the message uuid, and the runner tracks its state. */
    request?: Pick<MessageRequest, 'id' | 'request_id'>;
  } = {},
): Thread {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('thread not found');
  // Synced threads: not while the other Mac runs it, nor with its folder missing here (postMessage makes it first).
  const blocked = turnBlocked(thread, runsHere(threadId));
  if (blocked) throw Object.assign(new Error(blocked), { status: 409 });
  const attachments = opts.attachments?.length ? opts.attachments : undefined;
  const { text, slash, commands } = slashFor(prompt, () => (threadCommands(threadId) ?? peekCommands(thread.harness as HarnessId, thread.cwd)).commands);
  deliver(threadId, {
    uuid: opts.request?.id ?? randomUUID(),
    requestId: opts.request?.request_id,
    text: withMentions(text, { cwd: thread.cwd, threadId }),
    mode: opts.mode ?? 'steer',
    attachments,
    commands,
    event: {
      kind: 'user',
      payload: { text: prompt, source: opts.from ?? 'ben', ...(slash && { slash }), ...(attachments && { attachments }) },
    },
  });
  return threads.get(threadId)!;
}

/** Each thread's last posted message, until it is sent. */
const posting = new Map<string, Promise<unknown>>();

/** Run fn after every message posted to the thread before it, so they reach the runner in the order they came. */
async function inOrder<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const next = (posting.get(threadId) ?? Promise.resolve()).catch(() => {}).then(fn);
  posting.set(threadId, next);
  try {
    return await next;
  } finally {
    if (posting.get(threadId) === next) posting.delete(threadId);
  }
}

/** What a client hears once its message is saved. A retry with the same request id hears the same id and time. */
export interface Acceptance {
  id: string;
  request_id: string;
  state: DeliveryState;
  accepted_at: string;
  /** This request id was accepted before: nothing new was saved or sent. */
  duplicate?: boolean;
}

export type PostedThread = Thread & { request: Acceptance };

const refusal = (message: string, status: number) => Object.assign(new Error(message), { status });

function accepted(threadId: string, r: MessageRequest, duplicate = false): PostedThread {
  const now = messageRequests.get(r.id) ?? r;
  return {
    ...threads.get(threadId)!,
    request: { id: now.id, request_id: now.request_id, state: now.state, accepted_at: now.created_at, ...(duplicate && { duplicate: true }) },
  };
}

/**
 * A request id seen before: the same acceptance when the message matches, a 409 when the id was used for another
 * message. The route calls this before it saves the files again.
 */
export function acceptedAgain(threadId: string, requestId: string, fingerprint: string): PostedThread | null {
  const had = messageRequests.byRequestId(threadId, requestId);
  if (!had) return null;
  if (had.fingerprint !== fingerprint) throw refusal(`Request ${requestId} was already used for a different message.`, 409);
  return accepted(threadId, had, true);
}

/**
 * Hand a saved request to the runner, after the thread's folder is ready and, when the message names a command,
 * its command list. If that fails, `undo` says what becomes of the row; a shutdown parks it for after the restart.
 */
async function deliverRequest(r: MessageRequest, undo: () => void) {
  try {
    const thread = threads.get(r.thread_id);
    if (!thread) throw refusal('thread not found', 404);
    const ready = await prepareTurn(thread, runsHere(r.thread_id));
    await warmCommands(ready.harness, ready.cwd, r.prompt, r.thread_id);
    sendMessage(r.thread_id, r.prompt, { from: r.source, mode: r.mode, attachments: r.attachments ?? undefined, request: r });
  } catch (err) {
    if (isShuttingDown()) messageRequests.park(r.id);
    else undo();
    emitThread(r.thread_id);
    throw err;
  }
}

/**
 * `sendMessage` for the API. The message is saved first (db/repos/requests.ts), so once this returns it survives a
 * restart. A message that names a command then waits, within a bound, for the thread's command list. Messages to
 * a thread still go in the order they were posted. `requestId` is the client's: a retry with it is answered with
 * the first acceptance and sends nothing again.
 */
export async function postMessage(
  threadId: string,
  prompt: string,
  opts: Parameters<typeof sendMessage>[2] & { requestId?: string; fingerprint?: string } = {},
): Promise<PostedThread> {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('thread not found');
  const mode = opts.mode ?? 'steer';
  const source = opts.from ?? 'ben';
  const files = (opts.attachments ?? []).map((a) => ({ name: a.name, size: a.size, sha256: '' }));
  const fingerprint = opts.fingerprint ?? requestFingerprint({ prompt, mode, source, files });
  if (opts.requestId) {
    const again = acceptedAgain(threadId, opts.requestId, fingerprint);
    if (again) return again;
  }
  // Refused before anything is saved: the other Mac runs it.
  const blocked = turnBlocked(thread, runsHere(threadId));
  if (blocked) throw refusal(blocked, 409);
  const { row, fresh } = messageRequests.accept({
    thread_id: threadId,
    request_id: opts.requestId ?? randomUUID(),
    prompt,
    mode,
    source,
    attachments: opts.attachments ?? null,
    fingerprint,
    machine_id: outbox.machineId(),
  });
  // The same id posted twice at once: the second waits for nothing.
  if (!fresh) return acceptedAgain(threadId, row.request_id, fingerprint)!;
  await inOrder(threadId, () => deliverRequest(row, () => messageRequests.remove(row.id)));
  return accepted(threadId, row);
}

/**
 * Resume requests a restart parked, in the order they first arrived. Without `ids`, every recovered one; an
 * uncertain one may already have reached the harness, so it goes only when named. Each goes through the runner
 * like a new message, so the harness's concurrency cap holds. Only the Mac that accepted a request resumes it.
 */
export async function resumeRequests(threadId: string, ids?: string[]): Promise<Thread> {
  const thread = threads.get(threadId);
  if (!thread) throw refusal('thread not found', 404);
  const parked = messageRequests.parked(threadId);
  const chosen = ids ? parked.filter((r) => ids.includes(r.id)) : parked.filter((r) => r.state === 'recovered');
  if (ids && chosen.length !== new Set(ids).size) throw refusal('Some of these messages are no longer waiting to be resumed.', 409);
  const self = outbox.machineId();
  if (chosen.some((r) => r.machine_id && r.machine_id !== self)) throw refusal('This message was queued on your other Mac. Resume it there.', 409);
  const blocked = turnBlocked(thread, runsHere(threadId));
  if (blocked) throw refusal(blocked, 409);
  for (const r of chosen) messageRequests.mark(r.id, 'accepted');
  emitThread(threadId);
  const runs = chosen.map((r) => inOrder(threadId, () => deliverRequest({ ...r, state: 'accepted' }, () => messageRequests.mark(r.id, r.state))));
  const failed = (await Promise.allSettled(runs)).find((x) => x.status === 'rejected');
  if (failed) throw (failed as PromiseRejectedResult).reason;
  return threads.get(threadId)!;
}

/**
 * Ben decided not to send these parked requests. Each goes in the transcript marked dropped, like any message the
 * agent never saw, so the text is not lost.
 */
export function discardRequests(threadId: string, ids: string[]): Thread {
  const thread = threads.get(threadId);
  if (!thread) throw refusal('thread not found', 404);
  const chosen = messageRequests.parked(threadId).filter((r) => ids.includes(r.id));
  if (chosen.length !== new Set(ids).size) throw refusal('Some of these messages are no longer waiting to be resumed.', 409);
  for (const r of chosen) {
    if (!messageRequests.mark(r.id, 'discarded')) continue;
    addEvent(threadId, 'user', { text: r.prompt, source: r.source, ...(r.attachments?.length && { attachments: r.attachments }), dropped: true });
  }
  emitThread(threadId);
  return threads.get(threadId)!;
}
