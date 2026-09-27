// GET /api/commands: the `/` menu's command list. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { listCommands } from './commands.ts';
import { events, threads } from './db.ts';
import type { HarnessId } from './harness/types.ts';
import { threadCommands } from './runner.ts';

export const commandsApi = new Hono();

/**
 * `?thread=<id>`: the commands the thread's running process listed itself, MCP prompts included.
 * With no such process, the harness commands for the folder it runs in, served from the cache at
 * once; `&wait=1` waits for a refresh that is running, so the menu can swap in a fresh list.
 * `recent` names the commands Ben used last on that harness; the menu shows the ones this list has.
 */
commandsApi.get('/', async (c) => {
  const id = c.req.query('thread');
  const t = id ? threads.get(id) : undefined;
  if (!t) return c.json({ error: 'not found' }, 404);
  const harness = t.harness as HarnessId;
  const list = threadCommands(t.id) ?? (await listCommands(harness, t.cwd, { wait: c.req.query('wait') === '1' }));
  return c.json({ ...list, recent: events.recentCommands(harness) });
});
