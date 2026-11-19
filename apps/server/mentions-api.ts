// GET /api/mentions: the `@` menu's files. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { getCrew } from './crew.ts';
import { channels, threads } from './db.ts';
import { machineMentionRows } from './machine-pick.ts';
import { listMentions } from './mentions.ts';
import { commandsFolder } from './sandbox.ts';

export const mentionsApi = new Hono();

/**
 * `?thread=<id>&q=<text>`: in a thread whose role has the omni tools (the Conductor), so it can delegate, the synced
 * machines first; then the thread's artifacts, then the files of the folder it runs in.
 * `?channel=<id>&role=<id>&q=<text>`: a new thread's composer, which has no artifacts yet, and lists the files of the
 * folder a thread in that channel starts from. When the role it starts as can delegate (the Conductor), the machines
 * come first, as in a reply: the first message can say which machine each task goes to.
 */
mentionsApi.get('/', async (c) => {
  const query = c.req.query('q') ?? '';
  const id = c.req.query('thread');
  if (id) {
    const t = threads.get(id);
    if (!t) return c.json({ error: 'not found' }, 404);
    const machines = getCrew(t.role)?.mcp.includes('omni') ? await machineMentionRows(query) : [];
    return c.json([...machines, ...listMentions({ cwd: t.cwd, threadId: t.id, query })]);
  }
  const channel = channels.get(c.req.query('channel') ?? '');
  if (!channel) return c.json({ error: 'not found' }, 404);
  const machines = getCrew(c.req.query('role') ?? '')?.mcp.includes('omni') ? await machineMentionRows(query) : [];
  return c.json([...machines, ...listMentions({ cwd: commandsFolder(channel), query })]);
});
