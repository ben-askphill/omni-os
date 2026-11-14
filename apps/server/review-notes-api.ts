// /api/threads/:id/review-notes: Ben's notes pinned to lines of a thread's Changes diff (packages/shared/review-notes.ts),
// and Send open notes, which posts every open one as one message.
import { Hono } from 'hono';
import { z } from 'zod';
import { openNotes, parseNoteBody, parseNoteInput, sendRecords, THREAD_NOTES_MAX, type ReviewNoteTargets, type ReviewNotesList, type ReviewNotesSent } from '@omni/shared/review-notes.ts';
import { publishFeed } from './bus.ts';
import { reviewNotes, threads, type Thread } from './db.ts';
import { contextBlock, placeFor } from './message-context/project.ts';
import { createThread, postMessage } from './runner.ts';

export const reviewNotesApi = new Hono();

const changed = (threadId: string) => publishFeed({ type: 'review_notes', thread_id: threadId });

/** The note, when it is this thread's. */
const noteOf = (threadId: string, noteId: string) => {
  const n = reviewNotes.get(noteId);
  return n && n.thread_id === threadId ? n : null;
};

/**
 * Where this thread's notes may go besides itself: the threads it delegated to, the Conductor's way or a send's new
 * delegate. Team members are left out (their lead runs them), and so is any other thread, so a send cannot reach a
 * thread Ben did not route from here.
 */
const delegatesOf = (id: string): Thread[] => threads.children(id).filter((t) => t.source !== 'team' && !t.archived);

reviewNotesApi.get('/:id/review-notes/targets', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  return c.json({ targets: delegatesOf(id).map((t) => ({ id: t.id, title: t.title, role: t.role, status: t.status })) } satisfies ReviewNoteTargets);
});

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
 * then each marked sent here, on the thread they were written on. Where it goes: this thread when nothing is named,
 * `target`, which must be one of this thread's delegates (delegatesOf), or with `new_delegate` a new thread under this
 * one, started as the Conductor's delegate starts one, whose first message is the notes. A new delegate runs on this
 * machine, where the notes' files are, and starts from this thread's branch when it has one. `request_id` makes a
 * retry safe, as for /messages; for a new delegate it is the new thread's id, so a retry finds the thread it made.
 */
reviewNotesApi.post('/:id/review-notes/send', async (c) => {
  const id = c.req.param('id');
  const { target, new_delegate, mode, request_id } = z
    .object({
      target: z.string().min(1).max(200).optional(),
      new_delegate: z.boolean().default(false),
      mode: z.enum(['steer', 'queue', 'interrupt']).default('steer'),
      request_id: z.string().min(1).max(200).optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  const from = threads.get(id);
  if (!from) return c.json({ error: 'not found' }, 404);
  if (target && new_delegate) return c.json({ error: 'Pick a delegate or a new one, not both.' }, 400);
  const to = target && target !== id ? delegatesOf(id).find((t) => t.id === target) : from;
  if (!to) return c.json({ error: 'Notes go to this thread or a thread it delegated to.' }, 400);
  // A retry of a new-delegate send whose answer was lost: the thread it made, with the notes it already carried.
  const made = new_delegate && request_id ? threads.get(request_id) : null;
  if (made) return made.parent_id === id ? c.json({ target: made.id, sent: [], created: true } satisfies ReviewNotesSent) : c.json({ error: `Thread id ${made.id} was already used.` }, 409);
  const open = openNotes(reviewNotes.byThread(id));
  const message = sendRecords(open);
  if (!message.ok) return c.json({ error: message.error }, 400);
  // The harness block drops items past its bound (project.ts); a note it would drop is refused here instead of marked sent.
  // A new delegate is checked as this thread, whose checkout has the files the notes are on.
  if (/ more items? not shown\n<\/omni-context>$/.test(contextBlock(message.value.context, placeFor(to)))) {
    return c.json({ error: 'These notes are too long for one message. Resolve or delete some, then send again.' }, 400);
  }
  if (new_delegate) {
    const thread = await createThread({
      ...(request_id && UUID.test(request_id) && { id: request_id }),
      channel: from.channel_id,
      prompt: message.value.prompt,
      context: message.value.context,
      title: `Review notes: ${from.title?.trim() || 'untitled thread'}`.slice(0, 120),
      harness: from.harness,
      model: from.model,
      effort: from.effort,
      parent_id: id,
      source: 'manual',
      device: 'here',
      ...(from.branch && { base: { kind: 'ref' as const, ref: from.branch } }),
    });
    const sent = reviewNotes.markSent(open.map((n) => n.id));
    changed(id);
    return c.json({ target: thread.id, sent, created: true } satisfies ReviewNotesSent);
  }
  await postMessage(to.id, message.value.prompt, { from: 'ben', mode, context: message.value.context, requestId: request_id });
  const sent = reviewNotes.markSent(open.map((n) => n.id));
  changed(id);
  return c.json({ target: to.id, sent } satisfies ReviewNotesSent);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
