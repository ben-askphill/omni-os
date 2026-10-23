// Stdio MCP server handed to conductor threads. It talks to the local Omni API,
// so delegated threads are ordinary threads the user can open, search and continue.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const BASE = process.env.OMNI_URL ?? 'http://127.0.0.1:4747';
/** The API token: OMNI_TOKEN from the thread's env, else the file Omni named in OMNI_TOKEN_FILE (data/api-token). */
const TOKEN = process.env.OMNI_TOKEN || readToken(process.env.OMNI_TOKEN_FILE);

function readToken(file?: string) {
  try {
    return file ? readFileSync(file, 'utf8').trim() : '';
  } catch {
    return '';
  }
}
const SELF = process.env.OMNI_THREAD_ID ?? null;
/** Who the conductor works for, from the user config (apps/server/user-config.ts). */
const USER = process.env.OMNI_USER || 'the user';

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: 'omni', version: '0.1.0' });

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
      harness: z.string().optional().describe('Override the role default harness: claude-code, codex, cursor or hermes. Use list_harnesses.'),
      model: z
        .string()
        .optional()
        .describe('Any catalog model id, a Claude alias (opus, sonnet, haiku, fable), or "auto" (with no harness) to let Omni pick for this brief. Use list_harnesses.'),
      effort: z.string().optional().describe('Reasoning effort supported by the model, e.g. high. Use list_harnesses.'),
      folder: z.string().optional().describe('Sidebar folder in the channel to file the thread in, by name or id. Use list_channels. It must exist unless create_folder is true.'),
      create_folder: z.boolean().optional().describe(`Create \`folder\` when the channel has none by that name. Only when ${USER} asked for the folder or agreed to it.`),
    },
  },
  async ({ channel, role, prompt, task_id, title, harness, model, effort, folder, create_folder }) => {
    if (folder?.trim()) await checkFolder(channel, folder, create_folder);
    const t = await call('/threads', {
      method: 'POST',
      body: JSON.stringify({ channel, role, prompt, task_id, title, harness, model, effort, folder, parent_id: SELF, source: 'conductor' }),
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
      'List the agent harnesses (Claude Code, Codex, Cursor, Hermes) with their availability, fix command, models and effort levels, so you can pass valid ids to delegate. ' +
      'Model "auto" is not listed: it is Omni picking among these per brief.',
  },
  async () => {
    const list = await call('/harnesses');
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
      `Move a running thread to another of ${USER}'s Macs, only when ${USER} asks: it stops here and the other Mac resumes the same ` +
      'session, then runs the messages that were queued for it. A worktree thread takes its commits and uncommitted changes along. ' +
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
  'search_history',
  { description: `Full-text search across every thread ${USER} has run.`, inputSchema: { query: z.string() } },
  async ({ query }) => text(await call(`/search?q=${encodeURIComponent(query)}`)),
);

await server.connect(new StdioServerTransport());
