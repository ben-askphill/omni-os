// GET /api/commands: the `/` menu's command list. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { listCommands } from './commands.ts';
import { paths } from './config.ts';
import { channels, events, threads } from './db.ts';
import { isHarnessId, type HarnessId } from './harness/types.ts';
import { threadCommands } from './runner.ts';
import { commandsFolder } from './sandbox.ts';

export const commandsApi = new Hono();

/**
 * `?thread=<id>`: the commands the thread's running process listed itself, MCP prompts included.
 * With no such process, the harness commands for the folder it runs in, served from the cache at
 * once; `&wait=1` waits for a refresh that is running, so the menu can swap in a fresh list.
 * `?harness=<id>&channel=<id>`: the new-thread composer's list, for the folder a thread started in
 * that channel reads its commands from.
 * `recent` names the commands Ben used last on that harness; the menu shows the ones this list has.
 */
commandsApi.get('/', async (c) => {
  const wait = c.req.query('wait') === '1';
  const id = c.req.query('thread');
  if (id === undefined && c.req.query('channel') !== undefined) {
    const harness = c.req.query('harness');
    if (!isHarnessId(harness)) return c.json({ error: `unknown harness "${harness ?? ''}"` }, 400);
    const channel = channels.get(c.req.query('channel')!);
    if (!channel) return c.json({ error: 'not found' }, 404);
    // With no repo, base dir or brain, a thread runs in a new folder of its own, which has no project commands.
    const list = await listCommands(harness, commandsFolder(channel) ?? paths.threads, { wait });
    return c.json({ ...list, recent: events.recentCommands(harness) });
  }
  const t = id ? threads.get(id) : undefined;
  if (!t) return c.json({ error: 'not found' }, 404);
  const harness = t.harness as HarnessId;
  const list = threadCommands(t.id) ?? (await listCommands(harness, t.cwd, { wait }));
  return c.json({ ...list, recent: events.recentCommands(harness) });
});
