// Ben's first message in a thread, shown in the transcript from the moment he sends it. The server records a message
// in the transcript only once the harness has read it (apps/server/runner/records.ts), and a new process, or a thread
// that runs on another machine, reads it seconds after "Thinking" shows. Until then the thread detail and the thread
// stream carry it as `opening`, and the clients draw it as the transcript's first row.
import type { TranscriptEvent, UserP } from './transcript-fold.ts';

/**
 * GET /threads/:id `opening` and the thread stream's: the first message, while the thread's transcript has no
 * message of Ben's. `uuid` is its pending row's when this machine runs the thread; one sent to another machine has none.
 */
export interface Opening {
  text: string;
  uuid?: string;
  attachments?: UserP['attachments'];
  context?: unknown;
}

/** The stand-in row's id. Stored rows count up from 1, so it never meets one. */
export const OPENING_ID = 0;

/**
 * The transcript with the opening as its first row, and the pending messages without it. Once a message of Ben's is
 * in the transcript the opening is dropped, even before the server's next thread event says so.
 */
export function withOpening<E extends TranscriptEvent, P extends { uuid: string }>(
  events: E[],
  pending: P[],
  opening: Opening | null | undefined,
  thread: { id: string; created_at: string },
): { events: E[]; pending: P[] } {
  if (!opening || events.some((e) => e.kind === 'user')) return { events, pending };
  const payload: UserP = { text: opening.text, ...(opening.attachments?.length && { attachments: opening.attachments }), ...(opening.context !== undefined && { context: opening.context }) };
  const row = { id: OPENING_ID, thread_id: thread.id, kind: 'user', payload: JSON.stringify(payload), created_at: thread.created_at } as E;
  return { events: [row, ...events], pending: opening.uuid ? pending.filter((p) => p.uuid !== opening.uuid) : pending };
}
