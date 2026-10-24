// /api/threads/:id/events/:eventId/output: the full output of a tool call that history sends compact (#225), read in
// chunks. See apps/server/tool-output.ts.
import { Hono } from 'hono';
import { threads } from './db.ts';
import { readOutput } from './tool-output.ts';

export const toolOutputApi = new Hono();

const integer = /^\d{1,15}$/;

/** A chunk of a tool_result's saved text: `offset` and `limit` in code points, `next` to ask for the one after. */
toolOutputApi.get('/:id/events/:eventId/output', (c) => {
  const id = c.req.param('id');
  const eventId = c.req.param('eventId');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const offset = c.req.query('offset') ?? '0';
  const limit = c.req.query('limit');
  if (!integer.test(offset) || (limit !== undefined && !/^[1-9]\d{0,9}$/.test(limit))) {
    return c.json({ error: 'offset and limit must be positive integers' }, 400);
  }
  const chunk = integer.test(eventId) ? readOutput(id, Number(eventId), Number(offset), limit ? Number(limit) : undefined) : null;
  return chunk ? c.json(chunk) : c.json({ error: 'tool result not found' }, 404);
});
