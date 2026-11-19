import { CONTEXT_JSON_MAX, CONTEXT_MAX, type MessageContext } from '@omni/shared/message-context.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import { useSyncExternalStore } from 'react';

import { createStore } from '../live/store';
import type { ThreadKey } from '../live/thread-key';

/**
 * The context Ben added to each thread's next message and has not sent, per server and thread (live/thread-key.ts). It
 * lives at module level like the text draft, so it survives leaving the Changes screen for the thread. It is not saved
 * across a restart, and lines picked on one server never show on another server's thread with the same id.
 */
const lists = createStore<Readonly<Record<string, readonly MessageContext[]>>>({});

const NONE: readonly MessageContext[] = [];

export const draftContext = (key: ThreadKey): readonly MessageContext[] => lists.get()[key] ?? NONE;

export const useDraftContext = (key: ThreadKey): readonly MessageContext[] => useSyncExternalStore(lists.subscribe, () => draftContext(key));

function put(key: ThreadKey, list: readonly MessageContext[]): void {
  lists.set((all) => {
    const { [key]: _gone, ...rest } = all;
    return list.length ? { ...rest, [key]: list } : rest;
  });
}

/** Adds `record` to the thread's next message. Null when it is on it, else why it cannot be, in the words the server's limits call for. */
export function addDraftContext(key: ThreadKey, record: MessageContext): string | null {
  const list = draftContext(key);
  if (list.some((r) => r.id === record.id)) return null;
  const next = [...list, record];
  const checked = parseContexts(next);
  if (!checked.ok) {
    if (next.length > CONTEXT_MAX) return `A message holds at most ${CONTEXT_MAX} of these. Send it, or remove one first.`;
    if (JSON.stringify(next).length > CONTEXT_JSON_MAX) return 'Too much for one message. Pick fewer lines, or send what is attached first.';
    return checked.error;
  }
  put(key, next);
  return null;
}

export function removeDraftContext(key: ThreadKey, id: string): void {
  const list = draftContext(key);
  if (list.some((r) => r.id === id)) put(
    key,
    list.filter((r) => r.id !== id),
  );
}

/** Drops what a send carried. A record added while it was in flight stays for the next message. */
export function settleDraftContext(key: ThreadKey, sentIds: readonly string[]): void {
  if (!sentIds.length) return;
  const list = draftContext(key);
  if (list.some((r) => sentIds.includes(r.id))) {
    put(
      key,
      list.filter((r) => !sentIds.includes(r.id)),
    );
  }
}
