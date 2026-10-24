// /api/threads/:id/events/:eventId/output and /api/threads/:id/tools/:toolUseId/tail: the full output of a tool call
// that history sends compact (#225), read in chunks once saved and followed through a bounded tail while it runs.
// See apps/server/tool-output.ts and tool-tail.ts.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { TOOL_OUTPUT } from '@omni/shared/tool-output.ts';
import { threads } from './db.ts';
import { readOutput } from './tool-output.ts';
import { toolTails } from './tool-tail.ts';

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

/**
 * The live tail of a running call: the newest of what it printed, then what it prints, in a few messages a second
 * (TailMessage). The connection is the subscription: the buffer behind it is freed when the client closes it.
 */
toolOutputApi.get('/:id/tools/:toolUseId/tail', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const tail = toolTails.subscribe(id, c.req.param('toolUseId'));
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => tail.close());
    try {
      await stream.writeSSE({ event: 'ping', data: '' });
      while (!stream.aborted) {
        const m = tail.take();
        if (!m) {
          if (!(await tail.ready(20_000)) && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '' });
          continue;
        }
        await stream.writeSSE({ data: JSON.stringify(m) });
        if (m.kind === 'end') break;
        // A noisy command fills the buffer meanwhile, and the next message carries what fits of it.
        await stream.sleep(TOOL_OUTPUT.flushMs);
      }
    } finally {
      tail.close();
    }
  });
});
