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
      'Its final reply is reported back to you automatically as a [crew report] message; do not poll for it.',
    inputSchema: {
      channel: z.string().describe('Channel id, e.g. "volero". Use list_channels.'),
      role: z.string().describe('Crew role id, e.g. "researcher". Use list_crew.'),
      prompt: z.string().describe('Self-contained task brief. Include everything the crewmate needs; it cannot see your chat.'),
      task_id: z.string().optional().describe('Short id like T-12 to match the report. Generated if omitted.'),
      title: z.string().optional(),
      model: z.enum(['opus', 'sonnet', 'haiku', 'fable']).optional().describe('Override the role default. sonnet or haiku for quick lookups.'),
    },
  },
  async ({ channel, role, prompt, task_id, title, model }) => {
    const t = await call('/threads', {
      method: 'POST',
      body: JSON.stringify({ channel, role, prompt, task_id, title, model, parent_id: SELF, source: 'conductor' }),
    });
    return text({ thread_id: t.id, task_id: t.task_id, channel: t.channel_id, role: t.role, status: t.status, branch: t.branch });
  },
);

server.registerTool(
  'message_thread',
  {
    description: 'Send a follow-up to an existing thread (yours or any other). It resumes with full context.',
    inputSchema: { thread_id: z.string(), message: z.string() },
  },
  async ({ thread_id, message }) => {
    const t = await call(`/threads/${thread_id}/messages`, { method: 'POST', body: JSON.stringify({ prompt: message, from: 'conductor' }) });
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
