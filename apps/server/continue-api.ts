// /api/threads/:id/continue: continue an idle thread on another local harness (apps/server/continue.ts), with a
// preview of the Carryover first. And /api/threads/:id/history, where a Carryover sends its new session for the
// history it left out.
import { Hono } from 'hono';
import { z } from 'zod';
import { ContinueRefused, historyOf, previewContinue, startContinue } from './continue.ts';

export const continueApi = new Hono();

const runSchema = z.object({
  harness: z.string().min(1).max(100),
  model: z.string().max(200).nullish().transform((v) => v ?? ''),
  effort: z.string().max(100).nullish().transform((v) => v ?? ''),
  // The ids of the source's attachments Ben picked (`CarryoverAttachment.id`). None unless he picks.
  attachments: z.array(z.string().min(1).max(200)).max(200).optional(),
});

/** The Carryover the picked run would read, the revision a start must name, and what keeps the thread from it now. */
continueApi.post('/:id/continue/preview', async (c) => {
  const { attachments, ...run } = runSchema.parse(await c.req.json().catch(() => ({})));
  return c.json(await previewContinue(c.req.param('id'), run, attachments));
});

const startSchema = runSchema.extend({
  // Ben's message goes as he wrote it, after the Carryover, never cut.
  text: z.string().refine((s) => s.trim().length > 0, 'Write the first message for the new thread.'),
  // The client's id for this start, kept across its retries: a retry gets the same thread back.
  request_id: z.string().min(1).max(200),
  revision: z.string().min(1).max(100),
});

/**
 * Start the continued thread: `{thread, duplicate}`. A 409 says why it did not: `busy` with the `block`, `changed` with
 * the fresh `preview`, or `request_reused`.
 */
continueApi.post('/:id/continue', async (c) => {
  const body = startSchema.parse(await c.req.json().catch(() => ({})));
  try {
    return c.json(await startContinue(c.req.param('id'), body));
  } catch (err) {
    if (err instanceof ContinueRefused) return c.json(err.body, 409);
    throw err;
  }
});

/** The thread's history as text, oldest first: after the event `after`, through the event `through` (uids). */
continueApi.get('/:id/history', (c) => c.text(historyOf(c.req.param('id'), c.req.query('after'), c.req.query('through'))));
