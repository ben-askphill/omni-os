// An Ask from an older client (ADR 0019, Q19): an Ask used to start a thread on the asked agent under this one. Seating
// replaced it, so the server turns one into Ben's message naming that agent in the asking thread, which seats it there.
// Only Ben asks: an agent thread, known by its own token or caller header (automation-guard.ts callerOf), gets a 403.
// Ask cards and their threads from before this change keep rendering from their stored events.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { agentMention, agentMentionBody } from '@omni/shared/message-context-agent.ts';
import { callerOf } from './automation-guard.ts';
import { getCrew } from './crew.ts';
import { userName } from './profile.ts';
import { postMessage } from './runner.ts';

export const askApi = new Hono();

const askBody = z.object({
  role: z.string().trim().min(1, 'Pick an agent to ask.').max(64),
  question: z.string().max(20_000),
  request_id: z.string().max(64).optional(),
});

const failed = (c: Context, e: unknown) => {
  const status = (e as { status?: number }).status;
  if (status === 400 || status === 403 || status === 404 || status === 409) return c.json({ error: (e as Error).message }, status);
  throw e;
};

askApi.post('/:id/ask', async (c) => {
  if (callerOf(c)) return c.json({ error: `Only ${userName()} seats an agent in a thread. An agent hands work on with delegate.` }, 403);
  const parsed = askBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Bad request.' }, 400);
  const { role, question, request_id } = parsed.data;
  const agent = getCrew(role);
  if (!agent) return c.json({ error: `No agent "${role}" here.` }, 404);
  const body = agentMentionBody(agent);
  const mention = { id: 'ask', kind: agentMention.kind, v: agentMention.v, label: agentMention.label(body), note: '', body };
  const prompt = question.trim() ? `@${body.name} ${question.trim()}` : `@${body.name}`;
  try {
    return c.json(await postMessage(c.req.param('id'), prompt, { from: 'ben', context: [mention], requestId: request_id }), 201);
  } catch (e) {
    return failed(c, e);
  }
});
