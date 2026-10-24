// The context Ben has added to a thread's next message and not sent yet (packages/shared/message-context.ts). One
// list per thread, shared by the desktop reply box and the phone composer, kept like their text: in memory, across
// navigation, not across reloads.
import { useSyncExternalStore } from 'react';
import { CONTEXT_JSON_MAX, CONTEXT_MAX, type MessageContext } from '@omni/shared/message-context.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';

const drafts = new Map<string, readonly MessageContext[]>();
const listeners = new Set<() => void>();
const NONE: readonly MessageContext[] = [];

const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

export const draftContext = (threadId: string) => drafts.get(threadId) ?? NONE;

export const useDraftContext = (threadId: string) =>
  useSyncExternalStore(
    subscribe,
    () => draftContext(threadId),
    () => NONE,
  );

function put(threadId: string, list: readonly MessageContext[]) {
  if (list.length) drafts.set(threadId, list);
  else drafts.delete(threadId);
  listeners.forEach((fn) => fn());
}

/**
 * Adds `record` to the thread's next message. Null when it is on it, else why it cannot be: the limits the server
 * holds the message to, checked here so Ben hears it before he sends.
 */
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

export function removeDraftContext(threadId: string, id: string) {
  const list = draftContext(threadId);
  if (list.some((r) => r.id === id)) put(threadId, list.filter((r) => r.id !== id));
}

/** Drops what a send carried. A record added while it was in flight stays for the next message. */
export function settleDraftContext(threadId: string, sentIds: readonly string[]) {
  if (!sentIds.length) return;
  const list = draftContext(threadId);
  if (list.some((r) => sentIds.includes(r.id))) put(threadId, list.filter((r) => !sentIds.includes(r.id)));
}
