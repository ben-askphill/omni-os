// /api/threads/:id/transitions: the four routes of the transition service (apps/server/transition.ts), one for each
// operation, for every kind: preview, create, read, cancel. The older routes (Continue preview and start, run switch,
// handoff, takeover, handoff cancel) answer through the same service in their own shapes, so clients and machines on
// an older build keep working; a new client can use these alone.
import { Hono } from 'hono';
import { z } from 'zod';
import { ContinueRefused } from './continue.ts';
import { cancelTransition, createTransition, previewTransition, readTransition } from './transition.ts';

export const transitionsApi = new Hono();

const runSchema = z.object({
  harness: z.string().min(1).max(100),
  model: z.string().max(200).nullish().transform((v) => v ?? ''),
  effort: z.string().max(100).nullish().transform((v) => v ?? ''),
});
const attachments = z.array(z.string().min(1).max(200)).max(200).optional();
const reconfigure = z.object({ kind: z.literal('reconfigure'), run: runSchema });
/** A synced machine's id from GET /api/devices, or "here" to take the thread over. */
const relocate = z.object({ kind: z.literal('relocate'), to: z.string().min(1).max(200) });
const forkPreview = z.object({ kind: z.literal('fork'), run: runSchema, attachments });
const fork = forkPreview.extend({
  // Ben's message goes as he wrote it, after the Carryover, never cut.
  text: z.string().refine((s) => s.trim().length > 0, 'Write the first message for the new thread.'),
  // The client's id for this start, kept across its retries: a retry gets the same thread back.
  request_id: z.string().min(1).max(200),
  revision: z.string().min(1).max(100),
});
const previewSchema = z.discriminatedUnion('kind', [reconfigure, relocate, forkPreview]);
const createSchema = z.discriminatedUnion('kind', [reconfigure, relocate, fork]);

/** What the transition would do now and what keeps the thread from it. Nothing changes. */
transitionsApi.post('/:id/transitions/preview', async (c) => {
  const body = previewSchema.parse(await c.req.json().catch(() => ({})));
  return c.json(await previewTransition(c.req.param('id'), body));
});

/**
 * Start a transition. Answers with it as it stands: a reconfigure `applied` or `queued`, a relocate in its handoff's
 * first phase, a fork `started` with the new thread. A 409 says why it cannot start: for a fork, Continue's `busy`,
 * `changed` and `request_reused` bodies; a 400 for a run the catalog does not offer.
 */
transitionsApi.post('/:id/transitions', async (c) => {
  const body = createSchema.parse(await c.req.json().catch(() => ({})));
  try {
    return c.json(await createTransition(c.req.param('id'), body));
  } catch (err) {
    if (err instanceof ContinueRefused) return c.json(err.body, 409);
    throw err;
  }
});

/** The transition as it stands now. */
transitionsApi.get('/:id/transitions/:tid', (c) => {
  const t = readTransition(c.req.param('id'), c.req.param('tid'));
  return t ? c.json(t) : c.json({ error: 'not found' }, 404);
});

/** Cancel one that has not finished: a queued run switch, a handoff or Take over under way. A 409 for one that is over, or a fork. */
transitionsApi.post('/:id/transitions/:tid/cancel', async (c) => c.json(await cancelTransition(c.req.param('id'), c.req.param('tid'))));
