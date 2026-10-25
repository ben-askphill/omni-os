// Attaching a thread to the thread's next message, without the React: what the picker's search answers and how a
// pick becomes a draft record. The desktop popover and the phone sheet (components/ThreadReference.tsx) share it.
import { newContext } from '@omni/shared/message-context.ts';
import { referenceBody, threadReference } from '@omni/shared/message-context-thread.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { addDraftContext, draftContext } from './draft.ts';

/** One match of GET /api/thread-references (apps/server/thread-references-api.ts). */
export interface ReferenceCandidate {
  id: string;
  short_id: string;
  title: string;
  channel: string;
  channel_name: string;
  status: string;
  archived: boolean;
  updated_at: string;
  same_channel: boolean;
}

export type ReferenceScope = 'channel' | 'all';

export const searchPath = (threadId: string, query: string, scope: ReferenceScope) =>
  `/thread-references?thread=${encodeURIComponent(threadId)}&q=${encodeURIComponent(query.trim())}&scope=${scope}`;

/** Whether `threadId`'s next message already carries a reference to `ref`. */
export const isAttached = (threadId: string, ref: string) =>
  readContexts(draftContext(threadId)).some((r) => r.as === 'known' && r.kind === 'thread_reference' && r.body.thread === ref);

/**
 * Adds `c` to `threadId`'s next message. Null when it is on it, else why not. A candidate outside the thread's channel
 * is only ever added from the All channels scope, so `cross_channel` is true only for a pick Ben made there.
 */
export function attachReference(threadId: string, channel: string, c: ReferenceCandidate, at: Date = new Date()): string | null {
  if (isAttached(threadId, c.id)) return 'That thread is already attached.';
  const body = referenceBody({ id: c.id, title: c.title, channel: c.channel, channel_name: c.channel_name }, channel, at);
  return addDraftContext(threadId, newContext(threadReference, body, ''));
}
