// PATCH /api/threads/:id: Ben's edits to a thread. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { z } from 'zod';
import { TITLE_MAX } from '../shared/slash.ts';
import { publishFeed } from './bus.ts';
import { threads, type Thread } from './db.ts';

export const threadsApi = new Hono();

const titleSchema = z
  .string({ error: 'a title is required' })
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'a title is required').max(TITLE_MAX, `a title can be up to ${TITLE_MAX} characters`));

const patchSchema = z
  .object({
    // One line, since `/rename` sends whatever followed the command.
    title: titleSchema.optional(),
    archived: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  })
  .refine((b) => b.title !== undefined || b.archived !== undefined, 'a title is required');

/** Rename or archive a thread. It keeps its place in the lists, since nothing happened in it. */
threadsApi.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const t = threads.get(id);
  if (!t) return c.json({ error: 'not found' }, 404);
  const body = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'a title is required' }, 400);
  const edit: Partial<Thread> = {};
  if (body.data.title !== undefined) edit.title = body.data.title;
  if (body.data.archived !== undefined) edit.archived = body.data.archived ? 1 : 0;
  const renamed = threads.update(id, { ...edit, updated_at: t.updated_at })!;
  publishFeed({ type: 'thread', thread: renamed });
  return c.json(renamed);
});
