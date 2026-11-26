import { Hono } from 'hono';
import { z } from 'zod';
import { threads } from './db.ts';
import { FAILURE_CATEGORIES, FAILURE_STATUSES, toolFailures } from './tool-failures.ts';

export const toolFailuresApi = new Hono();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.string().regex(/^[a-zA-Z0-9_.:/-]{1,200}$/);

toolFailuresApi.get('/', (c) => {
  const status = z.enum(FAILURE_STATUSES).optional().parse(c.req.query('status'));
  return c.json(toolFailures.groups(status));
});
toolFailuresApi.get('/:group', (c) => {
  const group = hash.parse(c.req.param('group'));
  const row = toolFailures.group(group);
  return row ? c.json(row) : c.json({ error: 'not found' }, 404);
});
toolFailuresApi.get('/:group/occurrences', (c) => {
  const group = hash.parse(c.req.param('group'));
  const before = z.coerce.number().int().positive().optional().parse(c.req.query('before'));
  return c.json(toolFailures.occurrences(group, before));
});
toolFailuresApi.patch('/:group', async (c) => {
  const group = hash.parse(c.req.param('group'));
  const { status, guidance } = z.object({ status: z.enum(FAILURE_STATUSES), guidance: z.string().max(1000).default('') }).strict().parse(await c.req.json());
  return toolFailures.triage(group, status, guidance) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
});
toolFailuresApi.patch('/occurrences/:id', async (c) => {
  const id = hash.parse(c.req.param('id'));
  const { recovery, retry_of } = z.object({ recovery: z.enum(['recovered', 'not_recovered', 'unknown']), retry_of: hash.optional() }).strict().parse(await c.req.json());
  return toolFailures.context(id, recovery, retry_of) ? c.json({ ok: true }) : c.json({ error: 'failure or retry reference not found' }, 404);
});
// Fallback for hidden inner tools. Identity comes from the thread, not a supplied channel/harness.
// No arguments or error text accepted, so a manual report has the same privacy boundary as automatic capture.
toolFailuresApi.post('/', async (c) => {
  const { thread_id, call_id, tool, category, parent_call_id } = z.object({
    thread_id: reference, call_id: reference, tool: reference, category: z.enum(FAILURE_CATEGORIES),
    parent_call_id: reference.optional(),
  }).strict().parse(await c.req.json());
  const thread = threads.get(thread_id);
  if (!thread) return c.json({ error: 'thread not found' }, 404);
  return c.json(toolFailures.record({ thread_id, call_id, tool, category, parent_call_id,
    channel_id: thread.channel_id, harness: thread.harness, session_id: thread.session_id }));
});
