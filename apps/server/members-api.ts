// /api/threads/:id/members: a group thread's member list (ADR 0019, runner/members.ts). Ben seats an agent with no turn
// (Add an agent), removes one, and switches one member's run. Only Ben: an agent thread, known by its own token or
// caller header, gets a 403, since agents never seat agents in this slice.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { callerOf } from './automation-guard.ts';
import { threads } from './db.ts';
import { withDelegating } from './delegating.ts';
import { userName } from './profile.ts';
import { members } from './db.ts';
import { seat, unseat } from './runner/members.ts';
import { createTransition } from './transition.ts';

export const membersApi = new Hono();

const agentRefusal = (c: Context) => (callerOf(c) ? c.json({ error: `Only ${userName()} seats or removes an agent in a thread.` }, 403) : null);
const view = (id: string) => withDelegating(threads.get(id)!);

membersApi.post('/:id/members', async (c) => {
  const refused = agentRefusal(c);
  if (refused) return refused;
  const { agent } = z.object({ agent: z.string().trim().min(1).max(64) }).parse(await c.req.json().catch(() => ({})));
  seat(c.req.param('id'), agent);
  return c.json(view(c.req.param('id')));
});

membersApi.delete('/:id/members/:agent', (c) => {
  const refused = agentRefusal(c);
  if (refused) return refused;
  unseat(c.req.param('id'), c.req.param('agent'));
  return c.json(view(c.req.param('id')));
});

const runSchema = z.object({
  harness: z.string().min(1),
  model: z.string().nullish().transform((v) => v ?? ''),
  effort: z.string().nullish().transform((v) => v ?? ''),
});

/** One member's run, switched from the member list (Q15). The lead's is the thread's own: POST /api/threads/:id/run. */
membersApi.post('/:id/members/:agent/run', async (c) => {
  const refused = agentRefusal(c);
  if (refused) return refused;
  const m = members.of(c.req.param('id'), c.req.param('agent'));
  if (!m || m.removed_at) return c.json({ error: 'That agent is not in this thread.' }, 404);
  const run = runSchema.parse(await c.req.json().catch(() => ({})));
  await createTransition(m.session_thread, { kind: 'reconfigure', run });
  return c.json(view(c.req.param('id')));
});
