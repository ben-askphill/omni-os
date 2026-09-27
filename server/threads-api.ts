// PATCH /api/threads/:id: Ben's edits to a thread. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { z } from 'zod';
import { TITLE_MAX } from '../shared/slash.ts';
import { publishFeed } from './bus.ts';
import { threads } from './db.ts';

export const threadsApi = new Hono();

const patchSchema = z.object({
  // One line, since `/rename` sends whatever followed the command.
  title: z
    .string({ error: 'a title is required' })
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'a title is required').max(TITLE_MAX, `a title can be up to ${TITLE_MAX} characters`)),
});

/** Rename a thread. It keeps its place in the lists, since nothing happened in it. */
threadsApi.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const t = threads.get(id);
  if (!t) return c.json({ error: 'not found' }, 404);
  const body = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'a title is required' }, 400);
  const renamed = threads.update(id, { title: body.data.title, updated_at: t.updated_at })!;
  publishFeed({ type: 'thread', thread: renamed });
  return c.json(renamed);
});
