// /api/threads/:id/members: a group thread's member list (ADR 0019, runner/members.ts). Ben seats an agent with no turn
// (Add an agent), removes one, and switches one member's run. Only Ben: an agent thread, known by its own token or
// caller header, gets a 403. The Conductor seats agents with agent mentions instead (thread-routes-api.ts).
// /api/threads/:id/team/messages: a team's lead gives its members their parts (runner/team.ts). Only that lead, by its
// own thread token: not Ben, not a member, not another thread.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { callerOf, threadCredential } from './automation-guard.ts';
import { threads } from './db.ts';
import { withDelegating } from './delegating.ts';
import { userName } from './profile.ts';
import { members } from './db.ts';
import { seat, unseat } from './runner/members.ts';
import { messageMembers } from './runner/team.ts';
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

const teamMessage = z.object({
  to: z.array(z.string().trim().min(1).max(100)).min(1).max(12),
  message: z.string().max(100_000),
});

membersApi.post('/:id/team/messages', async (c) => {
  const id = c.req.param('id');
  if (threadCredential(c) !== id) return c.json({ error: "Only a team's lead gives its members their parts, from its own thread with message_members." }, 403);
  const body = teamMessage.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Bad request.' }, 400);
  const sent = messageMembers(id, body.data.to, body.data.message);
  return c.json({ thread_id: id, sent });
});
