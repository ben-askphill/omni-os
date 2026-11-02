import { CONTEXT_JSON_MAX, CONTEXT_MAX, type MessageContext } from '@omni/shared/message-context.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import { useSyncExternalStore } from 'react';

import { createStore } from '../live/store';

/**
 * The context Ben added to each thread's next message and has not sent. It lives at module level like the text draft, so
 * it survives leaving the Changes screen for the thread. It is not saved across a restart.
 */
const lists = createStore<Readonly<Record<string, readonly MessageContext[]>>>({});

const NONE: readonly MessageContext[] = [];

export const draftContext = (threadId: string): readonly MessageContext[] => lists.get()[threadId] ?? NONE;

export const useDraftContext = (threadId: string): readonly MessageContext[] => useSyncExternalStore(lists.subscribe, () => draftContext(threadId));

function put(threadId: string, list: readonly MessageContext[]): void {
  lists.set((all) => {
    const { [threadId]: _gone, ...rest } = all;
    return list.length ? { ...rest, [threadId]: list } : rest;
  });
}

/** Adds `record` to the thread's next message. Null when it is on it, else why it cannot be, in the words the server's limits call for. */
export function addDraftContext(threadId: string, record: MessageContext): string | null {
  const list = draftContext(threadId);
  if (list.some((r) => r.id === record.id)) return null;
  const next = [...list, record];
  const checked = parseContexts(next);
  if (!checked.ok) {
    if (next.length > CONTEXT_MAX) return `A message holds at most ${CONTEXT_MAX} of these. Send it, or remove one first.`;
    if (JSON.stringify(next).length > CONTEXT_JSON_MAX) return 'Too much for one message. Pick fewer lines, or send what is attached first.';
    return checked.error;
  }
  put(threadId, next);
  return null;
}

export function removeDraftContext(threadId: string, id: string): void {
  const list = draftContext(threadId);
  if (list.some((r) => r.id === id)) put(
    threadId,
    list.filter((r) => r.id !== id),
  );
}

/** Drops what a send carried. A record added while it was in flight stays for the next message. */
export function settleDraftContext(threadId: string, sentIds: readonly string[]): void {
  if (!sentIds.length) return;
  const list = draftContext(threadId);
  if (list.some((r) => sentIds.includes(r.id))) {
    put(
      threadId,
      list.filter((r) => !sentIds.includes(r.id)),
    );
  }
}
