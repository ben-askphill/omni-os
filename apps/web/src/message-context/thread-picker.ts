// Attaching a thread to a message, without the React: what the picker's search answers and how a pick becomes a draft
// record. The thread menu's popover and phone sheet, and both new-thread composers (components/ThreadReference.tsx), share it.
import type { MessageContext } from '@omni/shared/message-context.ts';
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

/**
 * Where a pick goes. `draft` is the draft-context list it joins (draft.ts), `channel` the channel This channel searches
 * and a pick is checked against. `thread` is the thread the message is written in, left out by a new-thread composer:
 * the thread is not made yet, so the search runs from the channel and leaves no thread out.
 */
export interface ReferenceTarget {
  draft: string;
  channel: string;
  thread?: string;
}

/** A reply's target: the thread's own draft and channel. */
export const threadTarget = (t: { id: string; channel_id: string }): ReferenceTarget => ({ draft: t.id, channel: t.channel_id, thread: t.id });

export const searchPath = (to: ReferenceTarget, query: string, scope: ReferenceScope) =>
  `/thread-references?${to.thread ? `thread=${encodeURIComponent(to.thread)}` : `channel=${encodeURIComponent(to.channel)}`}&q=${encodeURIComponent(query.trim())}&scope=${scope}`;

/** Whether the draft `draft` already carries a reference to `ref`. */
export const isAttached = (draft: string, ref: string) =>
  readContexts(draftContext(draft)).some((r) => r.as === 'known' && r.kind === 'thread_reference' && r.body.thread === ref);

/**
 * Adds `c` to the target's draft. Null when it is on it, else why not. A candidate outside the target's channel is only
 * ever added from the All channels scope, so `cross_channel` is true only for a pick Ben made there.
 */
export function attachReference(to: ReferenceTarget, c: ReferenceCandidate, at: Date = new Date()): string | null {
  if (isAttached(to.draft, c.id)) return 'That thread is already attached.';
  const body = referenceBody({ id: c.id, title: c.title, channel: c.channel, channel_name: c.channel_name }, to.channel, at);
  return addDraftContext(to.draft, newContext(threadReference, body, ''));
}

/**
 * A new thread's references as they go with it to `channel`. The Home composer's channel can change after a pick, and
 * the chips stay: each names its channel, so Start sends what Ben sees. `cross_channel` is set again for the channel
 * the thread starts in (the server checks it against the real channels and writes it back the same).
 */
export function referencesFor(records: readonly MessageContext[], channel: string): MessageContext[] {
  return readContexts(records).map((r) => (r.as === 'known' && r.kind === 'thread_reference' ? { ...r.record, body: { ...r.body, cross_channel: r.body.channel !== channel } } : r.record));
}
