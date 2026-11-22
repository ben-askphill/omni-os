// GET /api/skills: the skills this machine's harnesses list, for an agent's Skills group in Settings > Agents
// (skills.ts). `?channel=<id>`: the folder a thread started in that channel reads its commands from, so that repo's
// project skills are in it too. Without one, the folder a thread with no repo starts in, which has none.
import { Hono } from 'hono';
import { paths } from './config.ts';
import { channels } from './db.ts';
import { commandsFolder } from './sandbox.ts';
import { skillCatalog } from './skills.ts';

export const skillsApi = new Hono();

skillsApi.get('/', async (c) => {
  const id = c.req.query('channel');
  const channel = id ? channels.get(id) : undefined;
  if (id && !channel) return c.json({ error: 'No channel with this id.' }, 404);
  return c.json(await skillCatalog((channel && commandsFolder(channel)) ?? paths.threads));
});
