// Stdio MCP server handed to conductor threads. It talks to the local Omni API,
// so delegated threads are ordinary threads the user can open, search and continue.
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiError, call, SELF, text } from './api.ts';
import { registerReferencedThread } from './referenced-thread.ts';

/** Who the conductor works for, from the user config (apps/server/user-config.ts). */
const USER = process.env.OMNI_USER || 'the user';

const server = new McpServer({ name: 'omni', version: '0.1.0' });

/** The API's base pick for the `base` a tool call names: head, remote-default or a ref. */
const basePick = (base?: string) => {
  const name = base?.trim();
  if (!name) return undefined;
  return name === 'head' || name === 'remote-default' ? { kind: name } : { kind: 'ref', ref: name };
};

/** A channel's sidebar folders, with a few recent thread titles so you can tell what each one holds. */
const folderSummary = (folders: any[] = []) =>
  folders.map((f: any) => ({ id: f.id, name: f.name, threads: f.count, recent: (f.threads ?? []).slice(0, 3).map((t: any) => t.title) }));

/**
 * The folder `name` names in the channel, by id or name ignoring case. With `create` a name no folder has is fine:
 * the server makes it. Without it, an unknown name is refused, so a new folder only ever comes after the user agreed to it.
 */
async function checkFolder(channel: string, name: string, create?: boolean) {
  const ch = await call(`/channels/${encodeURIComponent(channel)}`);
  const want = name.replace(/\s+/g, ' ').trim().toLowerCase();
  const hit = (ch.folders ?? []).find((f: any) => f.id === name || f.name.toLowerCase() === want);
  if (hit || create) return hit ?? null;
  const have = (ch.folders ?? []).map((f: any) => `"${f.name}"`).join(', ') || 'none yet';
  throw new Error(
    `#${channel} has no folder "${name}" (folders: ${have}). Suggest the new folder to ${USER} and leave the thread unfiled for now; ` +
      `once ${USER} agrees, call file_thread with create: true. Pass create_folder: true on delegate only when ${USER} already asked for the folder.`,
  );
}

server.registerTool(
  'list_channels',
  {
    description:
      'List Omni channels (one per client or project) with repo, store, running thread count and sidebar folders. ' +
      'Each folder shows its thread count and a few recent thread titles, so you can pick the one a task belongs in.',
  },
  async () => {
    const list = await call('/channels');
    return text(
      list.map((c: any) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        store: c.store_domain,
        repo: c.github_repo,
        running: c.running,
        notes: c.notes,
        folders: folderSummary(c.folders),
      })),
    );
  },
);

server.registerTool(
  'list_crew',
  { description: 'List crew roles you can delegate to, with their charters summarized.' },
  async () => text((await call('/crew')).filter((r: any) => r.id !== 'conductor').map((r: any) => ({ id: r.id, name: r.name, description: r.description, default_channel: r.channel }))),
);

server.registerTool(
  'delegate',
  {
    description:
      'Hand a task to a crew role in a channel. Creates a new thread that runs in the background. ' +
      'Its final reply is reported back to you automatically as a [crew report] message; do not poll for it. ' +
      'Without a harness/model/effort it uses the role\'s defaults, and with none set anywhere, Auto: Omni reads the brief and ' +
      'picks the harness, model and effort for it, and the result says why in auto_reason. Use list_harnesses for valid ids.',
    inputSchema: {
      channel: z.string().describe('Channel id, e.g. "acme". Use list_channels.'),
      role: z.string().describe('Crew role id, e.g. "researcher". Use list_crew.'),
      prompt: z.string().describe('Self-contained task brief. Include everything the crewmate needs; it cannot see your chat.'),
      task_id: z.string().optional().describe('Short id like T-12 to match the report. Generated if omitted.'),
      title: z.string().optional(),
      harness: z
        .string()
        .optional()
        .describe(
          'Override the role default harness: claude-code, codex, cursor, hermes or cursor-cloud. cursor runs the cursor-agent CLI on this Mac; ' +
            'cursor-cloud launches a Cursor cloud agent on Cursor\'s Linux machines that pushes a branch and opens a PR (no Mac build, Swift tests or screenshots). Use list_harnesses.',
        ),
      model: z
        .string()
        .optional()
        .describe('Any catalog model id, a Claude alias (opus, sonnet, haiku, fable), or "auto" (with no harness) to let Omni pick for this brief. Use list_harnesses.'),
      effort: z.string().optional().describe('Reasoning effort supported by the model, e.g. high. Use list_harnesses.'),
      folder: z.string().optional().describe('Sidebar folder in the channel to file the thread in, by name or id. Use list_channels. It must exist unless create_folder is true.'),
      create_folder: z.boolean().optional().describe(`Create \`folder\` when the channel has none by that name. Only when ${USER} asked for the folder or agreed to it.`),
      base: z
        .string()
        .optional()
        .describe(
          'Where a repo channel\'s new worktree branch starts: omit or "head" for the repo\'s current commit, "remote-default" for origin\'s default branch (fetched first, the checkout is never moved), ' +
            'or the name of an existing branch, tag or commit. Ignored when the thread gets no worktree. Use it when the work must start from the latest origin, not a stale local checkout.',
        ),
    },
  },
  async ({ channel, role, prompt, task_id, title, harness, model, effort, folder, create_folder, base }) => {
    if (folder?.trim()) await checkFolder(channel, folder, create_folder);
    const t = await call('/threads', {
      method: 'POST',
      body: JSON.stringify({ channel, role, prompt, task_id, title, harness, model, effort, folder, base: basePick(base), parent_id: SELF, source: 'conductor' }),
    });
    return text({ thread_id: t.id, task_id: t.task_id, channel: t.channel_id, folder_id: t.folder_id, role: t.role, harness: t.harness, model: t.model, effort: t.effort, auto_reason: t.auto_reason, status: t.status, branch: t.branch });
  },
);

server.registerTool(
  'delegate_team',
  {
    description:
      'Hand several parts of one job to a team: one lead thread in the channel with a member thread per task under it. ' +
      `Use it when ${USER} asks for several agents on one topic (for example price, reviews and alternatives for one product). ` +
      'The members run in parallel; once all have reported, the lead combines their replies into one answer, ' +
      'which comes back to you as a single [crew report]. Do not poll for it.',
    inputSchema: {
      channel: z.string().describe('Channel id, e.g. "inbox". Use list_channels.'),
      title: z.string().describe('Short title for the lead thread, e.g. "Shure MV7+ research".'),
      prompt: z.string().describe('What the team is for and what the combined answer should look like. The lead gets this with every report.'),
      role: z.string().optional().describe('Crew role id for the lead, and for every task that names none. Use list_crew.'),
      task_id: z.string().optional().describe('Short id like T-12 for the team. Members get T-12.1, T-12.2 unless they name their own.'),
      folder: z.string().optional().describe('Sidebar folder in the channel to file the lead thread in, by name or id. Same rules as delegate.'),
      create_folder: z.boolean().optional().describe(`Create \`folder\` when the channel has none by that name. Only when ${USER} asked for the folder or agreed to it.`),
      tasks: z
        .array(
          z.object({
            title: z.string().describe('Short title, e.g. "Best price in NL".'),
            prompt: z.string().describe('Self-contained brief for this member. It cannot see your chat or the other members.'),
            role: z.string().optional(),
            task_id: z.string().optional(),
            harness: z.string().optional(),
            model: z.string().optional(),
            effort: z.string().optional(),
          }),
        )
        .min(1),
    },
  },
  async ({ channel, title, prompt, role, task_id, folder, create_folder, tasks }) => {
    if (folder?.trim()) await checkFolder(channel, folder, create_folder);
    const { lead, members } = await call('/threads/team', {
      method: 'POST',
      body: JSON.stringify({ channel, title, prompt, role, task_id, folder, tasks, parent_id: SELF, source: 'conductor' }),
    });
    const brief = (t: any) => ({ thread_id: t.id, task_id: t.task_id, title: t.title, channel: t.channel_id, role: t.role, harness: t.harness, status: t.status });
    return text({ lead: brief(lead), members: members.map(brief) });
  },
);

server.registerTool(
  'file_thread',
  {
    description:
      'Put an existing thread in a sidebar folder of its own channel, by folder name or id. ' +
      `Use it after ${USER} agrees to a folder you suggested, or to move a thread ${USER} says is filed wrong. ` +
      'create: true makes the folder when the channel has none by that name. An empty folder takes the thread out of its folder.',
    inputSchema: {
      thread_id: z.string(),
      folder: z.string().describe('Folder name or id in the thread\'s channel. Empty string: out of any folder.'),
      create: z.boolean().optional().describe(`Create the folder if the channel has none by that name. Only when ${USER} asked for it or agreed.`),
    },
  },
  async ({ thread_id, folder, create }) => {
    const { thread } = await call(`/threads/${thread_id}`);
    let folder_id: string | null = null;
    if (folder.trim()) {
      const hit = await checkFolder(thread.channel_id, folder, create);
      folder_id = hit?.id ?? (await call('/folders', { method: 'POST', body: JSON.stringify({ channel: thread.channel_id, name: folder }) })).id;
    }
    const t = await call(`/threads/${thread_id}`, { method: 'PATCH', body: JSON.stringify({ folder_id }) });
    return text({ thread_id: t.id, channel: t.channel_id, folder_id: t.folder_id });
  },
);

server.registerTool(
  'mark_thread_done',
  {
    description:
      `Mark a thread done so it leaves ${USER}'s Needs you list (failed, blocked or unread), or done: false to reopen it. ` +
      `Only when ${USER} asks. It stays in its channel; a new message or run in it clears done by itself. A running thread cannot be marked done.`,
    inputSchema: {
      thread_id: z.string(),
      done: z.boolean().optional().describe('false reopens it. Default true.'),
    },
  },
  async ({ thread_id, done }) => {
    const t = await call(`/threads/${thread_id}`, { method: 'PATCH', body: JSON.stringify({ done: done ?? true }) });
    return text({ thread_id: t.id, channel: t.channel_id, status: t.status, done_at: t.done_at });
  },
);

server.registerTool(
  'list_harnesses',
  {
    description:
      'List the agent harnesses (Claude Code, Codex, Cursor, Hermes, Cursor Cloud) with their availability, fix command, models and effort levels, so you can pass valid ids to delegate. ' +
      'Pass channel to see them as that channel does: cursor-cloud needs the channel\'s GitHub repo. ' +
      'Model "auto" is not listed: it is Omni picking among these per brief, and it never picks hermes or cursor-cloud.',
    inputSchema: {
      channel: z.string().optional().describe('Channel id the thread would run in. Cursor Cloud is unavailable in a channel with no GitHub repo.'),
    },
  },
  async ({ channel }) => {
    const list = await call(channel ? `/harnesses?channel=${encodeURIComponent(channel)}` : '/harnesses');
    return text(
      list.map((h: any) => ({
        id: h.id,
        name: h.name,
        plan: h.plan,
        available: h.available,
        fix: h.available ? undefined : h.fix,
        cap: h.cap,
        running: h.running,
        models: (h.models ?? []).map((m: any) => ({ id: m.id, label: m.label, efforts: m.efforts, default_effort: m.defaultEffort, default: m.default })),
      })),
    );
  },
);

server.registerTool(
  'message_thread',
  {
    description:
      'Send a message to an existing thread (yours or any other). It resumes with full context. ' +
      'If the thread is busy, mode "steer" (default) hands it over at its next step so it adjusts while it keeps working; ' +
      'mode "queue" waits until its current turn ends and then runs as a new turn. ' +
      'A steer to a thread whose harness cannot steer (Cursor) is queued automatically.',
    inputSchema: {
      thread_id: z.string(),
      message: z.string(),
      mode: z.enum(['steer', 'queue']).optional().describe('steer (default): read at its next step if busy. queue: after its current turn.'),
    },
  },
  async ({ thread_id, message, mode }) => {
    const t = await call(`/threads/${thread_id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ prompt: message, from: 'conductor', mode: mode ?? 'steer' }),
    });
    return text({ thread_id: t.id, status: t.status });
  },
);

server.registerTool(
  'switch_thread_run',
  {
    description:
      'Move an existing thread to another harness, model or effort. Its next message runs on the new one. ' +
      'Same harness: its session carries on with the new model or effort. Another harness: the next session reads the thread so far first. ' +
      'While a turn runs, the switch waits and applies once the turn ends (`queued_*` on the result); its current run picked again drops it. ' +
      `Only when ${USER} asks. Refused to or from Hermes or Cursor Cloud. Ids come from list_harnesses.`,
    inputSchema: {
      thread_id: z.string(),
      harness: z.string().describe('claude-code, codex or cursor.'),
      model: z.string().optional().describe("A model id from list_harnesses. Omit for the harness's default."),
      effort: z.string().optional().describe("One of the model's effort levels. Omit for its default."),
    },
  },
  async ({ thread_id, harness, model, effort }) => {
    const t = await call(`/threads/${thread_id}/run`, { method: 'POST', body: JSON.stringify({ harness, model: model ?? '', effort: effort ?? '' }) });
    const queued = t.queued_harness ? { harness: t.queued_harness, model: t.queued_model, effort: t.queued_effort } : null;
    return text({ thread_id: t.id, harness: t.harness, model: t.model, effort: t.effort, queued });
  },
);

server.registerTool(
  'watch_pr',
  {
    description:
      "Watch a thread's PR. Omni polls GitHub itself and wakes the thread once per new failing check on a head, with the " +
      'failing checks and a log tail, and once per batch of new review feedback from someone else (reviews, inline and ' +
      "conversation comments, never the signed-in account's own), with author, link and an excerpt; unchanged polls cost " +
      'no turn. A watch ends on its own when the PR merges or closes, the thread is archived, or after its wake limit ' +
      '(three wakes for review comments alone). action: start (the branch\'s open PR, or `number`), stop, ' +
      'or status. Without thread_id, status lists every watch on this Mac.',
    inputSchema: {
      thread_id: z.string().optional(),
      action: z.enum(['start', 'stop', 'status']),
      number: z.number().int().positive().optional().describe("The PR to watch. Omit for the thread branch's open PR."),
    },
  },
  async ({ thread_id, action, number }) => {
    if (!thread_id) {
      if (action !== 'status') throw new Error('start and stop need a thread_id.');
      return text(await call('/pr-watches'));
    }
    const path = `/threads/${encodeURIComponent(thread_id)}/pr-watch`;
    if (action === 'start') return text(await call(path, { method: 'PUT', body: JSON.stringify(number ? { number } : {}) }));
    if (action === 'stop') return text(await call(path, { method: 'DELETE' }));
    return text(await call(path));
  },
);

server.registerTool(
  'continue_thread',
  {
    description:
      `Continue an idle thread in a new one on a local harness, only when ${USER} asks. The new thread is linked to it, in the same ` +
      'channel, with a session of its own and, for repo work, its own worktree on a new branch with the uncommitted changes carried. ' +
      'Its first session reads a carryover of the thread (goal, changed files, checks, recent history) ahead of `message`. ' +
      'Files attached in the thread go only when named in `attachments`: they are copied into the new thread, and any that are missing, too big or not plain files are listed back with why. ' +
      'The thread itself stays as it is. Refused while anything runs or waits in it, and to or from Hermes or Cursor Cloud. Ids come from list_harnesses.',
    inputSchema: {
      thread_id: z.string(),
      harness: z.string().describe('claude-code, codex or cursor.'),
      model: z.string().optional().describe("A model id from list_harnesses. Omit for the harness's default. Not Omni's Auto; Cursor's own auto model is fine."),
      effort: z.string().optional().describe("One of the model's effort levels. Omit for its default."),
      message: z.string().describe('The first message for the new thread. It reads it after the carryover, whole.'),
      attachments: z.array(z.string()).optional().describe('Names of files attached in the thread to carry into the new one. Omit to carry none.'),
    },
  },
  async ({ thread_id, harness, model, effort, message, attachments }) => {
    const run = { harness, model: model ?? '', effort: effort ?? '' };
    const previewOf = (picked?: string[]) => call(`/threads/${thread_id}/continue/preview`, { method: 'POST', body: JSON.stringify({ ...run, attachments: picked }) });
    let preview = await previewOf();
    if (attachments?.length) {
      const has: { id: string; name: string }[] = preview.carryover.attachments;
      const missing = attachments.filter((n) => !has.some((a) => a.name === n));
      if (missing.length) return text(`Not continued: this thread has no attachment named ${missing.join(', ')}. It has: ${has.map((a) => a.name).join(', ') || 'none'}.`);
      preview = await previewOf(has.filter((a) => attachments.includes(a.name)).map((a) => a.id));
    }
    if (preview.blocked) return text(`Not continued: ${preview.blocked.message}`);
    const picked = (preview.carryover.attachments as { id: string; selected: boolean }[]).filter((a) => a.selected).map((a) => a.id);
    const { thread } = await call(`/threads/${thread_id}/continue`, {
      method: 'POST',
      body: JSON.stringify({ ...run, text: message, attachments: picked, request_id: randomUUID(), revision: preview.revision }),
    });
    const files = (preview.carryover.attachments as { name: string; selected: boolean; carried: boolean; reason: string | null }[])
      .filter((a) => a.selected)
      .map((a) => ({ name: a.name, carried: a.carried, ...(a.reason && { not_carried_because: a.reason }) }));
    return text({
      thread_id: thread.id,
      title: thread.title,
      continued_from: thread_id,
      harness: thread.harness,
      model: thread.model,
      effort: thread.effort,
      status: thread.status,
      branch: thread.branch,
      ...(files.length && { attachments: files }),
    });
  },
);

server.registerTool(
  'get_thread',
  { description: 'Status, last reply and artifacts of a thread.', inputSchema: { thread_id: z.string() } },
  async ({ thread_id }) => text(await call(`/threads/${thread_id}/summary`)),
);

server.registerTool(
  'list_threads',
  {
    description: 'Recent threads, optionally filtered by channel or status (queued, running, done, failed, stopped).',
    inputSchema: { channel: z.string().optional(), status: z.string().optional(), limit: z.number().optional() },
  },
  async ({ channel, status, limit }) => {
    const q = new URLSearchParams();
    if (channel) q.set('channel', channel);
    if (status) q.set('status', status);
    q.set('limit', String(limit ?? 20));
    const list = await call(`/threads?${q}`);
    return text(list.map((t: any) => ({ id: t.id, title: t.title, channel: t.channel_id, role: t.role, status: t.status, task_id: t.task_id, updated_at: t.updated_at })));
  },
);

server.registerTool(
  'list_devices',
  {
    description:
      `The other Macs ${USER} syncs Omni with, each with its id, name and whether Tailscale sees it up: online, offline or unknown ` +
      '(no Tailscale to ask). A thread can be handed to any that is not offline. Empty while sync is off.',
  },
  async () => text(await call('/devices')),
);

server.registerTool(
  'hand_off_thread',
  {
    description:
      `Move a thread to another of ${USER}'s Macs, only when ${USER} asks. A running turn stops here and the other Mac resumes the same ` +
      'session, then runs the messages that were queued for it. An idle thread moves between turns: the next message runs on the other Mac. A worktree thread takes its commits and uncommitted changes along. ' +
      'It runs in the background after this answers; the thread shows where it is.',
    inputSchema: {
      thread_id: z.string(),
      to: z.string().describe('The Mac, by id or name (ignoring case), from list_devices.'),
    },
  },
  async ({ thread_id, to }) => {
    const devices: any[] = await call('/devices');
    const want = to.trim().toLowerCase();
    const named = devices.filter((d) => d.name.toLowerCase() === want);
    const hit = devices.find((d) => d.id === to) ?? (named.length === 1 ? named[0] : null);
    if (named.length > 1 && !hit) throw new Error(`${named.length} Macs are called "${to}". Pass the id instead: ${named.map((d) => d.id).join(', ')}.`);
    if (!hit) throw new Error(`No synced Mac is called "${to}". Macs: ${devices.map((d) => `${d.name} (${d.id})`).join(', ') || 'none, sync is off or no other Mac has synced'}.`);
    const res = await call(`/threads/${thread_id}/handoff`, { method: 'POST', body: JSON.stringify({ to: hit.id }) });
    return text({ thread_id, to: { id: hit.id, name: hit.name }, handoff: res.handoff?.state ?? null });
  },
);

server.registerTool(
  'list_published_artifacts',
  {
    description:
      'Pages threads published to claude.ai with the Artifact tool, one row per page, newest first: its url, the thread that published it, and the local file. ' +
      'Read a page\'s comments with ArtifactComments (action "read") and hand open ones to its thread with check_artifact_comments.',
    inputSchema: { channel: z.string().optional(), limit: z.number().optional() },
  },
  async ({ channel, limit }) => {
    const q = new URLSearchParams({ limit: String(limit ?? 50) });
    if (channel) q.set('channel', channel);
    const list = await call(`/artifacts/published?${q}`);
    return text(list.map((a: any) => ({ url: a.url, name: a.name, description: a.description, thread_id: a.thread_id, thread: a.thread_title, channel: a.channel_id, updated_at: a.updated_at })));
  },
);

server.registerTool(
  'check_artifact_comments',
  {
    description:
      'Ask the thread that published a claude.ai page to act on its comments: it reads them, makes the changes, republishes, replies and resolves. ' +
      'Queued after the thread\'s current turn. Only call it for pages with open comment threads sent to Claude.',
    inputSchema: { thread_id: z.string(), url: z.string().describe('The page url from list_published_artifacts.') },
  },
  async ({ thread_id, url }) => {
    const t = await call(`/threads/${thread_id}/published/comments`, { method: 'POST', body: JSON.stringify({ url }) });
    return text({ thread_id: t.id, status: t.status });
  },
);

server.registerTool(
  'send_to_grok_bot',
  {
    description:
      `Send text to ${USER}'s Grok Bot, only when ${USER} asks. Pass request for that text, or thread_id alone to send the thread's title and messages. ` +
      'A thread_id also adds that thread\'s channel id and thread id to the context. The webhook is configured in Settings, Secrets, or .env.',
    inputSchema: {
      request: z.string().min(1).max(100_000).optional(),
      thread_id: z.string().min(1).max(200).optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async ({ request, thread_id, context }) => {
    const body: { request?: string; thread_id?: string; context?: Record<string, unknown> } = {};
    if (request !== undefined) body.request = request;
    if (thread_id !== undefined) body.thread_id = thread_id;
    if (context !== undefined) body.context = context;
    return text(await call('/grokbot', { method: 'POST', body: JSON.stringify(body) }));
  },
);

server.registerTool(
  'search_history',
  { description: `Full-text search across every thread ${USER} has run.`, inputSchema: { query: z.string() } },
  async ({ query }) => text(await call(`/search?q=${encodeURIComponent(query)}`)),
);

/** A refused delivery action is an answer for the conductor to read, not a crash: the server says why in `error`. */
const refused = async (run: () => Promise<unknown>) => {
  try {
    return text(await run());
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return text({ done: false, why: err.message });
    throw err;
  }
};

server.registerTool(
  'list_automation_deliveries',
  {
    description:
      "An event automation's deliveries, newest first: each event that reached it (a published page, a GitHub webhook) and what became of it. " +
      'state is received, accepted, queued (held for the Mac that runs automations), started (its thread exists: see thread_id and thread_status), ' +
      'failed or skipped (with reason). can_retry means it failed before any thread was made, so retrying cannot duplicate a run. ' +
      "A failed one that has a thread (retry_blocked says so) has an unknown outcome: open that thread and follow up there. Pass the last id as before to page.",
    inputSchema: { automation: z.string().min(1).max(200), limit: z.number().int().min(1).max(100).optional(), before: z.string().optional() },
  },
  async ({ automation, limit, before }) =>
    text(await call(`/automations/${encodeURIComponent(automation)}/deliveries?limit=${limit ?? 20}${before ? `&before=${encodeURIComponent(before)}` : ''}`)),
);

server.registerTool(
  'retry_delivery',
  {
    description:
      `Run a failed automation delivery again, only when ${USER} asks. Works only for a delivery with can_retry: it failed before any thread was made, and the event is still within the automation's max age. ` +
      'Pass the attempt you saw; a stale attempt, a delivery that already started and one whose thread exists are refused with the reason, and nothing is started twice.',
    inputSchema: { delivery_id: z.string().min(1).max(200), attempt: z.number().int().positive() },
  },
  async ({ delivery_id, attempt }) =>
    refused(() => call(`/deliveries/${encodeURIComponent(delivery_id)}/retry`, { method: 'POST', body: JSON.stringify({ attempt }) })),
);

server.registerTool(
  'skip_delivery',
  {
    description:
      `Skip a delivery of an event automation for good, only when ${USER} asks: it never starts and cannot be retried. Works for a delivery that has not started (accepted, queued, or failed with no thread). ` +
      'Refused with the reason once its thread exists or while Omni is starting it.',
    inputSchema: { delivery_id: z.string().min(1).max(200), attempt: z.number().int().positive().optional() },
  },
  async ({ delivery_id, attempt }) =>
    refused(() => call(`/deliveries/${encodeURIComponent(delivery_id)}/skip`, { method: 'POST', body: JSON.stringify(attempt === undefined ? {} : { attempt }) })),
);

server.registerTool('worktree_storage', {
  description: 'Read-only inventory of the worktrees in data/worktrees: size, owning thread and why each is kept or eligible for cleanup, plus what a cleanup or this Mac\'s retention policy would remove and the last cleanup runs. With scan: true, starts a background scan first (it takes a minute); call again without it to read progress and the result. Deletes nothing: only Ben removes worktrees, in Settings > Storage.',
  inputSchema: { scan: z.boolean().optional() },
}, async ({ scan }) => text(await call('/worktrees/scan', scan ? { method: 'POST' } : undefined)));

// #218: the conductor reads a thread Ben referenced in a message the same way every other thread does.
registerReferencedThread(server);

server.registerTool('tool_failures', {
  description: 'Inspect machine-local tool failures grouped by harness, tool and category, most frequent first. With group_id, list occurrences with thread/call references. No raw arguments or error bodies. Use before for older occurrences.',
  inputSchema: { group_id: z.string().optional(), status: z.enum(['open', 'investigating', 'fixed', 'avoid', 'replacement']).optional(), before: z.number().int().positive().optional() },
}, async ({ group_id, status, before }) => text(await call(group_id
  ? `/tool-failures/${encodeURIComponent(group_id)}/occurrences${before ? `?before=${before}` : ''}`
  : `/tool-failures${status ? `?status=${status}` : ''}`)));

server.registerTool('triage_tool_failure', {
  description: 'Record tool failure remediation status and safe human-written fix/replacement/avoidance guidance. Never include raw errors, arguments, private data or credentials. Does not disable tools. A later failure reopens a fixed group.',
  inputSchema: { group_id: z.string(), status: z.enum(['open', 'investigating', 'fixed', 'avoid', 'replacement']), guidance: z.string().max(1000) },
}, async ({ group_id, ...body }) => text(await call(`/tool-failures/${encodeURIComponent(group_id)}`, { method: 'PATCH', body: JSON.stringify(body) })));

server.registerTool('note_tool_failure_recovery', {
  description: 'Record observed recovery for a tool failure occurrence. Do not infer recovery from an unrelated success. Optionally link a failed retry to an earlier failure ID with retry_of.',
  inputSchema: { id: z.string(), recovery: z.enum(['recovered', 'not_recovered', 'unknown']), retry_of: z.string().optional() },
}, async ({ id, ...body }) => text(await call(`/tool-failures/occurrences/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })));

await server.connect(new StdioServerTransport());
