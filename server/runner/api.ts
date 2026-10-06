// createThread, sendMessage, and postMessage. Slash commands are resolved here, then delivered.
import { randomUUID } from 'node:crypto';
import { channels, threads, type Thread, type ThreadSource } from '../db.ts';
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
import { addEvent, emitThread, runsHere, threadCommands, type SendMode } from './state.ts';

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
  opts: { from?: 'ben' | 'conductor'; mode?: SendMode; attachments?: Attachment[] } = {},
): Thread {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('thread not found');
  // Synced threads: not while the other Mac runs it, nor with its folder missing here (postMessage makes it first).
  const blocked = turnBlocked(thread, runsHere(threadId));
  if (blocked) throw Object.assign(new Error(blocked), { status: 409 });
  const attachments = opts.attachments?.length ? opts.attachments : undefined;
  const { text, slash, commands } = slashFor(prompt, () => (threadCommands(threadId) ?? peekCommands(thread.harness as HarnessId, thread.cwd)).commands);
  deliver(threadId, {
    uuid: randomUUID(),
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

/**
 * `sendMessage` for the API: a message that names a command first waits, within a bound, for the
 * thread's command list. Messages to a thread still go in the order they were posted.
 */
export async function postMessage(threadId: string, prompt: string, opts: Parameters<typeof sendMessage>[2] = {}): Promise<Thread> {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('thread not found');
  const next = (posting.get(threadId) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const ready = await prepareTurn(threads.get(threadId) ?? thread, runsHere(threadId));
      await warmCommands(ready.harness, ready.cwd, prompt, threadId);
      return sendMessage(threadId, prompt, opts);
    });
  posting.set(threadId, next);
  try {
    return await next;
  } finally {
    if (posting.get(threadId) === next) posting.delete(threadId);
  }
}
