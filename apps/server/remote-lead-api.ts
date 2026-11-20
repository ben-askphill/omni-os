// /api/threads/:id/commit and /open-pr: Ben commits a remote-led thread's changes and opens its pull request
// (remote-lead.ts, ADR 0020). Only Ben: an agent thread, known by its own token or caller header, gets a 403, since no
// agent of such a thread commits.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { callerOf } from './automation-guard.ts';
import { userName } from './profile.ts';
import { commitThread, openThreadPR } from './remote-lead.ts';

export const remoteLeadApi = new Hono();

const agentRefusal = (c: Context) => (callerOf(c) ? c.json({ error: `Only ${userName()} commits in a thread a remote agent leads.` }, 403) : null);

remoteLeadApi.post('/:id/commit', async (c) => {
  const refused = agentRefusal(c);
  if (refused) return refused;
  const body = z.object({ message: z.string().max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send { message }.' }, 400);
  return c.json(await commitThread(c.req.param('id'), body.data.message));
});

remoteLeadApi.post('/:id/open-pr', async (c) => {
  const refused = agentRefusal(c);
  if (refused) return refused;
  return c.json(await openThreadPR(c.req.param('id')));
});
