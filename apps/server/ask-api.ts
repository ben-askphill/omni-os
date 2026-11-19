// Ask from a thread (ask.ts): what an Ask would carry, and sending one. Only Ben asks: an agent thread, known by its
// own token or caller header (automation-guard.ts callerOf), gets a 403, so no agent can start work that reads as his
// or put an `ask` event in a thread. An agent hands work on with delegate instead.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { askPreview, sendAsk } from './ask.ts';
import { callerOf } from './automation-guard.ts';
import { userName } from './profile.ts';

export const askApi = new Hono();

const askBody = z
  .object({
    role: z.string().trim().min(1, 'Pick a role to ask.').max(64),
    question: z.string().max(20_000),
    excerpt: z.boolean().default(true),
    wake: z.boolean().default(true),
    request_id: z.string().max(64).optional(),
  })
  .strict();

const agentRefusal = (c: Context) => (callerOf(c) ? c.json({ error: `Only ${userName()} asks from a thread. An agent hands work on with delegate.` }, 403) : null);

const failed = (c: Context, e: unknown) => {
  const status = (e as { status?: number }).status;
  if (status === 400 || status === 403 || status === 404 || status === 409) return c.json({ error: (e as Error).message }, status);
  throw e;
};

askApi.get('/:id/ask-preview', async (c) => {
  const refusal = agentRefusal(c);
  if (refusal) return refusal;
  const role = c.req.query('role');
  if (!role) return c.json({ error: 'Name the role: ?role=<id>.' }, 400);
  try {
    return c.json(await askPreview(c.req.param('id'), role));
  } catch (e) {
    return failed(c, e);
  }
});

askApi.post('/:id/ask', async (c) => {
  const refusal = agentRefusal(c);
  if (refusal) return refusal;
  const parsed = askBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Bad request.' }, 400);
  try {
    return c.json(await sendAsk(c.req.param('id'), parsed.data), 201);
  } catch (e) {
    return failed(c, e);
  }
});
