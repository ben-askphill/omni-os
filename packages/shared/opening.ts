// The message that opens a turn, drawn in the transcript from the moment it is sent. The server records a message only
// once the harness replays it (apps/server/runner/records.ts), seconds after "Thinking" shows when a process starts, a
// prompt hook runs or the thread runs on another machine.
import { parsePayload, type TranscriptEvent, type UserP } from './transcript-fold.ts';

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

export interface PendingRow {
  uuid: string;
  kind: string;
  text: string;
  state: string;
  source?: string;
  attachments?: UserP['attachments'];
  context?: unknown;
}

/** The stand-in row's id. Stored rows count up from 1, so it never meets one. */
export const OPENING_ID = 0;

/** A later turn's stand-in: above every stored id, so it sorts last and stays in the live span (`spanIndex`). */
export const LEAD_ID = Number.MAX_SAFE_INTEGER;

/** No activity since the last turn ended, so a sent message starts the next turn instead of steering one. */
export function betweenTurns(events: readonly Pick<TranscriptEvent, 'kind' | 'payload'>[]): boolean {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k];
    if (e.kind === 'result' || e.kind === 'error') return true;
    if (e.kind === 'user' || e.kind === 'crew_report') {
      if (!parsePayload<{ dropped?: boolean }>(e).dropped) return false;
    } else if (e.kind === 'tool_use' || e.kind === 'tool_result' || e.kind === 'assistant_text') return false;
  }
  return true;
}

const userRow = <E extends TranscriptEvent>(id: number, threadId: string, created_at: string, m: Opening & { source?: string }) => {
  const payload: UserP = {
    text: m.text,
    ...(m.source && { source: m.source }),
    ...(m.attachments?.length && { attachments: m.attachments }),
    ...(m.context !== undefined && { context: m.context }),
  };
  return { id, thread_id: threadId, kind: 'user', payload: JSON.stringify(payload), created_at } as E;
};

/**
 * The transcript with the running turn's opening message as a row, and the pending list without it: the thread's
 * first message first, or a later turn's last. A message steered into a turn under way stays pending.
 */
export function withOpening<E extends TranscriptEvent, P extends PendingRow>(
  events: E[],
  pending: P[],
  opening: Opening | null | undefined,
  thread: { id: string; created_at: string; updated_at: string },
): { events: E[]; pending: P[] } {
  if (opening && !events.some((e) => e.kind === 'user')) {
    return { events: [userRow<E>(OPENING_ID, thread.id, thread.created_at, opening), ...events], pending: opening.uuid ? pending.filter((p) => p.uuid !== opening.uuid) : pending };
  }
  const lead = betweenTurns(events) ? pending.find((p) => p.kind === 'user' && p.state === 'sent') : undefined;
  if (!lead) return { events, pending };
  // A pending row has no send time. Sending set the thread running, which moved updated_at.
  return { events: [...events, userRow<E>(LEAD_ID, thread.id, thread.updated_at, lead)], pending: pending.filter((p) => p !== lead) };
}
