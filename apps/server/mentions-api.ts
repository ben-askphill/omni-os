// GET /api/mentions: the `@` menu's files. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { channels, threads } from './db.ts';
import { listMentions } from './mentions.ts';
import { commandsFolder } from './sandbox.ts';

export const mentionsApi = new Hono();

/**
 * `?thread=<id>&q=<text>`: the thread's artifacts, then the files of the folder it runs in.
 * `?channel=<id>&q=<text>`: a new thread's composer, which has no artifacts yet, and lists the
 * files of the folder a thread in that channel starts from.
 */
mentionsApi.get('/', (c) => {
  const query = c.req.query('q') ?? '';
  const id = c.req.query('thread');
  if (id) {
    const t = threads.get(id);
    if (!t) return c.json({ error: 'not found' }, 404);
    return c.json(listMentions({ cwd: t.cwd, threadId: t.id, query }));
  }
  const channel = channels.get(c.req.query('channel') ?? '');
  if (!channel) return c.json({ error: 'not found' }, 404);
  return c.json(listMentions({ cwd: commandsFolder(channel), query }));
});
