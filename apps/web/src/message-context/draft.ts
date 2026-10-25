// The context Ben has added to a thread's next message and not sent yet (packages/shared/message-context.ts). One
// list per thread, shared by the desktop reply box and the phone composer. Kept in memory across navigation and in
// this browser's localStorage across a reload, as the Mac app keeps its own: a browser_annotation's screenshot is a file
// on the server, so a reload that dropped the record would leave the file behind and cost Ben the capture.
import { useSyncExternalStore } from 'react';
import { CONTEXT_JSON_MAX, CONTEXT_MAX, type MessageContext } from '@omni/shared/message-context.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';

const STORE_KEY = 'omni.contextDrafts';

/** The stored drafts, each record checked again as the server would. Whatever does not parse is dropped, never thrown. */
export function readStoredDrafts(raw: string | null | undefined): Map<string, readonly MessageContext[]> {
  const out = new Map<string, readonly MessageContext[]>();
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
    for (const [thread, list] of Object.entries(stored)) {
      const checked = parseContexts(list);
      if (checked.ok && checked.value.length) out.set(thread, checked.value);
    }
  } catch {
    // Unreadable: no drafts.
  }
  return out;
}

const store = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked storage throws on access.
    return null;
  }
};

const drafts = (() => {
  try {
    return readStoredDrafts(store()?.getItem(STORE_KEY));
  } catch {
    return new Map<string, readonly MessageContext[]>();
  }
})();
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
  try {
    if (drafts.size) store()?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(drafts)));
    else store()?.removeItem(STORE_KEY);
  } catch {
    // Full or blocked: the draft still lives in memory.
  }
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
