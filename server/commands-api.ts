// GET /api/commands: the `/` menu's command list. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { listCommands } from './commands.ts';
import { threads } from './db.ts';
import type { HarnessId } from './harness/types.ts';

export const commandsApi = new Hono();

/**
 * `?thread=<id>`: the thread's harness commands for the folder it runs in, served from the cache
 * at once. `&wait=1` waits for a refresh that is running, so the menu can swap in a fresh list.
 */
commandsApi.get('/', async (c) => {
  const id = c.req.query('thread');
  const t = id ? threads.get(id) : undefined;
  if (!t) return c.json({ error: 'not found' }, 404);
  return c.json(await listCommands(t.harness as HarnessId, t.cwd, { wait: c.req.query('wait') === '1' }));
});
