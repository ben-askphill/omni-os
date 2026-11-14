// /api/threads/:id/review-notes: Ben's notes pinned to lines of a thread's Changes diff (packages/shared/review-notes.ts),
// and Send open notes, which posts every open one as one message.
import { Hono } from 'hono';
import { z } from 'zod';
import { openNotes, parseNoteBody, parseNoteInput, sendRecords, THREAD_NOTES_MAX, type ReviewNotesList, type ReviewNotesSent } from '@omni/shared/review-notes.ts';
import { publishFeed } from './bus.ts';
import { reviewNotes, threads } from './db.ts';
import { contextBlock, placeFor } from './message-context/project.ts';
import { postMessage } from './runner.ts';

export const reviewNotesApi = new Hono();

const changed = (threadId: string) => publishFeed({ type: 'review_notes', thread_id: threadId });

/** The note, when it is this thread's. */
const noteOf = (threadId: string, noteId: string) => {
  const n = reviewNotes.get(noteId);
  return n && n.thread_id === threadId ? n : null;
};

reviewNotesApi.get('/:id/review-notes', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  return c.json({ notes: reviewNotes.byThread(id) } satisfies ReviewNotesList);
});

/** `{anchor, body}`: the lines as a diff_selection body (message-context-diff.ts selectRows), and the note. */
reviewNotesApi.post('/:id/review-notes', async (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const input = parseNoteInput(await c.req.json().catch(() => null));
  if (!input.ok) return c.json({ error: input.error }, 400);
  if (reviewNotes.count(id) >= THREAD_NOTES_MAX) return c.json({ error: `A thread keeps at most ${THREAD_NOTES_MAX} notes. Delete some resolved ones first.` }, 409);
  const note = reviewNotes.create(id, input.value.anchor, input.value.body);
  changed(id);
  return c.json({ note });
});

/** `{body?, resolved?}`. A new body reopens a sent note; `resolved: false` reopens a resolved one. */
reviewNotesApi.patch('/:id/review-notes/:note', async (c) => {
  const id = c.req.param('id');
  const raw = z.object({ body: z.string().optional(), resolved: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
  if (!noteOf(id, c.req.param('note'))) return c.json({ error: 'note not found' }, 404);
  let body: string | undefined;
  if (raw.body !== undefined) {
    const parsed = parseNoteBody(raw.body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    body = parsed.value;
  }
  const note = reviewNotes.update(c.req.param('note'), { body, resolved: raw.resolved });
  changed(id);
  return c.json({ note });
});

reviewNotesApi.delete('/:id/review-notes/:note', (c) => {
  const id = c.req.param('id');
  if (!noteOf(id, c.req.param('note'))) return c.json({ error: 'note not found' }, 404);
  reviewNotes.remove(c.req.param('note'));
  changed(id);
  return c.json({ ok: true });
});

/**
 * Send open notes: one message with every open note on it, each a diff_selection record with the note as its note,
 * then each marked sent. `target` is the thread the message goes to, this one when left out; a send to another
 * thread is the seam for picking one (#687). `request_id` makes a retry safe, as for /messages.
 */
reviewNotesApi.post('/:id/review-notes/send', async (c) => {
  const id = c.req.param('id');
  const { target, mode, request_id } = z
    .object({
      target: z.string().min(1).max(200).optional(),
      mode: z.enum(['steer', 'queue', 'interrupt']).default('steer'),
      request_id: z.string().min(1).max(200).optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const to = target ?? id;
  const toThread = threads.get(to);
  if (!toThread) return c.json({ error: 'target thread not found' }, 404);
  const open = openNotes(reviewNotes.byThread(id));
  const message = sendRecords(open);
  if (!message.ok) return c.json({ error: message.error }, 400);
  // The harness block drops items past its bound (project.ts); a note it would drop is refused here instead of marked sent.
  if (/ more items? not shown\n<\/omni-context>$/.test(contextBlock(message.value.context, placeFor(toThread)))) {
    return c.json({ error: 'These notes are too long for one message. Resolve or delete some, then send again.' }, 400);
  }
  await postMessage(to, message.value.prompt, { from: 'ben', mode, context: message.value.context, requestId: request_id });
  const sent = reviewNotes.markSent(open.map((n) => n.id));
  changed(id);
  return c.json({ target: to, sent } satisfies ReviewNotesSent);
});
