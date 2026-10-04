// Stdio MCP server handed to conductor threads. It talks to the local Omni API,
// so delegated threads are ordinary threads Ben can open, search and continue.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.OMNI_URL ?? 'http://127.0.0.1:4747';
const SELF = process.env.OMNI_THREAD_ID ?? null;

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: 'omni', version: '0.1.0' });

server.registerTool(
  'list_channels',
  { description: 'List Omni channels (one per client or project) with repo, store and running thread count.' },
  async () => {
    const list = await call('/channels');
    return text(
      list.map((c: any) => ({ id: c.id, name: c.name, kind: c.kind, store: c.store_domain, repo: c.github_repo, running: c.running, notes: c.notes })),
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
      'Without a harness/model/effort it uses the role\'s defaults. Use list_harnesses for valid ids.',
    inputSchema: {
      channel: z.string().describe('Channel id, e.g. "volero". Use list_channels.'),
      role: z.string().describe('Crew role id, e.g. "researcher". Use list_crew.'),
      prompt: z.string().describe('Self-contained task brief. Include everything the crewmate needs; it cannot see your chat.'),
      task_id: z.string().optional().describe('Short id like T-12 to match the report. Generated if omitted.'),
      title: z.string().optional(),
      harness: z.string().optional().describe('Override the role default harness: claude-code, codex, cursor or hermes. Use list_harnesses.'),
      model: z.string().optional().describe('Any catalog model id, or a Claude alias (opus, sonnet, haiku, fable). Use list_harnesses.'),
      effort: z.string().optional().describe('Reasoning effort supported by the model, e.g. high. Use list_harnesses.'),
    },
  },
  async ({ channel, role, prompt, task_id, title, harness, model, effort }) => {
    const t = await call('/threads', {
      method: 'POST',
      body: JSON.stringify({ channel, role, prompt, task_id, title, harness, model, effort, parent_id: SELF, source: 'conductor' }),
    });
    return text({ thread_id: t.id, task_id: t.task_id, channel: t.channel_id, role: t.role, harness: t.harness, model: t.model, effort: t.effort, status: t.status, branch: t.branch });
  },
);

server.registerTool(
  'delegate_team',
  {
    description:
      'Hand several parts of one job to a team: one lead thread in the channel with a member thread per task under it. ' +
      'Use it when Ben asks for several agents on one topic (for example price, reviews and alternatives for one product). ' +
      'The members run in parallel; once all have reported, the lead combines their replies into one answer, ' +
      'which comes back to you as a single [crew report]. Do not poll for it.',
    inputSchema: {
      channel: z.string().describe('Channel id, e.g. "inbox". Use list_channels.'),
      title: z.string().describe('Short title for the lead thread, e.g. "Shure MV7+ research".'),
      prompt: z.string().describe('What the team is for and what the combined answer should look like. The lead gets this with every report.'),
      role: z.string().optional().describe('Crew role id for the lead, and for every task that names none. Use list_crew.'),
      task_id: z.string().optional().describe('Short id like T-12 for the team. Members get T-12.1, T-12.2 unless they name their own.'),
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
  async ({ channel, title, prompt, role, task_id, tasks }) => {
    const { lead, members } = await call('/threads/team', {
      method: 'POST',
      body: JSON.stringify({ channel, title, prompt, role, task_id, tasks, parent_id: SELF, source: 'conductor' }),
    });
    const brief = (t: any) => ({ thread_id: t.id, task_id: t.task_id, title: t.title, channel: t.channel_id, role: t.role, harness: t.harness, status: t.status });
    return text({ lead: brief(lead), members: members.map(brief) });
  },
);

server.registerTool(
  'list_harnesses',
  { description: 'List the agent harnesses (Claude Code, Codex, Cursor, Hermes) with their availability, fix command, models and effort levels, so you can pass valid ids to delegate.' },
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
  'search_history',
  { description: 'Full-text search across every thread Ben has run.', inputSchema: { query: z.string() } },
  async ({ query }) => text(await call(`/search?q=${encodeURIComponent(query)}`)),
);

await server.connect(new StdioServerTransport());
